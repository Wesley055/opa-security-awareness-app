"""Real SSH/SFTP controller transport tests; all privileged operations are inert fixtures.
Runs main(), including staging, credentials-at-handoff, exclusive marker, execution
stdin/stdout/stderr, DB-receipt download, deployment fixture, reconnect, exclusive
deployment-receipt upload and restoration fixture. No Azure or database access.
"""
import pathlib,tempfile,shutil,subprocess,sys,io,json,base64,time,socket,threading,os,importlib.util,types,unittest,contextlib,logging
from unittest.mock import patch
import paramiko
logging.getLogger('paramiko').addHandler(logging.NullHandler())
logging.getLogger('paramiko').propagate=False
ROOT=pathlib.Path('C:/Projects/OPA-release-simplification')
HERE=pathlib.Path(__file__).parent
MODULE=HERE/'execute-release.py' if (HERE/'execute-release.py').exists() else ROOT/'ops/execute-release.py'
spec=importlib.util.spec_from_file_location('loopback',ROOT/'ops/loopback_staging_rehearsal.py');L=importlib.util.module_from_spec(spec);spec.loader.exec_module(L)
T=L.T;real_run=subprocess.run
def jwt(resource='https://management.azure.com/',remaining=1564):return 'h.'+base64.urlsafe_b64encode(json.dumps({'exp':int(time.time()+remaining),'oid':'fixture-operator','tid':'adb3fb59-1ac3-42c2-b39a-d70c7006ccbc','aud':resource,'iss':'https://sts.windows.net/adb3fb59-1ac3-42c2-b39a-d70c7006ccbc/','ver':'1.0'}).encode()).decode().rstrip('=')+'.fixture'
class Handle(paramiko.SFTPHandle):
 def __init__(self,flags,backend,path):super().__init__(flags);self.backend=backend;self.path=path
 def write(self,offset,data):
  fault=self.backend.fault if self.path.endswith('privileged-attempt.json') else None
  if fault in ('partial','disconnect'):
   self.writefile.seek(offset);self.writefile.write(data[:max(1,len(data)//2)]);self.writefile.flush()
   if fault=='disconnect':self.backend.transport.close()
   return paramiko.SFTP_FAILURE
  result=super().write(offset,data)
  if fault=='corrupt':self.writefile.seek(0);self.writefile.write(b'!');self.writefile.flush()
  return result
 def close(self):self.backend.events.append(('closed',self.path));return super().close()
class SFTP(L.SFTP):
 def open(self,path,flags,attr):
  self.backend.events.append(('open',path,flags))
  if path.endswith('privileged-attempt.json') and self.backend.fault=='permission':return paramiko.SFTP_PERMISSION_DENIED
  if path.endswith('.operator-deployment-receipt.json') and self.backend.fault=='receipt_permission':return paramiko.SFTP_PERMISSION_DENIED
  try:
   fd=os.open(self.backend.path(path),flags|os.O_BINARY,0o600)
   mode='r+b' if flags&os.O_RDWR else 'wb' if flags&os.O_WRONLY else 'rb';stream=os.fdopen(fd,mode)
   handle=Handle(flags,self.backend,path)
   if not flags&os.O_WRONLY:handle.readfile=stream
   if flags&(os.O_WRONLY|os.O_RDWR):handle.writefile=stream;self.backend.uploads.append(path)
   return handle
  except OSError as e:return paramiko.SFTPServer.convert_errno(e.errno)
class Server(L.Server):
 def check_auth_password(self,user,password):return paramiko.AUTH_SUCCESSFUL if (user,password)==('root','Docker!') else paramiko.AUTH_FAILED
 def check_channel_exec_request(self,channel,command):
  text=command.decode()
  if 'ops/release-session.cjs --migrate' not in text and 'ops/release-restore.cjs' not in text:return super().check_channel_exec_request(channel,command)
  def execute():
   try:
    data=bytearray()
    while True:
     chunk=channel.recv(4096)
     if not chunk:break
     data.extend(chunk)
    credentials=json.loads(data);assert credentials['OPA_RELEASE_ARM_TOKEN'].endswith('.fixture')
    self.backend.executions.append(text);parts=text.split();remote=parts[1];approved=parts[-1] if '--migrate' in text else parts[-2]
    env=json.loads(self.backend.path(remote+'/owner-release.signed.json').read_bytes());m=json.loads(base64.b64decode(env['payload']));rid=m['releaseId']
    approved=self.backend.approved
    if self.backend.fail_execution or (self.backend.fail_restoration and '--migrate' not in text):
     channel.sendall_stderr(b'FIXTURE_EXECUTION_FAILED\npostgresql://private:must-not-log@host\n');channel.send_exit_status(1);return
    if '--migrate' in text:
     # Synthetic receipt ONLY: no SQL is executed and no real schema claim is made.
     receipt={'status':'migration-phase-complete','manifestSHA256':approved,'activeMigrations':42,'cleanupRequired':False,'fixtureOnly':True}
     if not self.backend.skip_database_receipt:self.backend.path(remote+'/'+rid+'.database-phase-receipt.json').write_text(json.dumps(receipt))
     result={'status':'migration-phase-complete','manifestSHA256':approved}
    else:result={'status':'writers-restored','manifestSHA256':approved,'fixtureOnly':True}
    channel.sendall(json.dumps(result).encode()+b'\n');channel.sendall_stderr(b'FIXTURE_HANDOFF_ACCEPTED\n');channel.send_exit_status(0)
   except Exception:channel.sendall_stderr(b'FIXTURE_RUNNER_FAILED\n');channel.send_exit_status(1)
   finally:channel.close()
  threading.Thread(target=execute,daemon=True).start();return True
class Tunnel:
 def __init__(self,backend,port,key):
  self.backend=backend;self.transports=[];self.stopped=False;self.listener=socket.socket();self.listener.bind(('127.0.0.1',port));self.listener.listen(4);self.listener.settimeout(.5);self.port=self.listener.getsockname()[1]
  def accept():
   while not self.stopped:
    try:
     conn,_=self.listener.accept();transport=paramiko.Transport(conn);self.transports.append(transport);backend.transport=transport;transport.add_server_key(key);transport.set_subsystem_handler('sftp',paramiko.SFTPServer,SFTP,backend=backend);transport.start_server(server=Server(backend))
     while transport.is_active() and not self.stopped:time.sleep(.01)
    except (EOFError,OSError,paramiko.SSHException):continue
  self.thread=threading.Thread(target=accept,daemon=True);self.thread.start()
 def poll(self):return None
 def terminate(self):
  self.stopped=True
  for t in self.transports:t.close()
  self.listener.close()
 def wait(self,timeout=15):self.thread.join(timeout);return 0
 def kill(self):self.terminate()
class ControllerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=pathlib.Path(self.temp.name);self.root=self.base/'checkout';(self.root/'ops').mkdir(parents=True)
  for folder in ('ops/production','packages/environment-policy'):shutil.copytree(ROOT/folder,self.root/folder)
  for name in ('execute-release.py','release-session.cjs','release-deploy.cjs','release-restore.cjs'):
   shutil.copyfile(MODULE if name=='execute-release.py' else ROOT/'ops'/name,self.root/'ops'/name)
  self.credentials={'OPA_RELEASE_ARM_TOKEN':jwt(),'OPA_RELEASE_VAULT_TOKEN':jwt('https://vault.azure.net'),'OPA_RELEASE_SCM_AUTHORIZATION':'Basic fixture','OPA_RELEASE_ADMIN_DATABASE_URL':'postgresql://fixture-only'}
  self.write_provider()
  spec=importlib.util.spec_from_file_location('test_controller',self.root/'ops/execute-release.py');self.R=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.R)
  self.backend=T.LocalSSH(self.base/'host');self.backend.root.mkdir();self.backend.fault=None;self.backend.fail_execution=False;self.backend.fail_restoration=False;self.backend.skip_database_receipt=False;self.backend.executions=[];self.backend.events=[];self.deploy_status='deployment-phase-complete'
  self.key=paramiko.RSAKey.generate(2048);self.tunnels=[];self.clients=[]
  self.bundle=self.base/'bundle';self.bundle.mkdir();self.file=self.bundle/'owner.signed.json';self.source='/home/opa-releases/prior';self.remote='/home/opa-releases/fresh'
  self.backend.path(self.source).mkdir(parents=True)
  artifacts={}
  for n in range(9):
   content=(str(n)*8192).encode();name=f'artifact-{n}.bin';(self.bundle/name).write_bytes(content);self.backend.path(self.source+'/'+name).write_bytes(content);artifacts[str(n)]={'path':name,'sha256':self.R.sha(content)}
  now=self.R.datetime.datetime.now(self.R.datetime.timezone.utc);iso=lambda d:d.isoformat()
  tools=['ops/execute-release.py','ops/release-session.cjs','ops/release-deploy.cjs','ops/release-operator-input.py','ops/release-restore.cjs']
  self.m={'operatorObjectId':'fixture-operator','releaseId':'fresh','maintenance':{'start':iso(now-self.R.datetime.timedelta(minutes=5)),'end':iso(now+self.R.datetime.timedelta(minutes=30))},'executionTimeoutSeconds':60,'executionHostSshKeySHA256':base64.b64encode(__import__('hashlib').sha256(self.key.asbytes()).digest()).decode().rstrip('='),'executionTools':{p:self.R.sha((self.root/p).read_bytes()) for p in tools},'stagedArtifactSource':self.source,'artifacts':artifacts,'operatorCredentialBindings':{}}
  backup=json.dumps({'approvalId':'fresh'}).encode();(self.bundle/'backup.json').write_bytes(backup)
  self.m['artifacts'].pop('8');self.m['artifacts']['backup']={'path':'backup.json','sha256':self.R.sha(backup)}
  self.m['migration']={'approvalId':'fresh','backupSha256':self.R.sha(backup),'action':'MIGRATE_OPA_PRODUCTION'}
  self.write_manifest()
 def write_provider(self,remaining=1564,fail_refresh=False):
  data=dict(self.credentials);data['OPA_RELEASE_ARM_TOKEN']=jwt(remaining=remaining);data['OPA_RELEASE_VAULT_TOKEN']=jwt('https://vault.azure.net',remaining)
  code="import importlib.util,json,base64,pathlib\n"+"s=importlib.util.spec_from_file_location('real_provider',"+repr(str(ROOT/'ops/release-operator-input.py'))+");P=importlib.util.module_from_spec(s);s.loader.exec_module(P)\n"+"def credentials(file,*args):\n m=json.loads(base64.b64decode(json.loads(pathlib.Path(file).read_bytes())['payload']));values="+repr(data)+";refreshed=[]\n def refresh(resource):\n  if "+repr(fail_refresh)+":raise ValueError('RELEASE_TOKEN_REFRESH_REJECTED')\n  refreshed.append(resource);return "+repr({})+".get(resource) or 'h.'+base64.urlsafe_b64encode(json.dumps({'oid':'fixture-operator','tid':P.TENANT,'aud':resource,'exp':int(P.time.time())+3600,'iss':'https://sts.windows.net/'+P.TENANT+'/','ver':'1.0'}).encode()).decode().rstrip('=')+'.fixture'\n for name,resource in [('OPA_RELEASE_ARM_TOKEN',P.ARM),('OPA_RELEASE_VAULT_TOKEN',P.VAULT)]:\n  cached=values[name];values[name]=P.fresh_token(m,resource,lambda a:{'accessToken':cached},refresh=refresh,signature_verifier=lambda *args:None)\n pathlib.Path(file).with_name('fixture-token-validation.json').write_text(json.dumps({'refreshedResources':refreshed,'usable':True}))\n return values\n"
  (self.root/'ops/release-operator-input.py').write_text(code)
 def write_manifest(self):
  self.file.write_text(json.dumps({'payload':base64.b64encode(json.dumps(self.m).encode()).decode(),'signature':'INERT_TEST_FIXTURE'}));self.approved=self.R.sha(self.file.read_bytes());self.backend.approved=self.approved
 def tearDown(self):
  for c in self.clients:c.close()
  for t in self.tunnels:t.terminate();t.wait(2)
  self.temp.cleanup()
 def connect(self):
  t=Tunnel(self.backend,0,self.key);self.tunnels.append(t);c=paramiko.SSHClient();c.get_host_keys().add('[127.0.0.1]:'+str(t.port),self.key.get_name(),self.key);c.connect('127.0.0.1',port=t.port,username='root',password='Docker!',look_for_keys=False,allow_agent=False,timeout=10);self.clients.append(c);return c
 def main(self):
  def popen(args,**kw):
   assert args[1:3]==['webapp','create-remote-connection'];t=Tunnel(self.backend,int(args[args.index('--port')+1]),self.key);self.tunnels.append(t);return t
  def run(args,**kw):
   if len(args)>1 and str(args[1]).replace('\\','/').endswith('ops/production/cutover.cjs'):
    # Isolated controller fixture; no production key or signing operation.
    return subprocess.CompletedProcess(args,0,'{"status":"fixture-verified"}','')
   if len(args)>1 and str(args[1]).replace('\\','/').endswith('ops/release-deploy.cjs'):
    p=self.bundle/(self.m['releaseId']+'.cutover-receipt.json');p.write_text(json.dumps({'manifestSHA256':self.approved,'status':self.deploy_status,'fixtureOnly':True}));return subprocess.CompletedProcess(args,0,'','FIXTURE_DEPLOYMENT\n')
   return real_run(args,**kw)
  with patch.object(self.R.subprocess,'Popen',side_effect=popen),patch.object(self.R.subprocess,'run',side_effect=run),patch.object(self.R.sys,'argv',['execute-release.py',str(self.file),self.approved]),patch.dict(os.environ,{'OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256':self.approved,'OPA_RELEASE_NODE':T.NODE}):
   # Node subprocesses use Popen internally; only intercept Azure tunnel Popen.
   original=__import__('subprocess').Popen
   def tunnel_or_process(args,**kw):
    if len(args)>2 and args[1:3]==['webapp','create-remote-connection']:return popen(args,**kw)
    return REAL_POPEN(args,**kw)
   output=io.StringIO()
   with patch.object(self.R.subprocess,'Popen',side_effect=tunnel_or_process),contextlib.redirect_stdout(output):self.R.main()
   self.controllerOutput=output.getvalue()
 def test_approval_mismatch_rejected_before_attempt_or_ssh(self):
  self.m['migration']['approvalId']='historical'
  self.write_manifest()
  with self.assertRaisesRegex(ValueError,'LOCAL_OPERATOR_APPROVAL'):self.main()
  self.assertFalse((self.bundle/'fresh.attempt.json').exists());self.assertEqual(self.backend.executions,[]);self.assertEqual(self.tunnels,[])
 def test_backup_approval_mismatch_rejected_before_attempt_or_ssh(self):
  raw=json.dumps({'approvalId':'historical'}).encode();(self.bundle/'backup.json').write_bytes(raw)
  self.m['artifacts']['backup']['sha256']=self.R.sha(raw);self.m['migration']['backupSha256']=self.R.sha(raw);self.write_manifest()
  with self.assertRaisesRegex(ValueError,'LOCAL_OPERATOR_APPROVAL'):self.main()
  self.assertFalse((self.bundle/'fresh.attempt.json').exists());self.assertEqual(self.tunnels,[])
 def test_backup_hash_mismatch_rejected_before_attempt_or_ssh(self):
  self.m['migration']['backupSha256']='0'*64;self.write_manifest()
  with self.assertRaisesRegex(ValueError,'LOCAL_BACKUP_HASH_BINDING'):self.main()
  self.assertFalse((self.bundle/'fresh.attempt.json').exists());self.assertEqual(self.tunnels,[])
 def test_fresh_backup_uploaded_without_historical_source_backup(self):
  self.assertFalse(self.backend.path(self.source+'/backup.json').exists())
  self.main();self.assertEqual(self.backend.path(self.remote+'/backup.json').read_bytes(),(self.bundle/'backup.json').read_bytes())
 def test_complete_controller_main_real_transport_to_fixture_execution_and_restore(self):
  self.main();self.assertEqual(len(self.backend.executions),2)
  marker=self.backend.path(self.remote+'/privileged-attempt.json');self.assertEqual(json.loads(marker.read_text())['manifestSHA256'],self.approved)
  self.assertTrue(self.backend.path(self.remote+'/'+self.m['releaseId']+'.operator-deployment-receipt.json').exists())
  self.assertEqual(json.loads((self.bundle/(self.m['releaseId']+'.writer-restoration-receipt.json')).read_text())['status'],'writers-restored')
  opens=[e for e in self.backend.events if e[0]=='open' and e[1].endswith('privileged-attempt.json')];flags=opens[0][2];self.assertTrue(flags&os.O_WRONLY and flags&os.O_EXCL and flags&os.O_CREAT)
  self.assertIn(('closed',str(self.remote+'/privileged-attempt.json')),self.backend.events)
  before=marker.read_bytes()
  with self.assertRaises(ValueError):self.main()
  self.assertEqual(len(self.backend.executions),2);self.assertEqual(marker.read_bytes(),before)
 def test_duplicate_marker_atomic_race_one_winner(self):
  self.backend.path(self.remote).mkdir(parents=True);clients=[self.connect(),self.connect()];results=[];barrier=threading.Barrier(2)
  def write(i):
   barrier.wait()
   try:self.R.exclusive_sftp_write(clients[i],self.remote+'/privileged-attempt.json',str(i).encode(),self.bundle/f'race-{i}.json');results.append('ok')
   except ValueError:results.append('rejected')
  threads=[threading.Thread(target=write,args=(i,)) for i in range(2)]
  for t in threads:t.start()
  for t in threads:t.join(15)
  self.assertEqual(sorted(results),['ok','rejected'])
 def test_partial_marker_and_reconnect_do_not_allow_reuse(self):
  c=self.connect();self.backend.path(self.remote).mkdir(parents=True);self.backend.fault='partial'
  with self.assertRaises(ValueError):self.R.migration_handoff(c,self.remote,self.file,self.approved,self.m,self.credentials)
  marker=self.backend.path(self.remote+'/privileged-attempt.json');before=marker.read_bytes();self.assertGreater(len(before),0);self.assertEqual(self.backend.executions,[])
  self.backend.fault=None;c=self.connect()
  with self.assertRaises(ValueError):self.R.exclusive_sftp_write(c,self.remote+'/privileged-attempt.json',b'new',self.bundle/'reconnect.json')
  self.assertEqual(marker.read_bytes(),before);self.assertEqual(self.backend.executions,[])
 def test_connection_loss_preserves_partial_marker_and_blocks_handoff(self):
  c=self.connect();self.backend.path(self.remote).mkdir(parents=True);self.backend.fault='disconnect'
  with self.assertRaises(ValueError):self.R.migration_handoff(c,self.remote,self.file,self.approved,self.m,self.credentials)
  self.assertTrue(self.backend.path(self.remote+'/privileged-attempt.json').exists());self.assertEqual(self.backend.executions,[])
  receipt=json.loads((self.bundle/'fresh.attempt-marker-diagnostic.json').read_text());self.assertFalse(receipt['handoffInvokedByThisCall'])
 def test_permissions_failure_in_main_never_hands_off(self):
  self.backend.fault='permission'
  with self.assertRaisesRegex(ValueError,'SFTP_EXCLUSIVE_WRITE_FAILED'):self.main()
  self.assertEqual(self.backend.executions,[]);self.assertTrue((self.bundle/'fresh.attempt.json').exists());self.assertFalse(self.backend.path(self.remote+'/privileged-attempt.json').exists())
 def test_readback_tampering_stops_before_handoff(self):
  c=self.connect();self.backend.path(self.remote).mkdir(parents=True);self.backend.fault='corrupt'
  with self.assertRaisesRegex(ValueError,'SFTP_EXCLUSIVE_READBACK_FAILED'):self.R.migration_handoff(c,self.remote,self.file,self.approved,self.m,self.credentials)
  self.assertEqual(self.backend.executions,[])
 def test_failed_remote_execution_main_retains_sanitized_receipt(self):
  self.backend.fail_execution=True
  with self.assertRaisesRegex(ValueError,'REMOTE_DATABASE_PHASE_FAILED'):self.main()
  receipt=(self.bundle/'fresh.remote-database-diagnostic.json').read_text();self.assertIn('FIXTURE_EXECUTION_FAILED',receipt);self.assertNotIn('must-not-log',receipt);self.assertEqual(len(self.backend.executions),1)
 def test_safe_recovery_requires_fresh_attempt_directory(self):
  c=self.connect();self.backend.path(self.remote).mkdir(parents=True);self.backend.fault='partial'
  with self.assertRaises(ValueError):self.R.exclusive_sftp_write(c,self.remote+'/privileged-attempt.json',b'original',self.bundle/'failure.json')
  before=self.backend.path(self.remote+'/privileged-attempt.json').read_bytes();self.backend.fault=None;fresh='/home/opa-releases/fresh-recovery';self.backend.path(fresh).mkdir(parents=True)
  self.R.exclusive_sftp_write(c,fresh+'/privileged-attempt.json',b'new-attempt',self.bundle/'new.json');self.assertEqual(self.backend.path(self.remote+'/privileged-attempt.json').read_bytes(),before)
 def test_old_paramiko_x_mode_reproduces_defect(self):
  c=self.connect();self.backend.path(self.remote).mkdir(parents=True)
  with c.open_sftp() as sftp:
   with sftp.open(self.remote+'/old-mode.json','x') as f:
    with self.assertRaisesRegex(OSError,'not open for writing'):f.write(b'fixture')
 def test_rollback_fixture_still_exercises_receipt_upload_and_restore(self):
  self.deploy_status='rolled-back';self.main();self.assertEqual(len(self.backend.executions),2);self.assertEqual(json.loads(self.controllerOutput)['status'],'rolled-back')
 def test_failed_deployment_fixture_never_restores_writers(self):
  self.deploy_status='failed'
  with self.assertRaisesRegex(ValueError,'DEPLOYMENT_FAILED_WRITERS_REMAIN_FENCED'):self.main()
  self.assertEqual(len(self.backend.executions),1)
 def test_deployment_receipt_permission_failure_stops_before_restoration(self):
  self.backend.fault='receipt_permission'
  with self.assertRaisesRegex(ValueError,'SFTP_EXCLUSIVE_WRITE_FAILED'):self.main()
  self.assertEqual(len(self.backend.executions),1);self.assertTrue((self.bundle/'fresh.deployment-receipt-upload-diagnostic.json').exists());self.assertTrue((self.bundle/'fresh.controller-failure.json').exists())
 def test_missing_database_receipt_stops_before_deployment_with_evidence(self):
  self.backend.skip_database_receipt=True
  with self.assertRaises(OSError):self.main()
  self.assertFalse((self.bundle/'fresh.cutover-receipt.json').exists());self.assertEqual(len(self.backend.executions),1)
  receipt=json.loads((self.bundle/'fresh.controller-failure.json').read_text());self.assertFalse(receipt['retryPermitted']);self.assertIn(receipt['exceptionType'],('FileNotFoundError','OSError'))
 def test_restoration_failure_retains_diagnostics_without_success_claim(self):
  self.backend.fail_restoration=True
  with self.assertRaisesRegex(ValueError,'RESTORATION_FAILED_CHECK_MAINTENANCE_RECEIPT'):self.main()
  self.assertFalse((self.bundle/'fresh.writer-restoration-receipt.json').exists());self.assertTrue((self.bundle/'fresh.remote-restoration-diagnostic.json').exists())
 def test_token_expired_during_staging_is_refreshed_before_handoff(self):
  self.write_provider(remaining=-1);self.m['executionTools']['ops/release-operator-input.py']=self.R.sha((self.root/'ops/release-operator-input.py').read_bytes());self.write_manifest();self.main()
  receipt=json.loads((self.bundle/'fixture-token-validation.json').read_text());self.assertEqual(len(receipt['refreshedResources']),2);self.assertEqual(len(self.backend.executions),2)
 def test_fresh_credentials_unavailable_blocks_handoff_after_staging(self):
  self.write_provider(remaining=-1,fail_refresh=True);self.m['executionTools']['ops/release-operator-input.py']=self.R.sha((self.root/'ops/release-operator-input.py').read_bytes());self.write_manifest()
  with self.assertRaisesRegex(ValueError,'RELEASE_TOKEN_REFRESH_REJECTED'):self.main()
  self.assertTrue(self.backend.path(self.remote+'/owner-release.signed.json').exists());self.assertEqual(self.backend.executions,[]);self.assertFalse(self.backend.path(self.remote+'/privileged-attempt.json').exists())
REAL_POPEN=subprocess.Popen
if __name__=='__main__':unittest.main(verbosity=2)
