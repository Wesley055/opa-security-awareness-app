"""Operator-host launcher for a single staging CI job. Never mount host credentials.
Run with Azure CLI's Python runtime (azure.cli dependency). No migration by default.
"""
import argparse,datetime,json,os,pathlib,re,secrets,subprocess,sys,time,threading,requests
from azure.cli.core._profile import Profile
REPO='Wesley055/opa-security-awareness-app';BRANCH='integration/institutional-security'
SUB='b79ffdb2-0cf1-4915-89b4-2b6b7cae0299';TENANT='adb3fb59-1ac3-42c2-b39a-d70c7006ccbc'
SCOPE=f'/subscriptions/{SUB}/resourceGroups/rg-opa-staging'
DOCKER=r'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
WORKFLOW='opa-staging-migration.yml'
def require(condition):
 if not condition:raise RuntimeError('Staging runner guard rejected')
def main():
 p=argparse.ArgumentParser();p.add_argument('--sha',required=True);p.add_argument('--image',required=True);p.add_argument('--mode',choices=['auth-only','migrate'],default='auth-only');p.add_argument('--confirmation',default='');args=p.parse_args()
 require(bool(re.fullmatch('[a-f0-9]{40}',args.sha)))
 require(bool(re.fullmatch(r'ghcr.io/actions/actions-runner@sha256:[a-f0-9]{64}',args.image)))
 require(args.mode!='migrate' or args.confirmation=='MIGRATE_OPA_STAGING')
 env=os.environ.copy();env['GIT_TERMINAL_PROMPT']='0';env['GCM_INTERACTIVE']='Never'
 credentials=subprocess.run(['git','-c','credential.interactive=false','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,env=env,timeout=20)
 fields=dict(x.split('=',1) for x in credentials.stdout.splitlines() if '=' in x);require(bool(fields.get('password')))
 headers={'Authorization':'Bearer '+fields['password'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
 def github(method,suffix,body=None,allowed=(200,201,204)):
  r=requests.request(method,'https://api.github.com/repos/'+REPO+suffix,headers=headers,json=body,timeout=30,allow_redirects=False)
  require(r.status_code in allowed);return r
 repo=github('GET','').json();branch=github('GET','/branches/integration%2Finstitutional-security').json();require(branch['commit']['sha']==args.sha)
 # Refuse before registration/network changes unless GitHub can discover the manual workflow.
 available=github('GET','/contents/.github/workflows/'+WORKFLOW+'?ref='+repo['default_branch'],allowed=(200,404))
 if available.status_code!=200:raise RuntimeError('Workflow must first exist on the default branch; no resources changed')
 protection=github('GET','/environments/staging').json()
 require(any(x['type']=='required_reviewers' and x.get('reviewers') for x in protection.get('protection_rules',[])))
 branches=github('GET','/environments/staging/deployment-branch-policies').json()['branch_policies']
 require(len(branches)==1 and branches[0]['name']==BRANCH and branches[0].get('type')=='branch')
 address=subprocess.run(['powershell','-NoProfile','-Command',"@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -like '172.27.240.*' | Select-Object -ExpandProperty IPAddress) | ConvertTo-Json -Compress"],capture_output=True,text=True,timeout=20)
 ips=json.loads(address.stdout);ips=ips if isinstance(ips,list) else [ips];require(len(ips)==1 and bool(re.fullmatch(r'172\.27\.240\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])',ips[0])))
 credential,subscription,tenant=Profile().get_login_credentials(subscription_id=SUB);require(subscription==SUB and tenant==TENANT)
 leaseid=secrets.token_hex(12);name='opa-staging-ephemeral-'+leaseid;rules=[];container=None;runner_id=None;run_id=None
 audit={'lease':leaseid,'approvedSha':args.sha,'mode':args.mode,'source':ips[0]+'/32','image':args.image,'networkCleanup':[],'containerRemoved':False,'runnerDeregistered':False}
 evidence=pathlib.Path.cwd()/('opa-staging-run-'+leaseid+'.json')
 def network(method,uri,body=None,allowed=(200,201,202,204)):
  require(uri.startswith('https://management.azure.com'+SCOPE+'/providers/Microsoft.Network/networkSecurityGroups/nsg-opa-staging-') and '/securityRules/opa-ci-'+leaseid+'-' in uri)
  token=credential.get_token('https://management.azure.com/.default').token
  r=requests.request(method,uri,headers={'Authorization':'Bearer '+token},json=body,timeout=45,allow_redirects=False);require(r.status_code in allowed);return r
 try:
  for suffix,priority,ip,port in [('postgres',900,'10.72.1.4','5432'),('vault',900,'10.72.2.4','443'),('redis',901,'10.72.2.5','10000')]:
   nsg='nsg-opa-staging-postgres' if suffix=='postgres' else 'nsg-opa-staging-private-endpoints'
   uri='https://management.azure.com'+SCOPE+'/providers/Microsoft.Network/networkSecurityGroups/'+nsg+'/securityRules/opa-ci-'+leaseid+'-'+suffix+'?api-version=2024-05-01'
   require(network('GET',uri,allowed=(200,404)).status_code==404);rules.append(uri)
   audit['leasedRules']=[x.split('?')[0] for x in rules];evidence.write_text(json.dumps(audit,indent=2))
   network('PUT',uri,{'properties':{'priority':priority,'direction':'Inbound','access':'Allow','protocol':'Tcp','sourceAddressPrefix':ips[0]+'/32','sourcePortRange':'*','destinationAddressPrefix':ip+'/32','destinationPortRange':port,'description':'OPA staging ephemeral CI lease '+leaseid}})
  registration=github('POST','/actions/runners/registration-token',{}).json()['token']
  lease={'id':leaseid,'repository':REPO,'approvedSha':args.sha,'mode':args.mode,'source':ips[0]+'/32','expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=45)).isoformat(),'hostMounts':0,'cleanupOwner':'operator-host'}
  bootstrap="""const fs=require('fs'),cp=require('child_process');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const x=JSON.parse(s);fs.mkdirSync('/runner/home',{recursive:true});fs.writeFileSync('/runner/opa-staging-lease.json',JSON.stringify(x.lease));const r=cp.spawnSync('./config.sh',['--unattended','--ephemeral','--disableupdate','--url','https://github.com/Wesley055/opa-security-awareness-app','--token',x.token,'--name',x.name,'--labels','opa-staging-ephemeral','--work','_work'],{stdio:'pipe',env:process.env});x.token='';s='';if(r.status!==0)process.exit(1);const child=cp.spawn('./run.sh',[],{stdio:'inherit',env:process.env});child.on('exit',code=>process.exit(code||0))}catch{process.exit(1)}});"""
  entry='cp -a /home/runner/. /runner/ && cd /runner && if [ -x externals/node24/bin/node ]; then exec externals/node24/bin/node -e "$1"; else exec externals/node20/bin/node -e "$1"; fi'
  command=[DOCKER,'run','--rm','-i','--name',name,'--label','opa.staging.lease='+leaseid,'--log-driver','none','--network','bridge','--dns','10.72.3.4','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--user','1001:1001','--tmpfs','/runner:rw,exec,nosuid,nodev,size=6g,uid=1001,gid=1001,mode=0700','--tmpfs','/tmp:rw,exec,nosuid,nodev,size=1g,mode=1777','--tmpfs','/opt/hostedtoolcache:rw,exec,nosuid,nodev,size=1g,uid=1001,gid=1001','--pids-limit','512','--memory','8g','--env','HOME=/runner/home','--env','RUNNER_TOOL_CACHE=/opt/hostedtoolcache','--entrypoint','/bin/sh',args.image,'-c',entry,'opa-staging',bootstrap]
  container=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  def discard(stream):
   for line in stream:pass
  for stream in (container.stdout,container.stderr):threading.Thread(target=discard,args=(stream,),daemon=True).start()
  container.stdin.write(json.dumps({'token':registration,'name':name,'lease':lease}));container.stdin.close();registration=None
  for attempt in range(60):
   require(container.poll() is None)
   matching=[x for x in github('GET','/actions/runners?per_page=100').json()['runners'] if x['name']==name]
   if matching and matching[0]['status']=='online':runner_id=matching[0]['id'];break
   time.sleep(5)
  require(runner_id is not None)
  github('POST','/actions/workflows/'+WORKFLOW+'/dispatches',{'ref':BRANCH,'inputs':{'mode':args.mode,'approved_sha':args.sha,'migration_confirmation':args.confirmation,'runner_lease':leaseid}})
  print(json.dumps({'runner':name,'lease':leaseid,'status':'Dispatched; required environment review must be approved by the operator'}),flush=True)
  deadline=time.monotonic()+40*60
  while time.monotonic()<deadline:
   runs=github('GET','/actions/workflows/'+WORKFLOW+'/runs?event=workflow_dispatch&per_page=30').json()['workflow_runs']
   matching=[x for x in runs if leaseid in x.get('display_title','') and x['head_sha']==args.sha]
   if matching:
    require(len(matching)==1);run_id=matching[0]['id'];audit['runId']=run_id
    if matching[0]['status']=='completed':audit['conclusion']=matching[0]['conclusion'];break
   require(container.poll() in (None,0))
   time.sleep(10)
  require(audit.get('conclusion')=='success')
 finally:
  if run_id and audit.get('conclusion')!='success':
   try:github('POST','/actions/runs/'+str(run_id)+'/cancel',{},allowed=(202,409))
   except Exception:pass
  # Revoke the exact network lease before stopping the container/tunnel.
  for uri in reversed(rules):
   try:
    network('DELETE',uri,allowed=(200,202,204,404))
    removed=False
    for attempt in range(15):
     if network('GET',uri,allowed=(200,404)).status_code==404:removed=True;break
     time.sleep(2)
    audit['networkCleanup'].append({'resource':uri.split('?')[0],'removed':removed})
   except Exception:audit['networkCleanup'].append({'resource':uri.split('?')[0],'removed':False})
  if container:
   subprocess.run([DOCKER,'rm','--force',name],capture_output=True,text=True,timeout=30)
   remaining=subprocess.run([DOCKER,'ps','-aq','--filter','name=^/'+name+'$'],capture_output=True,text=True,timeout=20)
   audit['containerRemoved']=remaining.returncode==0 and not remaining.stdout.strip()
   if runner_id is None:
    try:
     matching=[x for x in github('GET','/actions/runners?per_page=100').json()['runners'] if x['name']==name]
     require(len(matching)<=1)
     if matching:runner_id=matching[0]['id']
     else:audit['runnerDeregistered']=True
    except Exception:pass
  if runner_id:
   try:github('DELETE','/actions/runners/'+str(runner_id),allowed=(204,404));audit['runnerDeregistered']=True
   except Exception:pass
  evidence.write_text(json.dumps(audit,indent=2));print(json.dumps(audit),flush=True)
  require(all(x['removed'] for x in audit['networkCleanup']) and (container is None or audit['containerRemoved']) and (container is None or audit['runnerDeregistered']))
if __name__=='__main__':
 try:main()
 except Exception as exc:print(json.dumps({'status':'Stopped','errorType':type(exc).__name__,'reason':str(exc) if isinstance(exc,RuntimeError) else 'Sanitized failure'}));sys.exit(1)