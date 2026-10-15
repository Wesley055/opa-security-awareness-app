"""Disposable loopback SSH/SFTP rehearsal. No Azure, release credentials or DB access."""
import pathlib,sys,json,base64,tempfile,shutil,socket,threading,time,os,stat,importlib.util,paramiko,io
ROOT=pathlib.Path('C:/Projects/OPA-release-simplification')
spec=importlib.util.spec_from_file_location('integrated',ROOT/'ops/test_staging_reuse.py');T=importlib.util.module_from_spec(spec);spec.loader.exec_module(T)
R=T.R
class SFTP(paramiko.SFTPServerInterface):
 def __init__(self,server,*args,backend=None,**kw):super().__init__(server,*args,**kw);self.backend=backend
 def stat(self,path):
  try:return paramiko.SFTPAttributes.from_stat(self.backend.path(path).stat())
  except OSError as e:return paramiko.SFTPServer.convert_errno(e.errno)
 lstat=stat
 def mkdir(self,path,attr):
  try:self.backend.path(path).mkdir();return paramiko.SFTP_OK
  except OSError as e:return paramiko.SFTPServer.convert_errno(e.errno)
 def chattr(self,path,attr):
  try:
   if attr.st_mode is not None:self.backend.path(path).chmod(attr.st_mode)
   return paramiko.SFTP_OK
  except OSError as e:return paramiko.SFTPServer.convert_errno(e.errno)
 def open(self,path,flags,attr):
  try:
   target=self.backend.path(path);fd=os.open(target,flags|os.O_BINARY,0o600)
   mode='r+b' if flags&os.O_RDWR else 'wb' if flags&os.O_WRONLY else 'rb'
   stream=os.fdopen(fd,mode);handle=paramiko.SFTPHandle(flags)
   if not flags&os.O_WRONLY:handle.readfile=stream
   if flags&(os.O_WRONLY|os.O_RDWR):handle.writefile=stream;self.backend.uploads.append(path)
   return handle
  except OSError as e:return paramiko.SFTPServer.convert_errno(e.errno)
class Server(paramiko.ServerInterface):
 def __init__(self,backend):self.backend=backend
 def check_auth_password(self,user,password):return paramiko.AUTH_SUCCESSFUL if user=='rehearsal' and password=='synthetic-only' else paramiko.AUTH_FAILED
 def get_allowed_auths(self,user):return 'password'
 def check_channel_request(self,kind,channel):return paramiko.OPEN_SUCCEEDED if kind=='session' else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
 def check_channel_exec_request(self,channel,command):
  def run():
   try:
    _,out,err=self.backend.exec_command(command.decode());channel.sendall(out.read());channel.sendall_stderr(err.read());channel.send_exit_status(out.channel.recv_exit_status())
   except Exception:channel.sendall_stderr(b'LOCAL_REHEARSAL_TRANSPORT_FAILURE\n');channel.send_exit_status(1)
   finally:channel.close()
  threading.Thread(target=run,daemon=True).start();return True
def main():
 manifest=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);m=json.loads(base64.b64decode(json.loads(manifest.read_bytes())['payload']))
 with tempfile.TemporaryDirectory() as directory:
  backend=T.LocalSSH(pathlib.Path(directory)/'host');backend.root.mkdir();source='/home/opa-releases/rehearsal-source';dest='/home/opa-releases/rehearsal-next';backend.path(source).mkdir(parents=True)
  for a in m['artifacts'].values():
   p=manifest.parent/a['path'];assert R.sha(p.read_bytes())==a['sha256'];shutil.copyfile(p,backend.path(source+'/'+a['path']))
  m['stagedArtifactSource']=source
  listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);port=listener.getsockname()[1]
  # Ephemeral SSH test host key only, memory-only; unrelated to OPA signing authority.
  hostkey=paramiko.RSAKey.generate(2048);transports=[]
  def accept():
   conn,_=listener.accept();transport=paramiko.Transport(conn);transports.append(transport);transport.add_server_key(hostkey);transport.set_subsystem_handler('sftp',paramiko.SFTPServer,SFTP,backend=backend);transport.start_server(server=Server(backend))
   while transport.is_active():time.sleep(.05)
  thread=threading.Thread(target=accept,daemon=True);thread.start()
  client=paramiko.SSHClient();client.get_host_keys().add('[127.0.0.1]:'+str(port),hostkey.get_name(),hostkey)
  client.connect('127.0.0.1',port=port,username='rehearsal',password='synthetic-only',look_for_keys=False,allow_agent=False,timeout=15)
  start=time.monotonic();failure=pathlib.Path(directory)/'staging-diagnostic.json'
  try:
   R.stage_release(client,ROOT,manifest,m,dest,failure)
   for a in m['artifacts'].values():assert R.sha(backend.path(dest+'/'+a['path']).read_bytes())==a['sha256']
   assert backend.path(dest+'/owner-release.signed.json').read_bytes()==manifest.read_bytes()
   assert len(backend.copies)==9 and len(backend.hashes)==18
   copies=len(backend.copies)
   try:R.stage_release(client,ROOT,manifest,m,dest,failure);raise AssertionError('DUPLICATE_ACCEPTED')
   except ValueError as e:assert str(e)=='HISTORICAL_REMOTE_RELEASE_EXISTS'
   assert len(backend.copies)==copies
   assert json.loads(failure.read_text())['error']=='HISTORICAL_REMOTE_RELEASE_EXISTS'
   receipt={'status':'PASS_REAL_LOOPBACK_SSH_SFTP_STAGING','artifactCount':9,'artifactSHA256':{k:a['sha256'] for k,a in m['artifacts'].items()},'bytesCopied':sum((manifest.parent/a['path']).stat().st_size for a in m['artifacts'].values()),'metadataUploadCount':len(backend.uploads)-1,'realCopySubprocesses':9,'realHashSubprocesses':len(backend.hashes),'duplicateAttemptRejected':True,'sanitizedFailureReceiptVerified':True,'controllerSHA256':R.sha((ROOT/'ops/execute-release.py').read_bytes()),'elapsedSeconds':round(time.monotonic()-start,2),'transport':'Real Paramiko client/server over loopback; real SFTP metadata upload; real Node copy/hash subprocesses','productionAccessed':False,'productionAcceptance':False}
   with output.open('x') as f:json.dump(receipt,f,indent=2)
   print(json.dumps(receipt))
  finally:
   client.close()
   for t in transports:t.close()
   listener.close();thread.join(2)
if __name__=='__main__':main()
