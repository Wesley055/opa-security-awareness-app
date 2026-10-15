"""One approved cutover: private DB phase on App Service, deployment outside it."""
import os,sys,json,pathlib,subprocess,hashlib,base64,socket,time,importlib.util,paramiko,re,shlex,threading,datetime

sha=lambda b:hashlib.sha256(b).hexdigest()
def require(value,code):
    if not value: raise ValueError(code)


def window(manifest,now=None):
    now=time.time() if now is None else now
    w=manifest['maintenance']
    parse=lambda v:datetime.datetime.fromisoformat(v.replace('Z','+00:00')).timestamp()
    require(parse(w['start'])<=now<parse(w['end']),'MAINTENANCE_WINDOW_NOT_ACTIVE')

def execution_credentials(provider,file,approved,manifest):
    window(manifest)
    values=provider.credentials(file,approved,manifest['operatorCredentialBindings'])
    try:
        window(manifest)
        for name in ('OPA_RELEASE_ARM_TOKEN','OPA_RELEASE_VAULT_TOKEN'):
            token=values[name].split('.')[1]
            claims=json.loads(base64.urlsafe_b64decode(token+'='*(-len(token)%4)))
            require(claims['exp']>=time.time()+60,'RELEASE_TOKEN_LIFETIME')
        return values
    except Exception:
        values.clear()
        raise

def approval_bindings(file,manifest):
    # Called before reserving an attempt, opening SSH, or acquiring credentials.
    migration=manifest.get('migration',{})
    backup=manifest.get('artifacts',{}).get('backup')
    require(isinstance(backup,dict),'LOCAL_BACKUP_BINDING_REQUIRED')
    relative=artifact_path(backup['path'])
    raw=(pathlib.Path(file).parent/str(relative)).read_bytes()
    digest=sha(raw)
    require(digest==backup.get('sha256')==migration.get('backupSha256'),'LOCAL_BACKUP_HASH_BINDING')
    evidence=json.loads(raw)
    require(manifest.get('releaseId')==migration.get('approvalId')==evidence.get('approvalId'),'LOCAL_OPERATOR_APPROVAL')
    require(migration.get('action')=='MIGRATE_OPA_PRODUCTION','LOCAL_MIGRATION_ACTION')
    return evidence


def reserve(path):
    with pathlib.Path(path).open('x') as stream:
        stream.write(json.dumps({'startedAt':time.time(),'status':'attempt-reserved'}))

def diagnostic(data):
    # Never persist arbitrary remote text, URLs, JWTs, connection strings or stack traces.
    raw=data.encode() if isinstance(data,str) else data
    return {'sha256':sha(raw),'bytes':len(raw),'codes':[v for v in raw.decode('utf8','replace').splitlines() if re.fullmatch(r'[A-Z][A-Z0-9_]{2,100}',v)]}

def remote_run(ssh,command,payload,timeout,receipt):
    try:stdin,stdout,stderr=ssh.exec_command(command,timeout=timeout)
    except Exception:
        with pathlib.Path(receipt).open('x') as stream:json.dump({'exitStatus':None,'error':'REMOTE_CHANNEL_OPEN_FAILED'},stream)
        raise ValueError('REMOTE_CHANNEL_OPEN_FAILED') from None
    chunks={'stdout':bytearray(),'stderr':bytearray()};failures=[]
    def drain(name,stream):
        try:
            while True:
                b=stream.read(4096)
                if not b:break
                require(len(chunks[name])+len(b)<=1048576,'REMOTE_OUTPUT_LIMIT')
                chunks[name].extend(b)
        except Exception:failures.append('REMOTE_STREAM_FAILED');stdout.channel.close()
    threads=[threading.Thread(target=drain,args=(name,stream),daemon=True) for name,stream in [('stdout',stdout),('stderr',stderr)]]
    for thread in threads:thread.start()
    status=None
    try:
        stdin.write(payload);stdin.flush();stdin.channel.shutdown_write()
        deadline=time.monotonic()+timeout
        while not stdout.channel.exit_status_ready():
            require(time.monotonic()<deadline,'REMOTE_EXECUTION_TIMEOUT')
            time.sleep(.05)
        status=stdout.channel.recv_exit_status()
        for thread in threads:thread.join(max(0,deadline-time.monotonic()))
        require(not failures and not any(t.is_alive() for t in threads),'REMOTE_STREAM_FAILED')
        return bytes(chunks['stdout']).decode('utf8','replace'),status
    except Exception as error:
        failures.append(str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{2,100}',str(error)) else 'REMOTE_EXECUTION_FAILED')
        raise
    finally:
        stdout.channel.close()
        for thread in threads:thread.join(1)
        with pathlib.Path(receipt).open('x') as stream:
            json.dump({'exitStatus':status,'stdout':diagnostic(chunks['stdout']),'stderr':diagnostic(chunks['stderr']),'streamErrors':failures},stream,indent=2)

def checked_source(value):
    require(isinstance(value,str) and re.fullmatch(r'/home/opa-releases/[a-zA-Z0-9_-]{1,80}',value),'STAGED_SOURCE_BINDING_REQUIRED')
    return value

def artifact_path(relative):
    p=pathlib.PurePosixPath(relative)
    require(not p.is_absolute() and p.parts and all(x not in ('..','.') for x in p.parts) and str(p)==relative,'PORTABLE_RELEASE_PATH_REQUIRED')
    return p

def remote_hash(ssh,path):
    # Hash on the approved host: no download, no mutation, reject symlinks.
    script="const f=require('fs'),c=require('crypto'),p=process.argv[1];if(!f.lstatSync(p).isFile()||f.lstatSync(p).isSymbolicLink())process.exit(2);const h=c.createHash('sha256');const s=f.createReadStream(p);s.on('data',b=>h.update(b));s.on('end',()=>console.log(h.digest('hex')));s.on('error',()=>process.exit(3));"
    _,out,err=ssh.exec_command('node -e '+shlex.quote(script)+' '+shlex.quote(path),timeout=120)
    value=out.read(128).decode().strip();status=out.channel.recv_exit_status()
    require(status==0 and re.fullmatch('[a-f0-9]{64}',value),'STAGED_ARTIFACT_HASH_FAILED')
    return value

def verify_staged(ssh,source,artifacts):
    source=checked_source(source)
    for a in artifacts.values():
        relative=artifact_path(a['path'])
        require(remote_hash(ssh,source+'/'+str(relative))==a['sha256'],'STAGED_ARTIFACT_CHANGED')

def stage_release(ssh,root,file,m,remote,receipt):
    try:
        sftp=ssh.open_sftp()
        try:
            staged_source=m.get('stagedArtifactSource')
            if 'stagedArtifactSource' in m:
                checked_source(staged_source);require(staged_source!=remote,'DISTINCT_NEW_ATTEMPT_REQUIRED')
                verify_staged(ssh,staged_source,{k:a for k,a in m['artifacts'].items() if k!='backup'})
            try:sftp.stat(remote);raise ValueError('HISTORICAL_REMOTE_RELEASE_EXISTS')
            except FileNotFoundError:pass
            def mkdir(directory):
                parts=pathlib.PurePosixPath(directory).parts;current=''
                for part in parts:
                    current=current+'/'+part if current else part
                    try:sftp.stat(current)
                    except FileNotFoundError:sftp.mkdir(current,mode=0o700)
            mkdir(remote)
            def upload(source,relative):
                p=pathlib.PurePosixPath(relative);require(not p.is_absolute() and all(x not in ('..','.') for x in p.parts),'PORTABLE_RELEASE_PATH_REQUIRED');dest=remote+'/'+str(p);mkdir(str(pathlib.PurePosixPath(dest).parent));sftp.put(str(source),dest);sftp.chmod(dest,0o600)
            # Copy only reviewed executor inputs, never checkout secrets or logs.
            for folder in ('ops/production','packages/environment-policy'):
                for metadata_file in sorted((root/folder).iterdir()):
                    if metadata_file.is_file() and metadata_file.suffix in ('.cjs','.json','.sql') and '.test.' not in metadata_file.name and metadata_file.name!='fixtures.cjs':upload(metadata_file,metadata_file.relative_to(root).as_posix())
            upload(root/'ops/release-session.cjs','ops/release-session.cjs')
            upload(root/'ops/release-restore.cjs','ops/release-restore.cjs')
            for artifact_name,artifact in m['artifacts'].items():
                if 'stagedArtifactSource' in m and artifact_name!='backup':
                    relative=artifact_path(artifact['path']);destination=remote+'/'+str(relative);mkdir(str(pathlib.PurePosixPath(destination).parent))
                    _,out,err=ssh.exec_command('cp -- '+shlex.quote(checked_source(staged_source)+'/'+str(relative))+' '+shlex.quote(destination),timeout=120)
                    require(out.channel.recv_exit_status()==0,'STAGED_COPY_FAILED')
                    require(remote_hash(ssh,destination)==artifact['sha256'],'STAGED_ARTIFACT_CHANGED')
                    sftp.chmod(destination,0o600)
                else:
                    local=(file.parent/artifact['path']).resolve();require(sha(local.read_bytes())==artifact['sha256'],'LOCAL_ARTIFACT_CHANGED')
                    upload(local,artifact['path']);require(remote_hash(ssh,remote+'/'+artifact['path'])==artifact['sha256'],'STAGED_ARTIFACT_CHANGED')
            upload(file,'owner-release.signed.json')
        finally:sftp.close()
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and re.fullmatch(r'[A-Z][A-Z0-9_]{2,100}',str(error)) else 'STAGING_FAILED'
        with pathlib.Path(receipt).open('x') as stream:
            json.dump({'status':'staging-failed','error':code,'exceptionType':type(error).__name__,'privilegedExecutionStarted':False},stream,indent=2)
        raise

def exclusive_sftp_write(ssh,destination,payload,receipt):
    # Paramiko requires w for write access and x for atomic CREATE|EXCL.
    # Never remove or reopen a partial marker: an uncertain attempt is consumed.
    try:
        with ssh.open_sftp() as sftp:
            with sftp.open(destination,'wx',bufsize=0) as stream:
                stream.write(payload);stream.flush()
            with sftp.open(destination,'rb') as stream:
                actual=stream.read(len(payload)+1)
            require(actual==payload,'SFTP_EXCLUSIVE_READBACK_FAILED')
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and re.fullmatch(r'[A-Z][A-Z0-9_]{2,100}',str(error)) else 'SFTP_EXCLUSIVE_WRITE_FAILED'
        with pathlib.Path(receipt).open('x') as stream:
            json.dump({'status':'exclusive-write-failed','error':code,'exceptionType':type(error).__name__,'recovery':'Preserve remote file and attempt directory; do not retry or overwrite. Require a fresh authorized attempt.','handoffInvokedByThisCall':False},stream,indent=2)
        raise ValueError(code) from None

def migration_handoff(ssh,remote,file,approved,m,credentials):
    exclusive_sftp_write(ssh,remote+'/privileged-attempt.json',json.dumps({'manifestSHA256':approved,'startedAt':time.time()}).encode(),file.parent/(m['releaseId']+'.attempt-marker-diagnostic.json'))
    command='cd '+remote+' && OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256='+approved+' node ops/release-session.cjs --migrate owner-release.signed.json '+approved
    return remote_run(ssh,command,json.dumps(credentials,separators=(',',':')),2*m['executionTimeoutSeconds']+60,file.parent/(m['releaseId']+'.remote-database-diagnostic.json'))

def main():
    require(len(sys.argv)==3,'SIGNED_OWNER_MANIFEST_AND_APPROVED_SHA256_REQUIRED')
    file=pathlib.Path(sys.argv[1]).resolve();approved=sys.argv[2];raw=file.read_bytes()
    require(os.environ.get('OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256')==approved and sha(raw)==approved,'EXPLICIT_FINAL_CUTOVER_AUTHORIZATION_REQUIRED')
    root=pathlib.Path(__file__).resolve().parent.parent
    node=os.environ.get('OPA_RELEASE_NODE') or (str(root.parent/'.tools/node-v22.22.0-win-x64/node.exe') if os.name=='nt' else 'node')
    require(subprocess.check_output([node,'-p','process.versions.node.split(".")[0]'],text=True).strip()=='22','NODE22_REQUIRED')
    verified=subprocess.run([node,str(root/'ops/production/cutover.cjs'),str(file),'--verify'],capture_output=True,text=True,timeout=120)
    require(verified.returncode==0,'SIGNED_OWNER_MANIFEST_VERIFICATION_FAILED')
    m=json.loads(base64.b64decode(json.loads(raw)['payload']))
    tools=['ops/execute-release.py','ops/release-session.cjs','ops/release-deploy.cjs','ops/release-operator-input.py','ops/release-restore.cjs']
    require(set(m.get('executionTools',{}))==set(tools),'APPROVED_EXECUTION_TOOLS_REQUIRED')
    for name in tools:require(sha((root/name).read_bytes())==m['executionTools'][name],'EXECUTION_TOOL_CHANGED')
    remote='/home/opa-releases/'+m['releaseId'];database_file=file.parent/(m['releaseId']+'.database-phase-receipt.json')
    require(not database_file.exists(),'HISTORICAL_DATABASE_RECEIPT_EXISTS')
    spec=importlib.util.spec_from_file_location('operator_credentials',root/'ops/release-operator-input.py');provider=importlib.util.module_from_spec(spec);spec.loader.exec_module(provider)
    approval_bindings(file,m)
    window(m)
    reserve(file.parent/(m['releaseId']+'.attempt.json'))
    tunnel=None;ssh=None;credentials={}
    try:
        # Fresh privileged credentials use only the separately authorized operator
        # login. The application MI remains read-only and unmodified.
        # Staging uses the existing CLI identity; privileged release credentials are acquired afterwards.
        with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        az=os.environ.get('OPA_OPERATOR_AZ_CLI','az.cmd' if os.name=='nt' else 'az')
        options={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}
        tunnel=subprocess.Popen([az,'webapp','create-remote-connection','-g','opa-production','-n','opa-api-production','--port',str(port),'--timeout','1800','--only-show-errors'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**options)
        ready=False
        for _ in range(60):
            require(tunnel.poll() is None,'EXISTING_APP_SERVICE_SSH_UNAVAILABLE')
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=1):ready=True
                break
            except OSError:time.sleep(1)
        require(ready,'EXISTING_APP_SERVICE_SSH_TIMEOUT')
        class PinnedHostKey(paramiko.MissingHostKeyPolicy):
            def missing_host_key(self,client,hostname,key):
                require(base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')==m.get('executionHostSshKeySHA256'),'APPROVED_EXECUTION_HOST_KEY_REQUIRED')
        ssh=paramiko.SSHClient();ssh.set_missing_host_key_policy(PinnedHostKey());ssh.connect('127.0.0.1',port=port,username='root',password='Docker!',look_for_keys=False,allow_agent=False,timeout=20,auth_timeout=20,banner_timeout=20)
        stage_release(ssh,root,file,m,remote,file.parent/(m['releaseId']+'.staging-diagnostic.json'))
        window(m)
        credentials=execution_credentials(provider,file,approved,m)
        window(m)
        output,status=migration_handoff(ssh,remote,file,approved,m,credentials)
        require(status==0,'REMOTE_DATABASE_PHASE_FAILED_CHECK_PERSISTED_RECEIPT')
        lines=[x for x in output.splitlines() if x.strip().startswith('{')];result=json.loads(lines[-1]);require(result.get('status')=='migration-phase-complete' and result.get('manifestSHA256')==approved,'DATABASE_PHASE_NOT_COMPLETE')
        sftp=ssh.open_sftp()
        try:
            with sftp.open(remote+'/'+m['releaseId']+'.database-phase-receipt.json','rb') as stream:database_bytes=stream.read(1048576)
        finally:sftp.close()
        proof=json.loads(database_bytes);require(proof.get('status')=='migration-phase-complete' and proof.get('manifestSHA256')==approved and proof.get('activeMigrations')==42 and proof.get('cleanupRequired') is False,'DATABASE_SCHEMA_AND_CLEANUP_PROOF_REQUIRED')
        with database_file.open('xb') as stream:stream.write(database_bytes)
        # Close the application connection before settings/ZIP deployment can
        # restart that container. The operator retains the rollback controller.
        ssh.close();ssh=None;tunnel.terminate();tunnel.wait(timeout=15);tunnel=None
        credentials.clear();credentials=provider.credentials(file,approved,m['operatorCredentialBindings']);credentials.pop('OPA_RELEASE_ADMIN_DATABASE_URL',None)
        env={**os.environ,'OPA_VERIFIED_DATABASE_RECEIPT_SHA256':sha(database_bytes)}
        deployed=subprocess.run([node,str(root/'ops/release-deploy.cjs'),str(file),approved,str(database_file)],input=json.dumps(credentials,separators=(',',':')),env=env,capture_output=True,text=True,timeout=m['executionTimeoutSeconds']+120)
        with (file.parent/(m['releaseId']+'.operator-deployment-diagnostic.json')).open('x') as stream:json.dump({'exitStatus':deployed.returncode,'stderr':diagnostic(deployed.stderr)},stream,indent=2)
        # Both Node entry points emit only sanitized status/receipt metadata.
        if deployed.stdout:sys.stdout.write(deployed.stdout)
        cutover_file=file.parent/(m['releaseId']+'.cutover-receipt.json')
        require(cutover_file.exists(),'OPERATOR_CUTOVER_RECEIPT_MISSING')
        outcome=json.loads(cutover_file.read_bytes())
        require(outcome.get('manifestSHA256')==approved and outcome.get('status') in ('deployment-phase-complete','rolled-back'),'DEPLOYMENT_FAILED_WRITERS_REMAIN_FENCED')
        # Reconnect after the App Service recycle. The DB ACL fence remains in
        # force independently of process, worker, deployment or scale events.
        credentials.clear();credentials=provider.credentials(file,approved,m['operatorCredentialBindings'])
        with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        tunnel=subprocess.Popen([az,'webapp','create-remote-connection','-g','opa-production','-n','opa-api-production','--port',str(port),'--timeout','600','--only-show-errors'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**options)
        ready=False
        for _ in range(60):
            require(tunnel.poll() is None,'RESTORATION_SSH_UNAVAILABLE_WRITERS_FENCED')
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=1):ready=True
                break
            except OSError:time.sleep(1)
        require(ready,'RESTORATION_SSH_TIMEOUT_WRITERS_FENCED')
        ssh=paramiko.SSHClient();ssh.set_missing_host_key_policy(PinnedHostKey());ssh.connect('127.0.0.1',port=port,username='root',password='Docker!',look_for_keys=False,allow_agent=False,timeout=20,auth_timeout=20,banner_timeout=20)
        destination=remote+'/'+m['releaseId']+'.operator-deployment-receipt.json'
        exclusive_sftp_write(ssh,destination,cutover_file.read_bytes(),file.parent/(m['releaseId']+'.deployment-receipt-upload-diagnostic.json'))
        command='cd '+remote+' && OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256='+approved+' node ops/release-restore.cjs owner-release.signed.json '+approved+' '+m['releaseId']+'.operator-deployment-receipt.json'
        output,status=remote_run(ssh,command,json.dumps(credentials,separators=(',',':')),300,file.parent/(m['releaseId']+'.remote-restoration-diagnostic.json'))
        require(status==0,'RESTORATION_FAILED_CHECK_MAINTENANCE_RECEIPT')
        lines=[x for x in output.splitlines() if x.strip().startswith('{')];restored=json.loads(lines[-1]);require(restored.get('status')=='writers-restored' and restored.get('manifestSHA256')==approved,'WRITER_RESTORATION_NOT_VERIFIED')
        with (file.parent/(m['releaseId']+'.writer-restoration-receipt.json')).open('x') as stream:json.dump(restored,stream,indent=2)
        print(json.dumps({'status':'complete' if outcome['status']=='deployment-phase-complete' else 'rolled-back','manifestSHA256':approved,'writersRestored':True,'productionSchema':42}))
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and re.fullmatch(r'[A-Z][A-Z0-9_]{2,100}',str(error)) else 'CONTROLLED_CUTOVER_FAILED'
        with (file.parent/(m['releaseId']+'.controller-failure.json')).open('x') as stream:
            json.dump({'status':'failed','manifestSHA256':approved,'error':code,'exceptionType':type(error).__name__,'retryPermitted':False},stream,indent=2)
        raise
    finally:
        credentials.clear()
        if ssh:ssh.close()
        if tunnel:
            tunnel.terminate()
            try:tunnel.wait(timeout=15)
            except subprocess.TimeoutExpired:tunnel.kill();tunnel.wait(timeout=10)

if __name__=='__main__':
    try:main()
    except Exception as e:
        code=str(e) if isinstance(e,ValueError) and str(e).replace('_','').isalnum() and str(e).isupper() else 'CONTROLLED_CUTOVER_FAILED_CHECK_PERSISTED_RECEIPTS'
        print(code,file=sys.stderr);raise SystemExit(1)
