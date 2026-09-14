"""Run the locked image offline without registration, host mounts or credentials."""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
DOCKER = r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"
LOCK = json.loads((ROOT / "ops/staging/runner/image.lock.json").read_text())
IMAGE = LOCK["imageId"]
BASE = [DOCKER, "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--user", "1001:1001",
        "--tmpfs", "/runner:rw,exec,nosuid,nodev,size=64m,uid=1001,gid=1001,mode=0700",
        "--tmpfs", "/opt/hostedtoolcache:rw,exec,nosuid,nodev,size=64m,uid=1001,gid=1001",
        "--entrypoint", "/home/runner/externals/node24/bin/node"]
def main():
    results = []
    def run(name, options, arguments, expected):
        result = subprocess.run(BASE + options + [IMAGE] + arguments, capture_output=True, text=True, timeout=45)
        assert result.returncode == expected, name + " failed"
        results.append({"case": name, "exitCode": result.returncode, "expected": expected, "network": "none"})
    run("toolchain survives toolcache overlay", [], ["/opt/opa/verify-toolchain.cjs"], 0)
    run("stripped PATH rejects job bootstrap", ["--env", "PATH="], ["/opt/opa/verify-toolchain.cjs"], 1)
    for phase in ("before-checkout", "after-checkout", "supervisor-failure"):
        code = """const fs=require('fs');if(process.argv[1]==='after-checkout')fs.mkdirSync('/runner/_work/repo',{recursive:true});
    const r=require('child_process').spawnSync('/home/runner/externals/node24/bin/node',['/opt/opa/verify-toolchain.cjs'],{env:process.env,stdio:'pipe'});
    if(r.status!==1)process.exit(2);
    require('/opt/opa/signal-cleanup.cjs').signal();
    const x=JSON.parse(fs.readFileSync('/runner/opa-staging-job-finished.json'));
    if(x.runId!=='1'||x.sha!=='a'.repeat(40))process.exit(3);"""
        run("cleanup without job tools " + phase,
            ["--env", "PATH=", "--env", "GITHUB_RUN_ID=1", "--env", "GITHUB_SHA=" + "a"*40,
             "--tmpfs", "/opt/opa/node22:rw,size=1m,uid=1001,gid=1001"],
            ["-e", code, phase], 0)
    print(json.dumps({"image": IMAGE, "tests": results, "registered": False, "databaseAccess": False}))

if __name__ == "__main__":
    main()
