"""Network-free tests of supervisor diagnostics and its actual finally body."""
import ast
import contextlib
import io
import json
import pathlib
import subprocess
import types
import unittest
import runner_runtime as runtime

ROOT = pathlib.Path(__file__).parent
class Tests(unittest.TestCase):
    def test_diagnostics_never_retain_secret_bearing_exception(self):
        recorder = runtime.Recorder()
        def fail():
            raise subprocess.TimeoutExpired(["docker", "secret-token"], 20, output="DATABASE_URL=secret-url", stderr="secret-password")
        with self.assertRaises(subprocess.TimeoutExpired):
            recorder.call("runner.probe", "docker.exec", fail)
        text = json.dumps(recorder.events)
        for secret in ["secret-token", "secret-url", "secret-password", "DATABASE_URL"]:
            self.assertNotIn(secret, text)
        event = recorder.events[0]
        self.assertTrue(event["timeout"])
        self.assertEqual(event["exceptionClass"], "TimeoutExpired")
        for key in ["stage", "command", "exitCode", "signal", "durationMs", "resources"]:
            self.assertIn(key, event)

    def test_signal_and_exit_metadata(self):
        recorder = runtime.Recorder()
        recorder.call("probe", "docker.exec", lambda: types.SimpleNamespace(returncode=-9))
        self.assertEqual(recorder.events[0]["signal"], 9)
        self.assertEqual(recorder.events[0]["exitCode"], -9)

    def run_finally(self, phase, fail_container=False):
        tree = ast.parse((ROOT / "run-protected-migration.py").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "execute")
        block = next(n for n in function.body if isinstance(n, ast.Try) and n.finalbody)
        calls=[]; state={"auth":True,"registered":phase!="before-launch"}
        audit={"testDatabaseRequested":False,"networkCleanup":[],"testDatabaseCleanup":True}
        sha="a"*40; leaseid="b"*24; name="opa-staging-ephemeral-"+leaseid
        def response(status, body=None):
            return types.SimpleNamespace(status_code=status,json=lambda:body)
        def gh(method, route, body=None, allowed=()):
            calls.append(("gh",method,route))
            if "/variables/" in route:
                if method=="DELETE":state["auth"]=False;return response(204)
                return response(200,{"value":json.dumps({"sha":sha,"lease":leaseid,"action":"VALIDATE_MIGRATED_OPA_STAGING"})}) if state["auth"] else response(404)
            if "/actions/runners" in route:
                if method=="DELETE":state["registered"]=False;return response(204)
                return response(200,{"runners":[{"name":name,"id":7}] if state["registered"] else []})
            return response(202)
        def arm(method, resource, **kwargs):
            calls.append(("arm",method,resource))
            return response(404 if method=="GET" else 204)
        def run(command, **kwargs):
            calls.append(("docker",command[1]))
            if fail_container and command[1]=="rm":
                raise subprocess.TimeoutExpired(["secret-command"],30,output="secret-output")
            return types.SimpleNamespace(returncode=0,stdout=json.dumps({"diskFreeBytes":1024,"memoryAvailableBytes":2048,"memoryTotalBytes":4096}) if command[1]=="exec" else "")
        def require(value, code):
            if not value:raise RuntimeError(code)
        env={"container":None,"args":types.SimpleNamespace(execute=True,sha=sha,run_id=1),"audit":audit,
             "runtime":runtime,"DIAG":runtime.Recorder(),"gh":gh,"arm":arm,
             "custody":lambda action: calls.append(("custody",action)),
             "iam":"staging-secret-iam","rules":["staging-postgres-rule","staging-vault-rule","staging-redis-rule"],
             "leaseid":leaseid,"action":"drop","name":name,"container_requested":phase!="before-launch",
             "trigger":{"mode":"validation"},"DOCKER":"docker","observed_run":run,"time":types.SimpleNamespace(sleep=lambda _:None),
             "json":json,"save":lambda:None,"require":require}
        error=None
        with contextlib.redirect_stdout(io.StringIO()):
            try:exec(compile(ast.Module(body=block.finalbody,type_ignores=[]),"<actual-cleanup>","exec"),env)
            except RuntimeError as exc:error=exc
        self.assertFalse(state["auth"])
        self.assertFalse(state["registered"])
        self.assertEqual(len(audit["networkCleanup"]),3)
        self.assertTrue(audit["temporaryIamRemoved"])
        if fail_container:
            self.assertIsNotNone(error)
            self.assertFalse(audit["cleanupOutcomes"]["container"])
            self.assertNotIn("secret-output",json.dumps(env["DIAG"].events))
        else:
            self.assertIsNone(error)
            self.assertTrue(all(audit["cleanupOutcomes"].values()))
        return calls

    def test_cleanup_before_checkout_with_no_job_node(self):
        self.run_finally("before-checkout")

    def test_cleanup_after_checkout_with_path_stripped(self):
        self.run_finally("after-checkout")

    def test_cleanup_when_bootstrap_never_starts(self):
        self.run_finally("before-launch")

    def test_cleanup_continues_after_supervisor_container_exception(self):
        calls=self.run_finally("supervisor-exception",True)
        self.assertTrue(any(x[0]=="gh" and x[1]=="DELETE" and "/actions/runners/" in x[2] for x in calls))

if __name__ == "__main__":
    unittest.main()
