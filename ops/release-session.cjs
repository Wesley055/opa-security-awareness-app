'use strict';
// Release-only launcher. Intentionally outside ops/production: the reviewed
// executor stays byte-for-byte unchanged. Privileged inputs arrive on stdin.
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const R=(v,c)=>{if(!v)throw Error(c)};
const HOST='opa-api-production-server.postgres.database.azure.com',DB='opa-api-production-database',ROLE='opa_production_migrations';
function migrationURL(password){R(typeof password==='string'&&password.length>0,'MIGRATION_PASSWORD_REQUIRED');return `postgresql://${ROLE}:${encodeURIComponent(password)}@${HOST}:5432/${DB}?sslmode=require&sslaccept=strict`}
async function acquire(policy,env,{request=fetch,identity=require('./production/app-service-identity.cjs')}={}) {
 await identity.verifyAppIdentity(policy,env);
 const endpoint=identity.endpoint(env.IDENTITY_ENDPOINT);endpoint.searchParams.set('resource','https://vault.azure.net');
 const get=async(url,headers)=>{const r=await request(url,{headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});R(r.ok,'RELEASE_READ_CREDENTIAL_REJECTED');return r.json()};
 const token=await get(endpoint,{'X-IDENTITY-HEADER':env.IDENTITY_HEADER});
 try {
  R(typeof token.access_token==='string'&&token.access_token.length>0,'RELEASE_READ_TOKEN');
  const binding=policy.secrets?.DATABASE_URL,origin=policy.resources?.vault?.secretOrigin;
  R(origin==='https://opa-kv-production.vault.azure.net'&&binding?.vaultId===policy.resources.vault.id&&/^https:\/\/opa-kv-production\.vault\.azure\.net\/secrets\/opa-production-database-migration-password\/[a-f0-9]{32}$/.test(binding.secretId||''),'VERSIONED_MIGRATION_SECRET');
  const secret=await get(binding.secretId+'?api-version=7.4',{Authorization:'Bearer '+token.access_token});
  try{R(secret.id===binding.secretId&&secret.attributes?.enabled!==false,'MIGRATION_SECRET_VERSION');const url=migrationURL(secret.value);R(hash(url)===binding.sha256,'EXACT_MIGRATION_URL_BINDING');return url}
  finally{secret.value=undefined}
 } finally {token.access_token=undefined}
}

function applicationEnvironment(base,{readFS=fs,names}={}) {
 if(base.IDENTITY_ENDPOINT&&base.IDENTITY_HEADER&&base.DATABASE_URL)return {...base};
 const boundary=names?null:require('../packages/environment-policy/index.cjs');
 const allowed=new Set(names||[...boundary.secretNames,...boundary.settingNames,'OPA_ENVIRONMENT','NODE_ENV','OPA_BUILD_SHA','OPA_DEPLOYMENT_RESOURCE_ID','OPA_ENVIRONMENT_POLICY_FILE','OPA_API_ORIGIN','IDENTITY_ENDPOINT','IDENTITY_HEADER','WEBSITE_PRIVATE_IP']);
 for(const pid of readFS.readdirSync('/proc').filter(n=>/^[0-9]+$/.test(n))) {
  let bytes;
  try {
   const command=readFS.readFileSync('/proc/'+pid+'/cmdline','utf8');if(!command.includes('node')||!command.includes('dist/main'))continue;
   bytes=readFS.readFileSync('/proc/'+pid+'/environ');const values=Object.fromEntries(bytes.toString().split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)]}));
   if(values.WEBSITE_SITE_NAME!=='opa-api-production'||values.OPA_ENVIRONMENT!=='production'||!values.IDENTITY_ENDPOINT||!values.IDENTITY_HEADER)continue;
   const selected=Object.fromEntries(Object.entries(values).filter(([k])=>allowed.has(k)));
   R(selected.IDENTITY_ENDPOINT&&selected.IDENTITY_HEADER,'APPLICATION_MANAGED_IDENTITY_UNAVAILABLE');return {...base,...selected};
  } catch(e){if(e.message==='APPLICATION_MANAGED_IDENTITY_UNAVAILABLE')throw e}
  finally{if(bytes)bytes.fill(0)}
 }
 throw Error('ACTUAL_APPLICATION_ENVIRONMENT_UNAVAILABLE');
}

function privilegedInputs(input,seconds,now=Date.now(),includeAdmin=true) {
 R(input&&typeof input==='object'&&!Array.isArray(input),'RELEASE_PRIVILEGED_INPUT');
 const names=['OPA_RELEASE_ARM_TOKEN','OPA_RELEASE_VAULT_TOKEN','OPA_RELEASE_SCM_AUTHORIZATION',...(includeAdmin?['OPA_RELEASE_ADMIN_DATABASE_URL']:[])];
 R(Object.keys(input).length===names.length&&names.every(n=>typeof input[n]==='string'&&input[n].length>0),'SEPARATELY_AUTHORIZED_RELEASE_CREDENTIALS');
 for(const name of names.slice(0,2)) {let claims;try{claims=JSON.parse(Buffer.from(input[name].split('.')[1],'base64url'))}catch{throw Error('RELEASE_TOKEN_LIFETIME')}
  // Azure verifies signatures/permissions. Admission needs only a usable token;
  // the local deployment controller acquires tokens anew at each ARM/Vault use.
  R(Number.isFinite(claims.exp)&&claims.exp*1000>=now+60000,'RELEASE_TOKEN_LIFETIME');
 }
 if(includeAdmin){const u=new URL(input.OPA_RELEASE_ADMIN_DATABASE_URL);
 R(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname===HOST&&Number(u.port||5432)===5432&&decodeURIComponent(u.pathname.slice(1))===DB&&u.password&&!['opa_production_runtime',ROLE,'opa_production_release_owner'].includes(decodeURIComponent(u.username))&&u.searchParams.get('sslmode')==='require'&&u.searchParams.get('sslaccept')==='strict','RELEASE_ADMIN_BINDING')}
 return names;
}
async function execute(file,approved,input,env=process.env,{cutover=require('./production/cutover.cjs'),host=require('./production/cutover-host.cjs'),read=acquire,inherit=applicationEnvironment,save}={}) {
 R(env.OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256===approved&&/^[a-f0-9]{64}$/.test(approved||''),'EXPLICIT_FINAL_CUTOVER_AUTHORIZATION_REQUIRED');
 const release=cutover.verify(file);R(release.sha256===approved,'EXACT_CUTOVER_APPROVAL_REQUIRED');
 const names=privilegedInputs(input,release.manifest.executionTimeoutSeconds),runtimeEnv=inherit(env),session={...runtimeEnv,...input};
 const previousIdentity=Object.fromEntries(['IDENTITY_ENDPOINT','IDENTITY_HEADER'].map(n=>[n,process.env[n]]));
 let fd;
 try {
  session.OPA_RELEASE_MIGRATION_DATABASE_URL=await read(release.manifest.migration,runtimeEnv);
  for(const n of ['IDENTITY_ENDPOINT','IDENTITY_HEADER'])if(runtimeEnv[n])process.env[n]=runtimeEnv[n];
  const receiptFile=require('node:path').resolve(require('node:path').dirname(file),release.manifest.releaseId+'.database-phase-receipt.json');
  if(!save){fd=fs.openSync(receiptFile,'wx',0o600);save=r=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(r,null,2));fs.fsyncSync(fd)}}
  const result=await cutover.execute(release,{adapters:host.create(session),save,migrationOnly:true});
  return {status:result.status,manifestSHA256:approved,receipt:receiptFile};
 } finally {for(const n of [...names,'OPA_RELEASE_MIGRATION_DATABASE_URL']){delete session[n];delete input[n]}for(const n of ['IDENTITY_ENDPOINT','IDENTITY_HEADER']){if(previousIdentity[n]===undefined)delete process.env[n];else process.env[n]=previousIdentity[n]}for(const n of Object.keys(session))delete session[n];for(const n of Object.keys(runtimeEnv))delete runtimeEnv[n];if(fd!==undefined)fs.closeSync(fd)}
}
async function main(){const [mode,file,approved]=process.argv.slice(2);R(mode==='--migrate','RELEASE_SESSION_MODE');R(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'NODE_INJECTION');const bytes=fs.readFileSync(0);R(bytes.length<=65536,'RELEASE_INPUT_SIZE');let input;try{input=JSON.parse(bytes)}finally{bytes.fill(0)}console.log(JSON.stringify(await execute(file,approved,input)))}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'RELEASE_SESSION_REJECTED');process.exitCode=1});
module.exports={applicationEnvironment,migrationURL,acquire,privilegedInputs,execute,hash};
