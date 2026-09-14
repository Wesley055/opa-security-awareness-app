"""Operator-owned Azure staging validation supervisor. No work runs on import.
Requires an approved protected GitHub run before temporary access or listener launch.
Database custody stays on the operator host; bootstrap values never reach the VM.
"""
import argparse,json,pathlib,subprocess,os,re,time,uuid,datetime,base64,urllib.parse
import requests
from azure.cli.core._profile import Profile
import runner_runtime as runtime
import runner_results_network as results_network
from azure_runner_transport import Transport,VM,SCOPE,BASE
from azure_runner_lifecycle import cleanup
ROOT=pathlib.Path(__file__).resolve().parents[2]
SUB="b79ffdb2-0cf1-4915-89b4-2b6b7cae0299";TENANT="adb3fb59-1ac3-42c2-b39a-d70c7006ccbc";REPO="Wesley055/opa-security-awareness-app";BRANCH="integration/institutional-security";WORKFLOW=".github/workflows/opa-staging-migration-execution.yml"
PRINCIPAL="737caf69-640d-485e-9be5-c0095633a27e";OPERATOR="c9af56a4-86a7-42e3-bcae-c232209354fb";ROLE="4633458b-17de-408a-b874-0445c86b69e6"
NAME="opa-staging-azure-validation-01";LABEL="opa-staging-azure-validation";NODE=r"C:\Program Files\nodejs\node.exe";AZ=r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
N=SCOPE+"/providers/Microsoft.Network";NIC=N+"/networkInterfaces/nic-opa-staging-validation-01";DISK=SCOPE+"/providers/Microsoft.Compute/disks/osdisk-opa-staging-validation-01";NAT=N+"/natGateways/nat-opa-staging-runner";PIP=N+"/publicIPAddresses/pip-opa-staging-runner-nat";VNET=N+"/virtualNetworks/vnet-opa-staging";SUBNET=VNET+"/subnets/snet-opa-staging-runner"
NETAPI="?api-version=2024-05-01";COMPAPI="?api-version=2024-07-01";DISKAPI="?api-version=2024-03-02"
SECRETS=["database-migration-url","redis-url","storage-connection","enrollment-encryption-key","jwt-access-secret","jwt-refresh-secret","pii-encryption-ring","pii-lookup-key"]
def require(v,code):
 if not v:raise RuntimeError(code)
def git(*a):return subprocess.check_output(["git","-c","safe.directory="+ROOT.as_posix(),"-C",str(ROOT),*a],text=True).strip()
def approved(run,pending,reviews,sha,run_id):
 require(run['id']==run_id and run['head_sha']==sha and run['head_branch']==BRANCH and run['event']=='push' and run['path']==WORKFLOW and run['status'] in ('queued','in_progress'),'RUN_BINDING')
 require(not pending and any(x.get('state')=='approved' and any(e.get('name')=='staging' for e in x.get('environments',[])) for x in reviews),'RECORDED_STAGING_APPROVAL_REQUIRED')
def routes(rows):
 for row in rows:
  if row.get('state')!='Active' or row.get('nextHopType')=='None':continue
  kind=row['nextHopType'];prefixes=set(row['addressPrefix'])
  allowed={'VnetLocal':{'10.72.0.0/20'},'VirtualNetworkGateway':{'172.27.240.0/24'},'InterfaceEndpoint':{'10.72.2.4/32','10.72.2.5/32','10.72.2.6/32'},'Internet':{'0.0.0.0/0'}}
  require(kind in allowed and prefixes<=allowed[kind],'PRODUCTION_OR_UNKNOWN_ROUTE')
def seal_jit(encoded):
 files=json.loads(base64.b64decode(encoded));settings=json.loads(base64.b64decode(files['.runner']))
 hosts=set(json.loads((ROOT/'ops/staging/azure-runner-endpoints.json').read_text())['hosts'])
 for value in settings.values():
  if isinstance(value,str) and value.startswith('https://'):require(urllib.parse.urlsplit(value).hostname in hosts,'UNCHECKED_JIT_ENDPOINT')
 for flag in ('ephemeral','disableUpdate'):
  for key in list(settings):
   if key.lower()==flag.lower():del settings[key]
  settings[flag]=True
 files['.runner']=base64.b64encode(json.dumps(settings,separators=(',',':')).encode()).decode()
 return base64.b64encode(json.dumps(files,separators=(',',':')).encode()).decode()
def execute(args):
 require(re.fullmatch('[a-f0-9]{40}',args.sha) and git('rev-parse','HEAD')==args.sha and git('branch','--show-current')==BRANCH,'LOCAL_SHA')
 for file in ['ops/staging/run-azure-validation.py','ops/staging/azure_runner_transport.py','ops/staging/azure_runner_lifecycle.py','ops/staging/runner_runtime.py','ops/staging/runner_results_network.py','apps/api/scripts/staging-validation-custodian.cjs','apps/api/scripts/staging-database-verifier.cjs','apps/api/scripts/staging-azure-runner.cjs','apps/api/scripts/staging-oidc.cjs','packages/environment-policy/index.cjs','packages/environment-policy/trusted-signers.json','ops/staging/azure-runner-contract.json','ops/staging/azure-runner-endpoints.json']:
  expected=subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'show',args.sha+':'+file]);require(expected.replace(b'\r\n',b'\n')==(ROOT/file).read_bytes().replace(b'\r\n',b'\n'),'HOST_EXECUTABLE_CHANGED')
 trigger=json.loads(git('show',args.sha+':ops/staging/migration-trigger.json'));leaseid=trigger['lease']
 require(trigger['mode']=='validation' and trigger['execute'] is True and trigger['runtimeDatabase']=='opa_staging' and trigger['testDatabase']=='opa_staging_test' and trigger['server']=='opa-pg-staging' and trigger['identity']=='id-opa-staging-migrations','VALIDATION_ONLY')
 require(datetime.datetime.fromisoformat(trigger['expiresAt'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc),'TRIGGER_EXPIRED')
 env=os.environ.copy();env['GIT_TERMINAL_PROMPT']='0';env['GCM_INTERACTIVE']='Never'
 c=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'-c','credential.interactive=false','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True,env=env,timeout=30);require(c.returncode==0,'GITHUB_AUTH');fields=dict(x.split('=',1) for x in c.stdout.splitlines() if '=' in x);headers={'Authorization':'Bearer '+fields['password'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
 def gh(method,path,body=None,allowed=(200,201,204)):
  r=requests.request(method,'https://api.github.com/repos/'+REPO+path,headers=headers,json=body,timeout=45);require(r.status_code in allowed,'GITHUB_METADATA');return r
 run=gh('GET','/actions/runs/'+str(args.run_id)).json();approved(run,gh('GET','/actions/runs/'+str(args.run_id)+'/pending_deployments').json(),gh('GET','/actions/runs/'+str(args.run_id)+'/approvals').json(),args.sha,args.run_id)
 protection=gh('GET','/environments/staging').json();require(any(x['type']=='required_reviewers' and x.get('reviewers') for x in protection['protection_rules']),'ENVIRONMENT_PROTECTION')
 require(gh('GET','/branches/integration%2Finstitutional-security').json()['commit']['sha']==args.sha,'REMOTE_SHA')
 active=gh('GET','/actions/runs?head_sha='+args.sha+'&per_page=100').json()['workflow_runs'];require(not any(x['id']!=args.run_id and x['path']==WORKFLOW and x['status']!='completed' for x in active),'AMBIGUOUS_JOB')
 auth=json.loads(gh('GET','/environments/staging/variables/OPA_STAGING_MIGRATION_AUTHORIZATION').json()['value']);require(auth['sha']==args.sha and auth['lease']==leaseid and auth['action']=='VALIDATE_MIGRATED_OPA_STAGING' and datetime.datetime.fromisoformat(auth['expiresAt'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc),'AUTHORIZATION')
 cred,sub,tenant=Profile().get_login_credentials(subscription_id=SUB);require(sub==SUB and tenant==TENANT,'AZURE_ACCOUNT');transport=Transport(cred)
 operatorClaims=json.loads(base64.urlsafe_b64decode(cred.get_token('https://management.azure.com/.default').token.split('.')[1]+'==='));require(operatorClaims.get('oid')==OPERATOR,'OPERATOR_IDENTITY')
 temporary=[];iam=None;runner_id=None;test_requested=False;finished=False
 out=ROOT/'artifacts/staging-azure-validation-runs'/str(args.run_id);out.mkdir(parents=True,exist_ok=True);rec=runtime.Recorder(out/'supervisor.json');audit={'runId':args.run_id,'sha':args.sha,'lease':leaseid,'databaseRequested':False}
 def save():(out/'audit.json').write_text(json.dumps(audit,indent=2))
 def arm(method,path,body=None,allowed=(200,201,202,204)):
  require(path.startswith(SCOPE+'/'),'STAGING_SCOPE')
  if method!='GET':
   mutable=[VM+COMPAPI,NIC+NETAPI,NIC+'/effectiveRouteTable'+NETAPI,DISK+DISKAPI,NAT+NETAPI,PIP+NETAPI,SUBNET+NETAPI]+temporary+([iam] if iam else [])+[N+'/networkSecurityGroups/nsg-opa-staging-runner/securityRules/'+x+NETAPI for x in ['Allow-Pinned-Bootstrap-Https','Allow-Azure-Platform-Agent','Allow-Validation-Job-Https','Allow-Validation-AzureAD-Https']]
   require(path in mutable,'MUTATION_SCOPE')
  r=rec.call('azure.'+method,'azure.management',requests.request,method,BASE+path,headers=transport.headers(),json=body,timeout=60);require(r.status_code in allowed,'AZURE_OPERATION');return r
 def remove(path):
  arm('DELETE',path,allowed=(200,202,204,404))
  for _ in range(120):
   if arm('GET',path,allowed=(200,404)).status_code==404:return True
   time.sleep(3)
  return False
 pg=arm('GET',SCOPE+'/providers/Microsoft.DBforPostgreSQL/flexibleServers/opa-pg-staging?api-version=2024-08-01').json();require(pg['properties']['state']=='Ready','POSTGRES_READY')
 roleResult=subprocess.run([AZ,'role','assignment','list','--assignee',PRINCIPAL,'--all','--include-inherited','-o','json','--only-show-errors'],capture_output=True,text=True,timeout=60);require(roleResult.returncode==0,'IAM_READ');roles=json.loads(roleResult.stdout);expected={SCOPE+'/providers/Microsoft.KeyVault/vaults/opa-kv-staging/secrets/opa-staging-'+x for x in SECRETS};require(len(roles)==8 and {x['scope'] for x in roles}==expected and all(x['roleDefinitionId'].endswith('/'+ROLE) for x in roles),'PRODUCTION_IAM')
 vnet=arm('GET',VNET+NETAPI).json()['properties'];require(not vnet.get('virtualNetworkPeerings') and vnet['dhcpOptions']['dnsServers']==['10.72.3.4'],'VNET_BOUNDARY');subnet=next(x for x in vnet['subnets'] if x['id'].lower()==SUBNET.lower())['properties'];require(subnet['addressPrefix']=='10.72.4.0/28' and not subnet.get('routeTable') and not subnet.get('delegations'),'SUBNET_BOUNDARY')
 nic=arm('GET',NIC+NETAPI).json()['properties'];require(len(nic['ipConfigurations'])==1,'NIC_COUNT');ip=nic['ipConfigurations'][0]['properties'];require(ip['privateIPAddress']=='10.72.4.4' and not ip.get('publicIPAddress') and ip['subnet']['id'].lower()==SUBNET.lower(),'NIC_BOUNDARY')
 vm=arm('GET',VM+COMPAPI).json();require(vm['properties']['hardwareProfile']['vmSize']=='Standard_D2as_v6' and list(vm['identity']['userAssignedIdentities'])==[SCOPE+'/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-opa-staging-migrations'],'VM_IDENTITY');require(vm['identity']['type']=='UserAssigned' and [x['id'].lower() for x in vm['properties']['networkProfile']['networkInterfaces']]==[NIC.lower()],'VM_NETWORK_PROFILE');disk=vm['properties']['storageProfile']['osDisk'];require(disk['name']=='osdisk-opa-staging-validation-01' and disk['diskSizeGB']==32 and disk['managedDisk']['storageAccountType']=='StandardSSD_LRS','VM_DISK_BOUNDARY')
 response=arm('POST',NIC+'/effectiveRouteTable'+NETAPI,allowed=(200,202));data=response.json() if response.content else {};data=data or {}
 for _ in range(30):
  if 'value' in data:break
  time.sleep(2);r=requests.get(response.headers['Location'],headers=transport.headers(),timeout=60);r.raise_for_status();data=r.json() or {}
 require('value' in data,'ROUTE_METADATA');routes(data['value'])
 for zone in ['opa-staging.postgres.database.azure.com','privatelink.vaultcore.azure.net']:
  links=arm('GET',N+'/privateDnsZones/'+zone+'/virtualNetworkLinks?api-version=2020-06-01').json()['value'];require(links and all(x['properties']['virtualNetwork']['id'].lower()==VNET.lower() for x in links),'DNS_BINDING')
 probe=transport.probe();require(probe['listenerStopped'],'LISTENER_ALREADY_RUNNING')
 addresses=subprocess.run(['powershell','-NoProfile','-Command',"@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -like '172.27.240.*' | Select-Object -ExpandProperty IPAddress) | ConvertTo-Json -Compress"],capture_output=True,text=True,timeout=30);admin=json.loads(addresses.stdout);admin=admin if isinstance(admin,list) else [admin];require(len(admin)==1 and re.fullmatch(r'172\.27\.240\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])',admin[0]),'CUSTODIAN_VPN_SOURCE')
 contract=json.loads((ROOT/'ops/staging/azure-runner-contract.json').read_text());lease={'id':leaseid,'repository':REPO,'approvedSha':args.sha,'mode':'migration-validation','source':'10.72.4.4/32','expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=55)).isoformat(),'hostMounts':0,'cleanupOwner':'operator-host-azure','runner':contract,'custodianSource':admin[0]+'/32','azurePreflight':{'postgresState':'Ready','principalId':PRINCIPAL,'productionAssignments':0,'approvedSecretAssignments':8,'productionRoutes':0,'productionDnsBindings':0,'privatePostgres':'10.72.1.4','privateVault':'10.72.2.4','publicVmIp':False}}
 # Verify signed policy and lease together before introducing temporary access.
 envelope=json.loads(gh('GET','/environments/staging/variables/OPA_STAGING_MIGRATION_POLICY').json()['value']);check="const x=JSON.parse(require('fs').readFileSync(0,'utf8'));const p=require('./apps/api/scripts/staging-oidc.cjs').validatePolicy(x.policy,x.lease.approvedSha);require('./apps/api/scripts/staging-azure-runner.cjs').policy(p,x.lease);"
 result=subprocess.run([NODE,'-e',check],cwd=ROOT,input=json.dumps({'policy':envelope,'lease':lease}),capture_output=True,text=True,timeout=30);require(result.returncode==0,'SIGNED_POLICY_LEASE');audit['leaseBinding']=lease;save()
 def custody(action):
  payload={'action':action,'sha':args.sha,'lease':leaseid,'source':lease['custodianSource'],'expiresAt':lease['expiresAt'],'vaultToken':cred.get_token('https://vault.azure.net/.default').token}
  r=rec.call('custodian.'+action,'custodian',subprocess.run,[NODE,str(ROOT/'apps/api/scripts/staging-validation-custodian.cjs')],input=json.dumps(payload),capture_output=True,text=True,timeout=180);payload.clear()
  try:answer=json.loads(r.stdout)
  except ValueError:raise RuntimeError('CUSTODIAN_RESULT')
  code=answer.get('code','FAILED');code=code if isinstance(code,str) and re.fullmatch('[A-Z0-9_]+',code) else 'FAILED';require(r.returncode==0 and answer.get('status')=='ready','CUSTODIAN_'+code);return answer
 phase='results-storage-preflight'
 try:
  # The approved completed job is provenance for the exact host, not a promise
  # that GitHub will keep using it for every future job. Unknown hosts fail closed.
  metadata=gh('GET','/actions/jobs/'+str(results_network.METADATA_JOB)).json()
  require(metadata['run_id']==results_network.METADATA_RUN and metadata['status']=='completed','RESULTS_METADATA_PROVENANCE')
  redirect=requests.get('https://api.github.com/repos/'+REPO+'/actions/jobs/'+str(results_network.METADATA_JOB)+'/logs',headers=headers,allow_redirects=False,timeout=30)
  results_host=results_network.metadata_host(redirect.status_code,redirect.headers.get('Location'))
  discovery=transport.results(results_host,dns_only=True);results_ips=results_network.dns_binding(discovery)
  result_rule=N+'/networkSecurityGroups/nsg-opa-staging-runner/securityRules/opa-results-'+leaseid+NETAPI
  require(arm('GET',result_rule,allowed=(200,404)).status_code==404,'RESULTS_RULE_EXISTS')
  temporary.append(result_rule);audit['temporaryRules']=list(temporary)
  audit['resultsNetwork']={'hostname':results_host,'sourceJobId':results_network.METADATA_JOB,'sourceRunId':results_network.METADATA_RUN,'addresses':results_ips,'ttlSeconds':discovery.get('ttlSeconds'),'rule':result_rule,'priority':results_network.PRIORITY,'source':'10.72.4.4/32','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};save()
  result_body=results_network.rule(results_host,results_ips);arm('PUT',result_rule,result_body)
  proof=transport.results(results_host,results_ips)
  nat_response=arm('GET',NAT+NETAPI,allowed=(200,404));nat_properties=nat_response.json().get('properties',{}) if nat_response.status_code==200 else {};runner_subnet=arm('GET',SUBNET+NETAPI).json()['properties']
  nat_ready=nat_properties.get('provisioningState')=='Succeeded' and runner_subnet.get('natGateway',{}).get('id','').lower()==NAT.lower() and [x['id'].lower() for x in nat_properties.get('publicIpAddresses',[])]==[PIP.lower()]
  rule_response=arm('GET',result_rule,allowed=(200,404));correct_rule=rule_response.status_code==200 and results_network.rule_matches(rule_response.json(),result_body)
  decision=results_network.classify(proof,results_ips,nat_ready,correct_rule)
  audit['resultsNetwork']['preflight']=proof;audit['resultsNetwork']['decision']=decision;save();require(decision=='PASS',decision)
  phase='prisma-engine-preflight'
  engine=transport.engine();audit['prismaEnginePreflight']=engine;save();results_network.engine_check(engine)
  phase='custodian-preflight'
  for suffix,destination,port,nsg in [('postgres','10.72.1.4','5432','nsg-opa-staging-postgres'),('vault','10.72.2.4','443','nsg-opa-staging-private-endpoints')]:
   resource=N+'/networkSecurityGroups/'+nsg+'/securityRules/opa-azure-custodian-'+leaseid+'-'+suffix+NETAPI;require(arm('GET',resource,allowed=(200,404)).status_code==404,'TEMP_RULE_EXISTS');temporary.append(resource);audit['temporaryRules']=list(temporary);save()
   arm('PUT',resource,{'properties':{'priority':900,'direction':'Inbound','access':'Allow','protocol':'Tcp','sourceAddressPrefix':lease['custodianSource'],'sourcePortRange':'*','destinationAddressPrefix':destination+'/32','destinationPortRange':port}})
  scope=SCOPE+'/providers/Microsoft.KeyVault/vaults/opa-kv-staging/secrets/opa-staging-bootstrap-db-password';iam=scope+'/providers/Microsoft.Authorization/roleAssignments/'+str(uuid.uuid5(uuid.NAMESPACE_URL,'opa-azure-custodian-'+leaseid))+'?api-version=2022-04-01';require(arm('GET',iam,allowed=(200,404)).status_code==404,'TEMP_IAM_EXISTS');audit['temporaryIam']=iam;save();arm('PUT',iam,{'properties':{'principalId':OPERATOR,'principalType':'User','roleDefinitionId':'/subscriptions/'+SUB+'/providers/Microsoft.Authorization/roleDefinitions/'+ROLE}})
  ready=None
  for _ in range(12):
   try:ready=custody('inspect');break
   except RuntimeError as exc:
    if str(exc)!='CUSTODIAN_BOOTSTRAP_SECRET_ACCESS':raise
    time.sleep(5)
  require(ready is not None,'CUSTODIAN_NOT_READY')
  current=[x for x in gh('GET','/actions/runners?per_page=100').json()['runners'] if x['name']==NAME];require(len(current)<=1 and all(not x['busy'] and x['status']=='offline' for x in current),'RUNNER_STATE')
  for x in current:gh('DELETE','/actions/runners/'+str(x['id']))
  jit=gh('POST','/actions/runners/generate-jitconfig',{'name':NAME,'runner_group_id':1,'labels':['self-hosted','linux',LABEL,args.sha],'work_folder':'_work'}).json();runner_id=jit['runner']['id'];jit['encoded_jit_config']=seal_jit(jit['encoded_jit_config']);audit['runnerId']=runner_id;save()
  phase='results-storage-launch-check'
  final_network=transport.results(results_host,results_ips);final_decision=results_network.classify(final_network,results_ips,nat_ready,correct_rule);audit['resultsNetwork']['launchProof']=final_network;audit['resultsNetwork']['launchDecision']=final_decision;save();require(final_decision=='PASS',final_decision)
  phase='prisma-engine-launch-check'
  engine=transport.engine();audit['prismaEngineLaunchProof']=engine;save();results_network.engine_check(engine)
  # Check approval again immediately before the only listener start operation.
  approved(gh('GET','/actions/runs/'+str(args.run_id)).json(),gh('GET','/actions/runs/'+str(args.run_id)+'/pending_deployments').json(),gh('GET','/actions/runs/'+str(args.run_id)+'/approvals').json(),args.sha,args.run_id)
  phase='validation-job'
  transport.launch(lease,ready,jit['encoded_jit_config']);jit.clear();handled=set();deadline=time.monotonic()+45*60;next_dns_check=time.monotonic()+60
  while time.monotonic()<deadline:
   run=gh('GET','/actions/runs/'+str(args.run_id)).json()
   if run['status']=='completed':audit['conclusion']=run['conclusion'];finished=run['conclusion']=='success';break
   if time.monotonic()>=next_dns_check:
    phase='results-dns-monitor'
    observed=transport.results(results_host,dns_only=True);audit['resultsNetwork']['lastDnsObservation']=observed;save();results_network.unchanged(observed,results_ips);next_dns_check=time.monotonic()+60
   phase='validation-job'
   request=transport.request()['request']
   if request:
    require(request['sha']==args.sha and request['lease']==leaseid and request['action'] in ('create','drop','cleanup'),'CUSTODIAN_REQUEST_BINDING');action=request['action']
    if action not in handled:
     if action=='create':
      test_requested=True;audit['databaseRequested']=True;save();answer=custody('create');transport.publish('opa-staging-test-access.json',answer);answer.clear()
     elif test_requested:
      answer=custody('drop');audit['testDatabaseAbsent']=True;transport.publish('opa-staging-test-cleaned.json',answer)
     handled.add(action)
   time.sleep(2)
  require(finished,'VALIDATION_NOT_SUCCESSFUL')
 except Exception as exc:
  code=str(exc) if isinstance(exc,RuntimeError) and re.fullmatch('[A-Z0-9_]+',str(exc)) else 'SANITIZED_FAILURE'
  audit['failure']={'stage':phase,'code':code,'exceptionClass':type(exc).__name__};save();raise
 finally:
  def cancel():
   if not finished:gh('POST','/actions/runs/'+str(args.run_id)+'/cancel',{},allowed=(202,409))
   return True
  def database():
   if test_requested:custody('drop')
   audit['testDatabaseAbsent']=True;save();return True
  def registration():
   for x in gh('GET','/actions/runners?per_page=100').json()['runners']:
    if x['name']==NAME:gh('DELETE','/actions/runners/'+str(x['id']),allowed=(204,404))
   return not any(x['name']==NAME for x in gh('GET','/actions/runners?per_page=100').json()['runners'])
  def network():
   results={};
   for i,p in enumerate(temporary):runtime.cleanup_step('temporary-network-'+str(i),lambda p=p:remove(p),rec,results)
   audit['networkCleanup']=results;return all(results.values())
  def authorization():
   path='/environments/staging/variables/OPA_STAGING_MIGRATION_AUTHORIZATION';r=gh('GET',path,allowed=(200,404))
   if r.status_code==404:return True
   a=json.loads(r.json()['value']);require(a['sha']==args.sha and a['lease']==leaseid,'AUTH_CLEANUP_OWNERSHIP');gh('DELETE',path,allowed=(204,404))
   for _ in range(12):
    if gh('GET',path,allowed=(200,404)).status_code==404:return True
    time.sleep(2)
   return False
  def nat():
   sub=arm('GET',SUBNET+NETAPI).json()['properties'];require(not sub.get('ipConfigurations'),'SUBNET_NOT_EMPTY');require(not sub.get('natGateway') or sub['natGateway']['id'].lower()==NAT.lower(),'NAT_OWNERSHIP');body={k:sub[k] for k in ['addressPrefix','networkSecurityGroup','delegations','serviceEndpoints','defaultOutboundAccess'] if k in sub};arm('PUT',SUBNET+NETAPI,{'properties':body})
   for _ in range(30):
    if not arm('GET',SUBNET+NETAPI).json()['properties'].get('natGateway'):break
    time.sleep(2)
   paths=[NAT+NETAPI,PIP+NETAPI]+[N+'/networkSecurityGroups/nsg-opa-staging-runner/securityRules/'+rule+NETAPI for rule in ['Allow-Pinned-Bootstrap-Https','Allow-Azure-Platform-Agent','Allow-Validation-Job-Https','Allow-Validation-AzureAD-Https']]
   results={}
   for i,path in enumerate(paths):runtime.cleanup_step('egress-'+str(i),lambda path=path:remove(path),rec,results)
   audit['egressCleanup']=results;return all(results.values())
  operations={'cancel':cancel,'stop':lambda:transport.stop()['stopped'],'database':database,'registration':registration,'secrets':lambda:transport.clear()['tmpfsRemoved'],'iam':lambda:not iam or remove(iam),'network':network,'authorization':authorization,'vm':lambda:remove(VM+COMPAPI),'nic':lambda:remove(NIC+NETAPI),'disk':lambda:remove(DISK+DISKAPI),'nat':nat}
  audit['cleanup']=cleanup(operations,rec);save();require(all(audit['cleanup'].values()),'CLEANUP_INCOMPLETE')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--sha',required=True);p.add_argument('--run-id',required=True,type=int);args=p.parse_args()
 try:execute(args)
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) and re.fullmatch('[A-Z0-9_]+',str(e)) else 'SANITIZED_FAILURE'
  print(json.dumps({'status':'STOPPED','code':code,'exceptionClass':type(e).__name__}));raise SystemExit(1)
