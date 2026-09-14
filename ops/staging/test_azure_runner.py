import unittest,pathlib,importlib.util
import azure_runner_lifecycle as lifecycle
import runner_runtime
spec=importlib.util.spec_from_file_location("supervisor",pathlib.Path(__file__).with_name("run-azure-validation.py"));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Tests(unittest.TestCase):
 def test_recorded_approval_required(self):
  sha="a"*40;r={"id":1,"head_sha":sha,"head_branch":s.BRANCH,"event":"push","path":s.WORKFLOW,"status":"queued"};reviews=[{"state":"approved","environments":[{"name":"staging"}]}]
  s.approved(r,[],reviews,sha,1)
  for pending,rev in [([{"environment":"staging"}],reviews),([],[]),([],[{"state":"approved","environments":[{"name":"production"}]}])]:
   with self.assertRaises(RuntimeError):s.approved(r,pending,rev,sha,1)
  for k,v in [("head_sha","b"*40),("head_branch","main"),("path","production.yml")]:
   with self.assertRaises(RuntimeError):s.approved(dict(r,**{k:v}),[],reviews,sha,1)
 def test_routes(self):
  for kind,p in [("VnetLocal","10.72.0.0/20"),("VirtualNetworkGateway","172.27.240.0/24"),("Internet","0.0.0.0/0")]:s.routes([{"state":"Active","nextHopType":kind,"addressPrefix":[p]}])
  for kind,p in [("VnetPeering","10.90.0.0/16"),("VirtualNetworkGateway","10.90.0.0/16"),("VirtualAppliance","0.0.0.0/0")]:
   with self.assertRaises(RuntimeError):s.routes([{"state":"Active","nextHopType":kind,"addressPrefix":[p]}])
 def test_cleanup_every_failure_keeps_other_cleanup(self):
  for failure in lifecycle.ORDER:
   seen=[]
   def op(name):
    def run():
     seen.append(name)
     if name==failure:raise RuntimeError("SYNTHETIC")
     return True
    return run
   result=lifecycle.cleanup({name:op(name) for name in lifecycle.ORDER},runner_runtime.Recorder());self.assertEqual(seen,list(lifecycle.ORDER));self.assertFalse(result[failure]);self.assertEqual(sum(result.values()),len(lifecycle.ORDER)-1)
 def test_no_job_node_cleanup_dependency(self):
  src=pathlib.Path(s.__file__).read_text();transport=pathlib.Path(s.__file__).with_name('azure_runner_transport.py').read_text();self.assertIn("/home/runner/externals/node24/bin/node",transport);self.assertIn("['umount','/runner']",transport);self.assertNotIn("prisma migrate deploy",src);self.assertNotIn("reset",src)
 def test_exact_deletion_plan(self):
  self.assertTrue(s.VM.endswith('/vm-opa-staging-validation-01'));self.assertTrue(s.NIC.endswith('/nic-opa-staging-validation-01'));self.assertTrue(s.DISK.endswith('/osdisk-opa-staging-validation-01'));self.assertNotEqual(s.VNET,s.SUBNET)

 def test_control_channel_protected_transfer_and_cleanup(self):
  from unittest.mock import patch,Mock
  import azure_runner_transport as transport
  credential=Mock();credential.get_token.return_value.token='SYNTHETIC_AUTH'
  def response(code,data):
   r=Mock();r.status_code=code;r.json.return_value=data;return r
  put=response(201,{});done=response(200,{'properties':{'instanceView':{'executionState':'Succeeded','exitCode':0,'output':'OPA_CONTROL {"ok":true}'}}});absent=response(404,{})
  with patch.object(transport.requests,'put',return_value=put) as submitted,patch.object(transport.requests,'get',side_effect=[done,absent]),patch.object(transport.requests,'delete',return_value=response(204,{})),patch.object(transport.time,'sleep'):
   self.assertEqual(transport.Transport(credential).command('safe-script',{'secret':'SYNTHETIC_VALUE'}),{'ok':True})
   props=submitted.call_args.kwargs['json']['properties'];self.assertNotIn('SYNTHETIC_VALUE',props['source']['script']);self.assertIn('SYNTHETIC_VALUE',props['protectedParameters'][0]['value'])
 def test_embedded_control_script_compiles(self):
  from azure_runner_transport import SCRIPT
  compile(SCRIPT.split("python3 - <<'PY'\n",1)[1].rsplit("\nPY",1)[0],'<control>','exec')

class JitTests(unittest.TestCase):
 def test_one_job_no_update_settings_keep_credentials_unchanged(self):
  import base64,json
  original={'.runner':base64.b64encode(json.dumps({'agentName':s.NAME,'Ephemeral':False,'disableUpdate':False}).encode()).decode(),'.credentials':'SYNTHETIC_ENCODED_CREDENTIAL'}
  result=json.loads(base64.b64decode(s.seal_jit(base64.b64encode(json.dumps(original).encode()).decode())))
  settings=json.loads(base64.b64decode(result['.runner']));self.assertTrue(settings['ephemeral']);self.assertTrue(settings['disableUpdate']);self.assertEqual(settings['agentName'],s.NAME);self.assertEqual(result['.credentials'],original['.credentials']);self.assertNotIn('Ephemeral',settings)
if __name__=='__main__':unittest.main()
