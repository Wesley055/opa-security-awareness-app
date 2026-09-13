"""One protected staging migration/review job on the approved operator host.
Database custody and temporary access are outside the CI identity. Secrets remain
in process memory/stdin or the disposable runner's tmpfs. No action runs on import.
"""
import argparse,base64,datetime,json,os,pathlib,re,subprocess,sys,threading,time,uuid
import requests
from azure.cli.core._profile import Profile
ROOT=pathlib.Path(r'C:\Projects\OPA')
REPO='Wesley055/opa-security-awareness-app';BRANCH='integration/institutional-security'
SUB='b79ffdb2-0cf1-4915-89b4-2b6b7cae0299';TENANT='adb3fb59-1ac3-42c2-b39a-d70c7006ccbc'
PRINCIPAL='737caf69-640d-485e-9be5-c0095633a27e';OPERATOR='c9af56a4-86a7-42e3-bcae-c232209354fb'
SCOPE=f'/subscriptions/{SUB}/resourceGroups/rg-opa-staging'
WORKFLOW='opa-staging-migration-execution.yml'
DOCKER=r'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
NODE=r'C:\Program Files\nodejs\node.exe'
AZ=r'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
ROLE='4633458b-17de-408a-b874-0445c86b69e6'
SECRETS=['database-migration-url','redis-url','storage-connection','enrollment-encryption-key','jwt-access-secret','jwt-refresh-secret','pii-encryption-ring','pii-lookup-key']
def require(value,code='GUARD_REJECTED'):
 if not value:raise RuntimeError(code)
def git(*args):
 return subprocess.check_output(['git','-c','safe.directory=C:/Projects/OPA','-C',str(ROOT),*args],text=True).strip()
def main():
 p=argparse.ArgumentParser();p.add_argument('--sha',required=True);p.add_argument('--run-id',required=True,type=int);p.add_argument('--image',required=True);p.add_argument('--execute',action='store_true');p.add_argument('--confirmation',default='');args=p.parse_args()
 require(re.fullmatch('[a-f0-9]{40}',args.sha) and re.fullmatch(r'ghcr.io/actions/actions-runner@sha256:[a-f0-9]{64}',args.image))
 require(subprocess.run(['git','-c','safe.directory=C:/Projects/OPA','-C',str(ROOT),'diff','--quiet','HEAD','--','apps/api/scripts/staging-validation-custodian.cjs','apps/api/scripts/staging-database-verifier.cjs','ops/staging/run-protected-migration.py']).returncode==0,'HOST_EXECUTABLE_CHANGED')
 require(git('rev-parse','HEAD')==args.sha and git('branch','--show-current')==BRANCH,'LOCAL_SHA')
 trigger=json.loads(git('show',args.sha+':ops/staging/migration-trigger.json'))
 require(trigger['mode'] in ('migration','validation') and trigger['environment']=='staging' and trigger['server']=='opa-pg-staging' and trigger['runtimeDatabase']=='opa_staging' and trigger['testDatabase']=='opa_staging_test' and trigger['identity']=='id-opa-staging-migrations','TRIGGER_TARGET')
 require(trigger['execute'] is args.execute and (not args.execute or args.confirmation==('VALIDATE_MIGRATED_OPA_STAGING' if trigger['mode']=='validation' else 'MIGRATE_OPA_STAGING')),'EXECUTION_NOT_AUTHORIZED')
 require(datetime.datetime.fromisoformat(trigger['expiresAt'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc),'TRIGGER_EXPIRED')
 action='VALIDATE_MIGRATED_OPA_STAGING' if trigger['mode']=='validation' else 'MIGRATE_OPA_STAGING'
 leaseid=trigger['lease'];require(re.fullmatch('[a-f0-9]{24}',leaseid));name='opa-staging-ephemeral-'+leaseid
 env=os.environ.copy();env['GIT_TERMINAL_PROMPT']='0';env['GCM_INTERACTIVE']='Never'
 c=subprocess.run(['git','-c','safe.directory=C:/Projects/OPA','-C',str(ROOT),'-c','credential.interactive=false','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True,env=env,timeout=20)
 fields=dict(x.split('=',1) for x in c.stdout.splitlines() if '=' in x);require(bool(fields.get('password')),'GITHUB_AUTH')
 headers={'Authorization':'Bearer '+fields['password'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
 def gh(method,suffix,body=None,allowed=(200,201,204)):
  x=requests.request(method,'https://api.github.com/repos/'+REPO+suffix,headers=headers,json=body,timeout=30,allow_redirects=False);require(x.status_code in allowed,'GITHUB_METADATA');return x
 repo=gh('GET','').json();require(gh('GET','/branches/integration%2Finstitutional-security').json()['commit']['sha']==args.sha,'REMOTE_SHA')
 run=gh('GET','/actions/runs/'+str(args.run_id)).json();require(run['head_sha']==args.sha and run['event']=='push' and run['head_branch']==BRANCH and run['path']=='.github/workflows/'+WORKFLOW and run['status'] in ('queued','in_progress'),'RUN_TARGET')
 require(not gh('GET','/actions/runs/'+str(args.run_id)+'/pending_deployments').json(),'ENVIRONMENT_APPROVAL_PENDING')
 protection=gh('GET','/environments/staging').json();require(any(x['type']=='required_reviewers' and x.get('reviewers') for x in protection['protection_rules']),'ENVIRONMENT_REVIEW_MISSING')
 branches=gh('GET','/environments/staging/deployment-branch-policies').json()['branch_policies'];require(len(branches)==1 and branches[0]['name']==BRANCH and branches[0].get('type')=='branch','ENVIRONMENT_BRANCH')
 if args.execute:
  x=requests.get(f'https://api.github.com/repositories/{repo["id"]}/environments/staging/variables/OPA_STAGING_MIGRATION_AUTHORIZATION',headers=headers,timeout=30);require(x.status_code==200,'MIGRATION_AUTHORIZATION_MISSING');a=json.loads(x.json()['value'])
  require(a['sha']==args.sha and a['lease']==leaseid and a['action']==action and datetime.datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc),'MIGRATION_AUTHORIZATION_INVALID')
 credential,subscription,tenant=Profile().get_login_credentials(subscription_id=SUB);require(subscription==SUB and tenant==TENANT,'AZURE_ACCOUNT')
 def arm(method,resource,body=None,allowed=(200,201,202,204)):
  require(resource.startswith(SCOPE+'/'),'ARM_STAGING_SCOPE')
  x=requests.request(method,'https://management.azure.com'+resource,headers={'Authorization':'Bearer '+credential.get_token('https://management.azure.com/.default').token},json=body,timeout=45,allow_redirects=False);require(x.status_code in allowed,'ARM_OPERATION');return x
 pg=arm('GET',SCOPE+'/providers/Microsoft.DBforPostgreSQL/flexibleServers/opa-pg-staging?api-version=2024-08-01').json();require(pg['properties']['state']=='Ready','POSTGRES_NOT_READY')
 roles=subprocess.run([AZ,'role','assignment','list','--assignee',PRINCIPAL,'--all','--include-inherited','--output','json','--only-show-errors'],capture_output=True,text=True,timeout=60);require(roles.returncode==0,'IAM_QUERY');roles=json.loads(roles.stdout)
 expected={SCOPE+'/providers/Microsoft.KeyVault/vaults/opa-kv-staging/secrets/opa-staging-'+x for x in SECRETS}
 require(len(roles)==8 and {x['scope'] for x in roles}==expected and all(x['roleDefinitionId'].endswith('/'+ROLE) and x['principalId']==PRINCIPAL for x in roles),'MIGRATION_IAM_SCOPE')
 address=subprocess.run(['powershell','-NoProfile','-Command',"@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -like '172.27.240.*' | Select-Object -ExpandProperty IPAddress) | ConvertTo-Json -Compress"],capture_output=True,text=True,timeout=20)
 ips=json.loads(address.stdout);ips=ips if isinstance(ips,list) else [ips];require(len(ips)==1 and re.fullmatch(r'172\.27\.240\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])',ips[0]),'VPN_ADDRESS')
 lease={'id':leaseid,'repository':REPO,'approvedSha':args.sha,'mode':'migration-validation' if trigger['mode']=='validation' else 'migration' if args.execute else 'migration-review','source':ips[0]+'/32','expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=55)).isoformat(),'hostMounts':0,'cleanupOwner':'operator-host','azurePreflight':{'postgresState':'Ready','principalId':PRINCIPAL,'productionAssignments':0,'approvedSecretAssignments':8}}
 audit={'runId':args.run_id,'sha':args.sha,'execute':args.execute,'lease':lease,'networkCleanup':[],'testDatabaseRequested':False,'testDatabaseCleanup':not args.execute,'temporaryIamRemoved':True,'containerRemoved':False,'runnerDeregistered':False};rules=[];container=None;runner_id=None;iam=None
 folder=ROOT/'artifacts/staging-migration-runs';folder.mkdir(parents=True,exist_ok=True);evidence=folder/(str(args.run_id)+'-'+leaseid+'.json')
 def save():evidence.write_text(json.dumps(audit,indent=2))
 def custody(action):
  data={'action':action,'sha':args.sha,'lease':leaseid,'source':lease['source'],'expiresAt':lease['expiresAt'],'vaultToken':credential.get_token('https://vault.azure.net/.default').token}
  result=subprocess.run([NODE,str(ROOT/'apps/api/scripts/staging-validation-custodian.cjs')],input=json.dumps(data),text=True,capture_output=True,timeout=180);data.clear()
  try:response=json.loads(result.stdout)
  except ValueError:raise RuntimeError('CUSTODIAN_RESULT_UNAVAILABLE')
  require(result.returncode==0 and response.get('status')=='ready','CUSTODIAN_'+response.get('code','FAILED'));return response
 def publish(file,data):
  require(file in ('opa-staging-test-access.json','opa-staging-test-cleaned.json'),'RUNNER_FILE')
  code="let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>require('fs').writeFileSync('/runner/'+process.argv[1],s,{mode:0o600}));"
  result=subprocess.run([DOCKER,'exec','-i',name,'/runner/externals/node24/bin/node','-e',code,file],input=json.dumps(data),text=True,capture_output=True,timeout=20);require(result.returncode==0,'RUNNER_RESPONSE')
 try:
  for suffix,priority,ip,port in [('postgres',900,'10.72.1.4','5432'),('vault',900,'10.72.2.4','443'),('redis',901,'10.72.2.5','10000')]:
   nsg='nsg-opa-staging-postgres' if suffix=='postgres' else 'nsg-opa-staging-private-endpoints';resource=SCOPE+'/providers/Microsoft.Network/networkSecurityGroups/'+nsg+'/securityRules/opa-ci-'+leaseid+'-'+suffix+'?api-version=2024-05-01'
   require(arm('GET',resource,allowed=(200,404)).status_code==404,'NETWORK_LEASE_EXISTS');rules.append(resource);audit['networkRules']=rules;save()
   arm('PUT',resource,{'properties':{'priority':priority,'direction':'Inbound','access':'Allow','protocol':'Tcp','sourceAddressPrefix':lease['source'],'sourcePortRange':'*','destinationAddressPrefix':ip+'/32','destinationPortRange':port,'description':'OPA staging lease '+leaseid}})
  ready=None
  if args.execute:
   token=credential.get_token('https://management.azure.com/.default').token;claims=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'==='));require(claims.get('oid')==OPERATOR,'OPERATOR_IDENTITY');token=None
   scope=SCOPE+'/providers/Microsoft.KeyVault/vaults/opa-kv-staging/secrets/opa-staging-bootstrap-db-password'
   candidate=scope+'/providers/Microsoft.Authorization/roleAssignments/'+str(uuid.uuid5(uuid.NAMESPACE_URL,'opa-staging-custodian-'+leaseid))+'?api-version=2022-04-01'
   require(arm('GET',candidate,allowed=(200,404)).status_code==404,'CUSTODIAN_IAM_EXISTS');iam=candidate;audit['temporaryIam']=iam;audit['temporaryIamRemoved']=False;save()
   arm('PUT',iam,{'properties':{'principalId':OPERATOR,'principalType':'User','roleDefinitionId':'/subscriptions/'+SUB+'/providers/Microsoft.Authorization/roleDefinitions/'+ROLE}})
   for attempt in range(12):
    try:ready=custody('inspect');break
    except RuntimeError as exc:
     if str(exc)!='CUSTODIAN_BOOTSTRAP_SECRET_ACCESS':raise
     time.sleep(5)
   require(ready is not None,'CUSTODIAN_NOT_READY')
  registration=gh('POST','/actions/runners/registration-token',{}).json()['token']
  bootstrap="""const fs=require('fs'),cp=require('child_process');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const x=JSON.parse(s);fs.mkdirSync('/runner/home',{recursive:true});fs.writeFileSync('/runner/opa-staging-lease.json',JSON.stringify(x.lease));if(x.ready)fs.writeFileSync('/runner/opa-staging-custodian-ready.json',JSON.stringify(x.ready));const r=cp.spawnSync('./config.sh',['--unattended','--ephemeral','--disableupdate','--url','https://github.com/Wesley055/opa-security-awareness-app','--token',x.token,'--name',x.name,'--labels','opa-staging-ephemeral','--work','_work'],{stdio:'pipe',env:process.env});x.token='';s='';if(r.status!==0)process.exit(1);const child=cp.spawn('./run.sh',[],{stdio:'inherit',env:process.env});child.on('exit',code=>process.exit(code||0))}catch{process.exit(1)}});"""
  entry='cp -a /home/runner/. /runner/ && cd /runner && exec externals/node24/bin/node -e "$1"'
  cmd=[DOCKER,'run','--rm','-i','--name',name,'--label','opa.staging.lease='+leaseid,'--log-driver','none','--network','bridge','--dns','10.72.3.4','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--user','1001:1001','--tmpfs','/runner:rw,exec,nosuid,nodev,size=6g,uid=1001,gid=1001,mode=0700','--tmpfs','/tmp:rw,exec,nosuid,nodev,size=1g,mode=1777','--tmpfs','/opt/hostedtoolcache:rw,exec,nosuid,nodev,size=1g,uid=1001,gid=1001','--pids-limit','512','--memory','8g','--env','HOME=/runner/home','--env','RUNNER_TOOL_CACHE=/opt/hostedtoolcache','--entrypoint','/bin/sh',args.image,'-c',entry,'opa-staging',bootstrap]
  container=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  def discard(stream):
   for line in stream:pass
  for stream in (container.stdout,container.stderr):threading.Thread(target=discard,args=(stream,),daemon=True).start()
  container.stdin.write(json.dumps({'token':registration,'name':name,'lease':lease,'ready':ready}));container.stdin.close();registration=None
  for attempt in range(60):
   require(container.poll() is None,'RUNNER_START_FAILED');matching=[x for x in gh('GET','/actions/runners?per_page=100').json()['runners'] if x['name']==name]
   if matching and matching[0]['status']=='online':runner_id=matching[0]['id'];break
   time.sleep(5)
  require(runner_id is not None,'RUNNER_NOT_ONLINE');print(json.dumps({'runId':args.run_id,'runner':name,'mode':lease['mode']}),flush=True)
  handled=set();deadline=time.monotonic()+48*60
  while time.monotonic()<deadline:
   run=gh('GET','/actions/runs/'+str(args.run_id)).json()
   if run['status']=='completed':audit['conclusion']=run['conclusion'];break
   if args.execute and container.poll() is None:
    code="const fs=require('fs'),p='/runner/opa-staging-custodian-request.json';if(fs.existsSync(p))process.stdout.write(fs.readFileSync(p,'utf8'));"
    request=subprocess.run([DOCKER,'exec',name,'/runner/externals/node24/bin/node','-e',code],capture_output=True,text=True,timeout=20)
    if request.returncode==0 and request.stdout:
     data=json.loads(request.stdout);require(data['sha']==args.sha and data['lease']==leaseid and data['action'] in ('create','drop','cleanup'),'CUSTODIAN_REQUEST')
     action=data['action']
     if action not in handled:
      if action=='create':
       audit['testDatabaseRequested']=True;save();access=custody('create');publish('opa-staging-test-access.json',access);access.clear()
      elif audit['testDatabaseRequested']:
       result=custody('drop');audit['testDatabaseCleanup']=True;publish('opa-staging-test-cleaned.json',result)
      handled.add(action)
   require(container.poll() in (None,0),'RUNNER_FAILED');time.sleep(5)
  require(audit.get('conclusion')=='success','JOB_NOT_SUCCESSFUL')
 finally:
  if audit.get('conclusion')!='success':
   try:gh('POST','/actions/runs/'+str(args.run_id)+'/cancel',{},allowed=(202,409))
   except Exception:pass
  if args.execute and audit['testDatabaseRequested']:
   try:custody('drop');audit['testDatabaseCleanup']=True
   except Exception:audit['testDatabaseCleanup']=False
  elif args.execute:audit['testDatabaseCleanup']=True
  if iam:
   try:
    arm('DELETE',iam,allowed=(200,202,204,404));audit['temporaryIamRemoved']=arm('GET',iam,allowed=(200,404)).status_code==404
   except Exception:audit['temporaryIamRemoved']=False
  for resource in reversed(rules):
   removed=False
   try:
    arm('DELETE',resource,allowed=(200,202,204,404))
    for attempt in range(15):
     if arm('GET',resource,allowed=(200,404)).status_code==404:removed=True;break
     time.sleep(2)
   except Exception:pass
   audit['networkCleanup'].append({'resource':resource,'removed':removed})
  if container:
   subprocess.run([DOCKER,'rm','--force',name],capture_output=True,timeout=30)
   remaining=subprocess.run([DOCKER,'ps','-aq','--filter','name=^/'+name+'$'],capture_output=True,text=True,timeout=20);audit['containerRemoved']=remaining.returncode==0 and not remaining.stdout.strip()
   if runner_id is None:
    try:
     matching=[x for x in gh('GET','/actions/runners?per_page=100').json()['runners'] if x['name']==name]
     require(len(matching)<=1)
     if matching:runner_id=matching[0]['id']
     else:audit['runnerDeregistered']=True
    except Exception:pass
  if runner_id:
   try:gh('DELETE','/actions/runners/'+str(runner_id),allowed=(204,404));audit['runnerDeregistered']=True
   except Exception:pass
  save();print(json.dumps(audit),flush=True)
  require(all(x['removed'] for x in audit['networkCleanup']) and audit['temporaryIamRemoved'] and audit['testDatabaseCleanup'] and (container is None or (audit['containerRemoved'] and audit['runnerDeregistered'])),'CLEANUP_INCOMPLETE')
if __name__=='__main__':
 try:main()
 except Exception as exc:print(json.dumps({'status':'Stopped','reason':str(exc) if isinstance(exc,RuntimeError) else 'DETAILS_SUPPRESSED'}));sys.exit(1)
