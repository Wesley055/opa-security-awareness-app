"""Integrated local staging transport: real files, real Node hash/copy subprocesses.

No Azure, credentials, database or deployment calls. Exercises the same stage_release
function called by the production controller; only SSH/SFTP transport is adapted.
"""
import pathlib,tempfile,shutil,subprocess,shlex,io,json,base64,unittest,importlib.util,sys,types,os
ROOT=pathlib.Path(__file__).resolve().parent.parent if pathlib.Path(__file__).parent.name=='ops' else pathlib.Path('C:/Projects/OPA-release-simplification')
MODULE=pathlib.Path(__file__).with_name('execute-release.py')
spec=importlib.util.spec_from_file_location('controller',MODULE);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
NODE='C:/Projects/.tools/node-v22.22.0-win-x64/node.exe'
class LocalSFTP:
 def __init__(self,host):self.host=host
 def stat(self,path):return self.host.path(path).stat()
 def mkdir(self,path,mode=0o700):self.host.path(path).mkdir(mode=mode)
 def chmod(self,path,mode):self.host.path(path).chmod(mode)
 def put(self,source,dest):
  if self.host.fail_upload:raise OSError('postgresql://admin:private@host must never persist')
  shutil.copyfile(source,self.host.path(dest));self.host.uploads.append(dest)
 def close(self):pass
class LocalSSH:
 def __init__(self,root):self.root=root;self.uploads=[];self.copies=[];self.hashes=[];self.fail_copy=False;self.fail_upload=False;self.corrupt_copy=False
 def path(self,value):
  p=pathlib.PurePosixPath(value)
  assert p.is_absolute() and '..' not in p.parts
  return self.root.joinpath(*p.parts[1:])
 def open_sftp(self):return LocalSFTP(self)
 def exec_command(self,command,timeout=120):
  words=shlex.split(command)
  if words[0]=='node':
   self.hashes.append(words[-1]);args=[NODE,*words[1:-1],str(self.path(words[-1]))]
  elif words[:2]==['cp','--']:
   self.copies.append((words[2],words[3]));assert self.uploads,'metadata upload must precede copying'
   if self.fail_copy:return self.result(1,b'',b'private provider detail')
   args=[NODE,'-e',"require('fs').copyFileSync(process.argv[1],process.argv[2])",str(self.path(words[2])),str(self.path(words[3]))]
  else:raise AssertionError('Only staging hash and copy commands allowed: '+command)
  p=subprocess.run(args,capture_output=True,timeout=timeout)
  if words[0]=='cp' and self.corrupt_copy:self.path(words[3]).write_bytes(b'tampered')
  return self.result(p.returncode,p.stdout,p.stderr)
 @staticmethod
 def result(status,output,error):
  channel=types.SimpleNamespace(recv_exit_status=lambda:status)
  out=io.BytesIO(output);out.channel=channel;err=io.BytesIO(error);err.channel=channel
  return None,out,err
class Integrated(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=pathlib.Path(self.temp.name);self.host=LocalSSH(self.base/'remote');self.host.root.mkdir()
  self.source='/home/opa-releases/previous';self.dest='/home/opa-releases/next'
  self.host.path(self.source).mkdir(parents=True)
  self.file=self.base/'owner.signed.json';self.file.write_text('{"synthetic":"envelope; staging never executes it"}')
  artifacts={}
  for n in range(9):
   data=(str(n)*4096).encode();name=f'artifact-{n}.bin';self.host.path(self.source+'/'+name).write_bytes(data);artifacts[str(n)]={'path':name,'sha256':R.sha(data)}
  self.m={'stagedArtifactSource':self.source,'artifacts':artifacts}
  self.receipt=self.base/'staging-diagnostic.json'
 def tearDown(self):self.temp.cleanup()
 def stage(self):R.stage_release(self.host,ROOT,self.file,self.m,self.dest,self.receipt)
 def assert_failure(self,code):
  receipt=json.loads(self.receipt.read_text());self.assertEqual(receipt['error'],code);self.assertFalse(receipt['privilegedExecutionStarted']);self.assertNotIn('private',self.receipt.read_text());self.assertFalse(self.host.path(self.dest+'/owner-release.signed.json').exists())
 def test_metadata_then_nine_actual_copies_and_hashes_and_owner(self):
  self.stage();self.assertGreater(len(self.host.uploads),2);self.assertEqual(len(self.host.copies),9);self.assertEqual(len(self.host.hashes),18)
  for a in self.m['artifacts'].values():self.assertEqual(R.sha(self.host.path(self.dest+'/'+a['path']).read_bytes()),a['sha256'])
  self.assertEqual(self.host.path(self.dest+'/owner-release.signed.json').read_bytes(),self.file.read_bytes());self.assertFalse(self.receipt.exists())
 def test_source_overwritten_by_metadata_loop_is_detected_by_integrated_path(self):
  # Reintroduce the exact class of retry1 defect into the real sequence.
  text=MODULE.read_text();text=text.replace("for metadata_file in sorted((root/folder).iterdir()):", "for metadata_file in sorted((root/folder).iterdir()):\n                    staged_source=metadata_file")
  namespace={'__name__':'mutation','__file__':str(MODULE)};exec(compile(text,str(MODULE),'exec'),namespace)
  with self.assertRaisesRegex(ValueError,'STAGED_SOURCE_BINDING_REQUIRED'):namespace['stage_release'](self.host,ROOT,self.file,self.m,self.dest,self.receipt)
  self.assertGreater(len(self.host.uploads),0);self.assertEqual(self.host.copies,[]);self.assert_failure('STAGED_SOURCE_BINDING_REQUIRED')
 def test_missing_remote_source_is_fail_closed(self):
  self.host.path(self.source+'/artifact-0.bin').unlink()
  with self.assertRaisesRegex(ValueError,'STAGED_ARTIFACT_HASH_FAILED'):self.stage()
  self.assertEqual(self.host.uploads,[]);self.assert_failure('STAGED_ARTIFACT_HASH_FAILED')
 def test_invalid_source_binding_is_fail_closed(self):
  for value in ('',None,'/tmp/not-approved',pathlib.Path(self.source)):
   self.m['stagedArtifactSource']=value;self.receipt=self.base/('invalid-'+str(len(str(value)))+'.json')
   with self.assertRaisesRegex(ValueError,'STAGED_SOURCE_BINDING_REQUIRED'):self.stage()
   self.assert_failure('STAGED_SOURCE_BINDING_REQUIRED')
 def test_copy_failure_after_metadata_retains_sanitized_receipt(self):
  self.host.fail_copy=True
  with self.assertRaisesRegex(ValueError,'STAGED_COPY_FAILED'):self.stage()
  self.assertGreater(len(self.host.uploads),0);self.assert_failure('STAGED_COPY_FAILED')
 def test_changed_destination_rejected_after_actual_copy(self):
  self.host.corrupt_copy=True
  with self.assertRaisesRegex(ValueError,'STAGED_ARTIFACT_CHANGED'):self.stage()
  self.assertEqual(len(self.host.copies),1);self.assert_failure('STAGED_ARTIFACT_CHANGED')
 def test_metadata_upload_failure_sanitizes_exception(self):
  self.host.fail_upload=True
  with self.assertRaises(OSError):self.stage()
  self.assertEqual(self.host.copies,[]);self.assert_failure('STAGING_FAILED')
 def test_duplicate_remote_attempt_rejected_without_overwrite(self):
  self.stage();before=self.host.path(self.dest+'/owner-release.signed.json').read_bytes();copies=len(self.host.copies)
  with self.assertRaisesRegex(ValueError,'HISTORICAL_REMOTE_RELEASE_EXISTS'):self.stage()
  self.assertEqual(len(self.host.copies),copies);self.assertEqual(self.host.path(self.dest+'/owner-release.signed.json').read_bytes(),before)
  self.assertEqual(json.loads(self.receipt.read_text())['error'],'HISTORICAL_REMOTE_RELEASE_EXISTS')
def rehearsal(manifest_file,output):
 """Use all nine full accepted files, not synthetic test fixtures."""
 manifest_file=pathlib.Path(manifest_file);m=json.loads(base64.b64decode(json.loads(manifest_file.read_bytes())['payload']))
 original=m['stagedArtifactSource'];m['stagedArtifactSource']='/home/opa-releases/rehearsal-source'
 with tempfile.TemporaryDirectory() as directory:
  host=LocalSSH(pathlib.Path(directory)/'host');host.root.mkdir();host.path(m['stagedArtifactSource']).mkdir(parents=True)
  for a in m['artifacts'].values():
   source=manifest_file.parent/a['path'];assert R.sha(source.read_bytes())==a['sha256'];shutil.copyfile(source,host.path(m['stagedArtifactSource']+'/'+a['path']))
  destination='/home/opa-releases/rehearsal-new';receipt=pathlib.Path(directory)/'failure.json'
  R.stage_release(host,ROOT,manifest_file,m,destination,receipt)
  for a in m['artifacts'].values():assert R.sha(host.path(destination+'/'+a['path']).read_bytes())==a['sha256']
  assert host.path(destination+'/owner-release.signed.json').read_bytes()==manifest_file.read_bytes()
  assert len(host.copies)==9 and len(host.hashes)==18
  evidence={'status':'PASS_LOCAL_END_TO_END_STAGING','realAcceptedArtifactCount':9,'bytesCopied':sum((manifest_file.parent/a['path']).stat().st_size for a in m['artifacts'].values()),'metadataUploads':len(host.uploads)-1,'realCopySubprocesses':len(host.copies),'realHashSubprocesses':len(host.hashes),'controllerSHA256':R.sha(MODULE.read_bytes()),'sourceProductionDirectoryReference':original,'transport':'Isolated local filesystem SSH/SFTP adapter; actual Node copy/hash subprocesses; no mocked copy or hash result','productionAcceptance':False,'productionAccessed':False}
  pathlib.Path(output).write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--rehearse':rehearsal(sys.argv[2],sys.argv[3])
 else:unittest.main(verbosity=2)
