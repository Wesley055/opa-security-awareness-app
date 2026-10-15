import unittest,importlib.util,pathlib,tempfile,io,json,base64,time,types
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('release',pathlib.Path(__file__).with_name('execute-release.py'))
R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
def token(exp):return 'h.'+base64.urlsafe_b64encode(json.dumps({'exp':exp}).encode()).decode().rstrip('=')+'.synthetic'
def manifest():return {'maintenance':{'start':'2026-10-14T20:00:00Z','end':'2026-10-14T20:30:00Z'},'executionTimeoutSeconds':900,'operatorCredentialBindings':{}}
NOW=1792008600 # within proposed window
class Tests(unittest.TestCase):
 def test_window_rejects_early_and_expired(self):
  start=R.datetime.datetime.fromisoformat('2026-10-14T20:00:00+00:00').timestamp()
  for n in (start-1,start+1800):
   with self.assertRaisesRegex(ValueError,'WINDOW'):R.window(manifest(),n)
  R.window(manifest(),start)
 def test_staging_delay_does_not_age_execution_credentials(self):
  calls=[]
  def credentials(*args):calls.append(time.time());return {k:token(time.time()+3600) for k in ('OPA_RELEASE_ARM_TOKEN','OPA_RELEASE_VAULT_TOKEN')}
  with patch.object(R.time,'time',return_value=NOW):
   # Staging is already complete; tokens are minted at admission, not 23 minutes earlier.
   values=R.execution_credentials(types.SimpleNamespace(credentials=credentials),'file','sha',manifest())
   self.assertEqual(calls,[NOW]);self.assertTrue(values)
 def test_short_or_expired_credentials_fail_and_are_cleared(self):
  for remaining in (-1,59):
   values={k:token(NOW+remaining) for k in ('OPA_RELEASE_ARM_TOKEN','OPA_RELEASE_VAULT_TOKEN')}
   with patch.object(R.time,'time',return_value=NOW),self.assertRaisesRegex(ValueError,'RELEASE_TOKEN_LIFETIME'):
    R.execution_credentials(types.SimpleNamespace(credentials=lambda *a:values),'f','s',manifest())
   self.assertEqual(values,{})
 def test_demonstrated_cached_token_is_valid_at_admission(self):
  values={k:token(NOW+1564) for k in ('OPA_RELEASE_ARM_TOKEN','OPA_RELEASE_VAULT_TOKEN')}
  with patch.object(R.time,'time',return_value=NOW):self.assertEqual(R.execution_credentials(types.SimpleNamespace(credentials=lambda *a:values),'f','s',manifest()),values)
 def test_window_expiring_during_acquisition_fails(self):
  values={k:token(NOW+7200) for k in ('OPA_RELEASE_ARM_TOKEN','OPA_RELEASE_VAULT_TOKEN')}
  with patch.object(R.time,'time',side_effect=[NOW,NOW+7200]),self.assertRaisesRegex(ValueError,'WINDOW'):
   R.execution_credentials(types.SimpleNamespace(credentials=lambda *a:values),'f','s',manifest())
  self.assertEqual(values,{})
 def test_staged_hashes_must_all_match(self):
  artifacts={'a':{'path':'a.zip','sha256':'a'*64},'b':{'path':'b.zip','sha256':'b'*64}}
  with patch.object(R,'remote_hash',side_effect=['a'*64,'b'*64]) as h:
   R.verify_staged(None,'/home/opa-releases/prior',artifacts);self.assertEqual(h.call_count,2)
  with patch.object(R,'remote_hash',return_value='0'*64),self.assertRaisesRegex(ValueError,'STAGED_ARTIFACT_CHANGED'):
   R.verify_staged(None,'/home/opa-releases/prior',artifacts)
 def test_staging_path_escape_rejected(self):
  for source in ('/tmp/prior','/home/opa-releases/../secret','/home/opa-releases/a;bad'):
   with self.assertRaises(ValueError):R.checked_source(source)
  for path in ('../key','/absolute','a/../../key'):
   with self.assertRaises(ValueError):R.artifact_path(path)
 def test_duplicate_attempt_never_overwrites(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'attempt.json';R.reserve(p);before=p.read_bytes()
   with self.assertRaises(FileExistsError):R.reserve(p)
   self.assertEqual(p.read_bytes(),before)
 def test_sanitizer_keeps_codes_not_credentials(self):
  d=R.diagnostic('RELEASE_TOKEN_LIFETIME\npostgresql://admin:secret@host\nBearer abc.def.ghi\n')
  self.assertEqual(d['codes'],['RELEASE_TOKEN_LIFETIME']);self.assertNotIn('secret',json.dumps(d))
 def test_remote_failure_captures_stderr_and_exit_without_deadlock(self):
  class Channel:
   def exit_status_ready(self):return True
   def recv_exit_status(self):return 1
   def close(self):pass
   def shutdown_write(self):pass
  ch=Channel()
  class Stream(io.BytesIO):pass
  stdout=Stream(b'');stdout.channel=ch;stderr=Stream(b'RELEASE_TOKEN_LIFETIME\nprivate detail\n');stdin=io.StringIO();stdin.channel=ch
  ssh=types.SimpleNamespace(exec_command=lambda *a,**kw:(stdin,stdout,stderr))
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'diagnostic.json';out,status=R.remote_run(ssh,'command','{}',5,p)
   self.assertEqual(status,1);receipt=json.loads(p.read_text());self.assertEqual(receipt['stderr']['codes'],['RELEASE_TOKEN_LIFETIME']);self.assertNotIn('private detail',p.read_text())
 def test_channel_failure_is_retained_without_private_exception_text(self):
  def fail(*a,**kw):raise RuntimeError('private password must not be saved')
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'diagnostic.json'
   with self.assertRaisesRegex(ValueError,'REMOTE_CHANNEL_OPEN_FAILED'):R.remote_run(types.SimpleNamespace(exec_command=fail),'command','{}',5,p)
   self.assertEqual(json.loads(p.read_text())['error'],'REMOTE_CHANNEL_OPEN_FAILED');self.assertNotIn('password',p.read_text())
if __name__=='__main__':unittest.main(verbosity=2)
