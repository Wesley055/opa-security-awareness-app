'use strict';
// Public Azure deployment runs on the existing operator host. Application
// restarts therefore cannot kill the controller or its rollback obligation.
const fs=require('node:fs'),path=require('node:path');
const C=require('./production/contract.cjs'),cutover=require('./production/cutover.cjs'),session=require('./release-session.cjs');
// Scoped to this release entry point; the core executor is unchanged.
function createPointOfUseFetch({release,acquire,request=globalThis.fetch,save=()=>{},now=Date.now,getDeadline=()=>now()+30000}) {
 const armOrigin='https://management.azure.com',vaultOrigin='https://opa-kv-production.vault.azure.net',scmOrigin=release.manifest.scmOrigin;
 const events=[];let blocked=false,pendingDeployment,pendingHeaders;
 const emit=(event)=>{C.requireThat(events.length<512,'RELEASE_TOKEN_AUDIT_BOUND');events.push(event);save({version:1,manifestSHA256:release.sha256,events});};
 const checkSignal=o=>o.signal?.throwIfAborted();
 const token=async(resource,force,options)=>{
  checkSignal(options);let value;
  try{const remaining=getDeadline()-now();C.requireThat(remaining>0,'DEPLOYMENT_DEADLINE');const minSeconds=Math.ceil(Math.min(600000,remaining)/1000)+60;
   value=await acquire(resource,force,options.signal,minSeconds);const parts=value.split('.');C.requireThat(parts.length===3&&parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)),'RELEASE_TOKEN_FORMAT');const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
   C.requireThat(header.alg==='RS256'&&typeof header.kid==='string'&&!header.jku&&!header.x5u&&!header.crit,'RELEASE_TOKEN_SIGNATURE');
   const issuer=claims.ver==='1.0'?'https://sts.windows.net/adb3fb59-1ac3-42c2-b39a-d70c7006ccbc/':claims.ver==='2.0'?'https://login.microsoftonline.com/adb3fb59-1ac3-42c2-b39a-d70c7006ccbc/v2.0':null;C.requireThat(issuer&&claims.iss===issuer,'RELEASE_TOKEN_ISSUER');
   C.requireThat(claims.oid===release.manifest.operatorObjectId&&claims.tid==='adb3fb59-1ac3-42c2-b39a-d70c7006ccbc','APPROVED_OPERATOR_IDENTITY_REQUIRED');
   const audiences=resource===armOrigin+'/'?[armOrigin+'/','https://management.core.windows.net/']:['https://vault.azure.net','https://vault.azure.net/','cfa8b339-82a2-471a-a3c9-0fc0be7a4093'];
   C.requireThat(audiences.includes(claims.aud)&&Number.isFinite(claims.exp)&&claims.exp*1000>=now()+minSeconds*1000&&(claims.nbf||0)*1000<=now()+30000,'RELEASE_FRESH_TOKEN_REQUIRED');
   checkSignal(options);C.requireThat(now()<getDeadline(),'DEPLOYMENT_DEADLINE');emit({kind:'token',resource:resource===armOrigin+'/'?'ARM':'VAULT',refresh:force,status:'usable',requiredSeconds:minSeconds});return value;
  }catch{emit({kind:'token',resource:resource===armOrigin+'/'?'ARM':'VAULT',refresh:force,status:'rejected'});throw Error('RELEASE_TOKEN_ACQUISITION_REJECTED');}
 };
 function scope(input,options){
  const u=new URL(input),method=(options.method||'GET').toUpperCase();let resource;
  C.requireThat(!u.username&&!u.password,'RELEASE_REQUEST_CREDENTIAL_URL');
  if(u.origin===armOrigin){C.requireThat(u.pathname.startsWith(release.manifest.appResourceId+'/'),'RELEASE_TOKEN_RESOURCE_SCOPE');resource=armOrigin+'/';}
  if(u.origin===vaultOrigin){C.requireThat(u.pathname==='/secrets/opa-api-runtime-custody','RELEASE_TOKEN_RESOURCE_SCOPE');resource='https://vault.azure.net';}
  const managed=Boolean(resource)||u.origin===scmOrigin;
  const read=['GET','HEAD','OPTIONS'].includes(method)||(resource===armOrigin+'/'&&method==='POST'&&u.pathname===release.manifest.appResourceId+'/config/appsettings/list');
  return {u,method,resource,managed,read};
 }
 async function send(input,options,resource,force=false){
  checkSignal(options);const headers=new Headers(options.headers);
  if(resource)headers.set('Authorization','Bearer '+await token(resource,force,options));
  return request(input,{...options,headers,redirect:'error'});
 }
 async function read(input,options,resource,force=false){
  let response=await send(input,options,resource,force);
  if(response.status===401&&resource&&!force){emit({kind:'read',status:'refresh-once'});response=await send(input,options,resource,true);}
  return response;
 }
 async function reconcile(input,options,s){
  emit({kind:'write',status:'reconciling',resource:s.resource?'AZURE':'SCM',method:s.method});
  let target=input,probe={...options,method:'GET',body:undefined};
  if(s.resource===armOrigin+'/'&&s.u.pathname.endsWith('/config/appsettings')){
   target=new URL(input);target.pathname+='/list';probe.method='POST';
  }
  if(s.u.origin===scmOrigin&&s.u.pathname==='/api/zipdeploy'){
   // A latest-deployment record cannot prove which ZIP an interrupted POST admitted.
   try{const r=await read(scmOrigin+'/api/deployments/latest',probe,undefined);emit({kind:'deployment-observation',httpStatus:r.status});}catch{emit({kind:'deployment-observation',status:'unavailable'});}
   return null;
  }
  try{
   const observed=await read(target,probe,s.resource,true);if(!observed.ok)return null;
   let matched=false;
   if(s.resource){const desired=JSON.parse(options.body),actual=await observed.clone().json();
    matched=s.resource==='https://vault.azure.net'?typeof desired.value==='string'&&actual.value===desired.value:Boolean(desired.properties&&actual.properties)&&canonical(actual.properties)===canonical(desired.properties);
   }else if(s.u.pathname.endsWith('/'))matched=true;
   else matched=C.hash(Buffer.from(await observed.clone().arrayBuffer()))===C.hash(Buffer.from(options.body));
   if(matched){emit({kind:'write',status:'confirmed-by-readback',resource:s.resource?'AZURE':'SCM'});return observed;}
  }catch{ /* no mutation replay when reconciliation fails */ }
  return null;
 }
 async function settlePending(options){
  if(!pendingDeployment)return;
  try{
   const r=await read(pendingDeployment,{...options,headers:pendingHeaders,method:'GET',body:undefined},undefined);
   const result=r.ok?await r.json():{};
   if([3,4].includes(result.status)){emit({kind:'deployment',status:'terminal-state-confirmed',deploymentStatus:result.status});pendingDeployment=undefined;pendingHeaders=undefined;return;}
  }catch{ /* an in-flight deployment must not be superseded blindly */ }
  blocked=true;emit({kind:'deployment',status:'outcome-uncertain'});throw Error('RELEASE_OPERATION_OUTCOME_UNCERTAIN');
 }
 return async function pointOfUseFetch(input,options={}){
  const s=scope(input,options);if(!s.managed)return request(input,options);
  if(s.read){const response=await read(input,options,s.resource);
   if(pendingDeployment&&String(input)===pendingDeployment&&response.ok){const result=await response.clone().json();if([3,4].includes(result.status)){pendingDeployment=undefined;pendingHeaders=undefined;}}
   return response;
  }
  C.requireThat(!blocked,'RELEASE_OPERATION_OUTCOME_UNCERTAIN');await settlePending(options);
  // Acquire before sending: acquisition failure is known to precede any mutation.
  const headers=new Headers(options.headers);if(s.resource)headers.set('Authorization','Bearer '+await token(s.resource,false,options));
  let response;emit({kind:'write',resource:s.resource?'AZURE':'SCM',method:s.method,status:'sending'});
  try{checkSignal(options);response=await request(input,{...options,headers,redirect:'error'});}
  catch{response=null;}
  if(response?.ok){
   if(s.u.origin===scmOrigin&&s.u.pathname==='/api/zipdeploy'){
    const location=response.headers.get('location');
    if(response.status!==202||!location){blocked=true;emit({kind:'deployment',status:'outcome-uncertain'});throw Error('RELEASE_OPERATION_OUTCOME_UNCERTAIN');}
    let status;try{status=new URL(location,scmOrigin)}catch{blocked=true;throw Error('RELEASE_OPERATION_OUTCOME_UNCERTAIN')}
    if(status.origin!==scmOrigin||!status.pathname.startsWith('/api/deployments/')){blocked=true;emit({kind:'deployment',status:'outcome-uncertain'});throw Error('RELEASE_OPERATION_OUTCOME_UNCERTAIN');}pendingDeployment=status.toString();pendingHeaders=new Headers(options.headers);
   }
   emit({kind:'write',status:'accepted',httpStatus:response.status});return response;
  }
  const confirmed=await reconcile(input,options,s);if(confirmed)return confirmed;
  blocked=true;emit({kind:'write',status:'outcome-uncertain',httpStatus:response?.status||null});throw Error('RELEASE_OPERATION_OUTCOME_UNCERTAIN');
 };
}
function canonical(value){if(Array.isArray(value))return JSON.stringify(value.map(x=>JSON.parse(canonical(x))));if(value&&typeof value==='object')return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])));return JSON.stringify(value);}
function operatorTokenProvider(file,approved,release){
 const {execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile),provider=path.join(__dirname,'release-operator-input.py');
 return async(resource,force,signal,minSeconds)=>{
  C.requireThat(C.hash(fs.readFileSync(provider))===release.manifest.executionTools?.['ops/release-operator-input.py'],'EXECUTION_TOOL_CHANGED');
  const python=process.env.OPA_RELEASE_PYTHON||'C:/Program Files/Microsoft SDKs/Azure/CLI2/python.exe';
  try{const result=await run(python,['-B',provider,'--token',file,approved,resource,force?'refresh':'cached',String(minSeconds)],{timeout:30000,maxBuffer:65536,windowsHide:true,signal});return JSON.parse(result.stdout).token;}
  catch{throw Error('RELEASE_TOKEN_ACQUISITION_REJECTED');}
 };
}

async function main(){
 const [file,approved,receiptFile]=process.argv.slice(2);
 C.requireThat(process.env.OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256===approved,'EXPLICIT_FINAL_CUTOVER_AUTHORIZATION_REQUIRED');
 C.requireThat(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'NODE_INJECTION');
 const release=cutover.verify(file);C.requireThat(release.sha256===approved,'EXACT_CUTOVER_APPROVAL_REQUIRED');
 const databaseBytes=fs.readFileSync(receiptFile);
 C.requireThat(C.hash(databaseBytes)===process.env.OPA_VERIFIED_DATABASE_RECEIPT_SHA256,'AUTHENTICATED_DATABASE_RECEIPT_REQUIRED');
 const databaseReceipt=JSON.parse(databaseBytes),bytes=fs.readFileSync(0);C.requireThat(bytes.length<=65536,'RELEASE_INPUT_SIZE');
 let input;try{input=JSON.parse(bytes)}finally{bytes.fill(0)}
 const names=session.privilegedInputs(input,release.manifest.executionTimeoutSeconds,Date.now(),false),env={...input};
 let fd,tokenFd,operationDeadline;const previousFetch=globalThis.fetch;
 try {
  const tokenReceipt=path.resolve(path.dirname(receiptFile),release.manifest.releaseId+'.token-operation-receipt.json');tokenFd=fs.openSync(tokenReceipt,'wx',0o600);
  const saveToken=r=>{fs.ftruncateSync(tokenFd,0);fs.writeSync(tokenFd,JSON.stringify(r,null,2));fs.fsyncSync(tokenFd)};
  globalThis.fetch=createPointOfUseFetch({release,acquire:operatorTokenProvider(file,approved,release),request:previousFetch,save:saveToken,getDeadline:()=>operationDeadline});
  const outputFile=path.resolve(path.dirname(receiptFile),release.manifest.releaseId+'.cutover-receipt.json');fd=fs.openSync(outputFile,'wx',0o600);
  const save=r=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(r,null,2));fs.fsyncSync(fd)};
  const adapters=require('./production/cutover-host.cjs').create(env);
  for(const name of ['publishRuntime','deploy','health']){const operation=adapters[name];adapters[name]=async(...args)=>{operationDeadline=args[2];try{return await operation(...args)}finally{operationDeadline=undefined}};}
  const result=await cutover.execute(release,{adapters,databaseReceipt,save});
  console.log(JSON.stringify({status:result.status,manifestSHA256:approved,receipt:outputFile}));
 } finally {globalThis.fetch=previousFetch;if(tokenFd!==undefined)fs.closeSync(tokenFd);for(const name of names){delete env[name];delete input[name]}if(fd!==undefined)fs.closeSync(fd)}
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'DEPLOYMENT_PHASE_REJECTED');process.exitCode=1});

module.exports={createPointOfUseFetch,operatorTokenProvider};
