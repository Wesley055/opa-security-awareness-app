'use strict';
// Fixed staging targets. Tokens and vault values never leave process memory/stdin.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),dns=require('node:dns').promises;
const {spawnSync}=require('node:child_process');
const boundary=require('../../../packages/environment-policy/index.cjs');
const REPO='Wesley055/opa-security-awareness-app';
const REF='refs/heads/integration/institutional-security';
const TENANT='adb3fb59-1ac3-42c2-b39a-d70c7006ccbc';
const CLIENT='453f70fc-09c5-43ea-8a63-6c3304cf5dfc';
const PRINCIPAL='737caf69-640d-485e-9be5-c0095633a27e';
const SCOPE='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/rg-opa-staging';
const VAULT='https://opa-kv-staging.vault.azure.net';
const SECRET_NAMES={DATABASE_URL:'opa-staging-database-migration-url',REDIS_URL:'opa-staging-redis-url',AZURE_STORAGE_CONNECTION_STRING:'opa-staging-storage-connection',ENROLLMENT_ENCRYPTION_KEY:'opa-staging-enrollment-encryption-key',JWT_ACCESS_SECRET:'opa-staging-jwt-access-secret',JWT_REFRESH_SECRET:'opa-staging-jwt-refresh-secret',PII_ENCRYPTION_KEYS_JSON:'opa-staging-pii-encryption-ring',PII_LOOKUP_KEY:'opa-staging-pii-lookup-key'};
function reject(){throw Error('Staging OIDC preflight rejected');}
function execution(env){
 if(env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!==REF||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||''))reject();
 if(!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||env.OPA_APPROVED_SHA!==env.GITHUB_SHA)reject();
 if(!['auth-only','migrate'].includes(env.OPA_STAGING_MODE))reject();
 if(env.OPA_STAGING_MODE==='migrate'&&env.OPA_MIGRATION_CONFIRMATION!=='MIGRATE_OPA_STAGING')reject();
 return env.OPA_STAGING_MODE;
}
function validatePolicy(envelope,sha){
 const p=boundary.verifyEnvelope(envelope,'staging','migration');
 return validateBindings(p,sha);
}
function validateBindings(p,sha){
 if(p.build!==sha||p.settings.OPA_NOTIFICATION_MODE!=='disabled'||p.settings.OPA_SSO_ENABLED!=='false')reject();
 const exact={app:SCOPE+'/providers/Microsoft.Web/sites/opa-api-staging',database:SCOPE+'/providers/Microsoft.DBforPostgreSQL/flexibleServers/opa-pg-staging',redis:SCOPE+'/providers/Microsoft.Cache/redisEnterprise/opa-redis-staging',vault:SCOPE+'/providers/Microsoft.KeyVault/vaults/opa-kv-staging',storage:SCOPE+'/providers/Microsoft.Storage/storageAccounts/opastagingevidence'};
 if(Object.keys(p.resources).sort().join()!==Object.keys(exact).sort().join())reject();
 for(const [name,id] of Object.entries(exact))if(p.resources[name].environment!=='staging'||p.resources[name].id!==id)reject();
 if(p.resources.database.host!=='opa-pg-staging.postgres.database.azure.com'||p.resources.database.port!==5432||p.resources.database.database!=='opa_staging'||p.resources.database.role!=='opa_staging_migrations')reject();
 if(p.resources.redis.host!=='opa-redis-staging.southafricanorth.redis.azure.net'||p.resources.redis.port!==10000||p.resources.storage.accountName!=='opastagingevidence'||p.resources.storage.container!=='evidence-staging'||p.resources.vault.secretOrigin!==VAULT)reject();
 if(Object.keys(p.secrets).sort().join()!==Object.keys(SECRET_NAMES).sort().join())reject();
 for(const [name,secretName] of Object.entries(SECRET_NAMES)){
  const b=p.secrets[name];const u=new URL(b.secretId);
  if(u.origin!==VAULT||!new RegExp('^/secrets/'+secretName+'/[a-f0-9]{32}$').test(u.pathname)||u.search||u.hash||u.username||u.password||b.environment!=='staging'||b.vaultId!==exact.vault||!/^[a-f0-9]{64}$/.test(b.sha256))reject();
 }
 return p;
}
function jwtClaims(token){try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url'))}catch{reject()}}
async function jsonRequest(url,options={}){
 const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!response.ok)reject();return response.json();
}
async function oidc(env){
 const endpoint=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL||'');
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.actions.githubusercontent.com'))reject();
 endpoint.searchParams.set('audience','api://AzureADTokenExchange');
 const github=await jsonRequest(endpoint,{headers:{Authorization:'Bearer '+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
 const claims=jwtClaims(github.value);
 if(claims.iss!=='https://token.actions.githubusercontent.com'||claims.sub!==`repo:${REPO}:environment:staging`||claims.aud!=='api://AzureADTokenExchange'||claims.repository!==REPO||claims.ref!==REF||claims.sha!==env.GITHUB_SHA||claims.workflow_ref!==`${REPO}/.github/workflows/opa-staging-migration.yml@${REF}`)reject();
 const response=await jsonRequest(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT,scope:'https://vault.azure.net/.default',grant_type:'client_credentials',client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:github.value})});
 const azure=jwtClaims(response.access_token);
 if(azure.tid!==TENANT||azure.oid!==PRINCIPAL||(azure.appid||azure.azp)!==CLIENT)reject();
 return response.access_token;
}
async function privatePath(){
 for(const host of ['opa-pg-staging.postgres.database.azure.com','opa-redis-staging.southafricanorth.redis.azure.net','opa-kv-staging.vault.azure.net','opastagingevidence.blob.core.windows.net']){
  const addresses=await dns.lookup(host,{all:true,family:4});
  if(!addresses.length||addresses.some(x=>!x.address.startsWith('10.72.')))reject();
 }
}
function runnerLease(env){
 if(process.platform!=='linux'||!fs.existsSync('/.dockerenv')||fs.existsSync('/var/run/docker.sock'))reject();
 const lease=JSON.parse(fs.readFileSync('/runner/opa-staging-lease.json','utf8'));
 if(lease.id!==env.OPA_RUNNER_LEASE||! /^[a-f0-9]{24}$/.test(lease.id)||lease.repository!==REPO||lease.approvedSha!==env.GITHUB_SHA||lease.mode!==env.OPA_STAGING_MODE||!/^172\.27\.240\.\d{1,3}\/32$/.test(lease.source)||!Number.isFinite(Date.parse(lease.expiresAt))||Date.parse(lease.expiresAt)<=Date.now()||Date.parse(lease.expiresAt)>Date.now()+60*60*1000||lease.hostMounts!==0||lease.cleanupOwner!=='operator-host')reject();
 return lease;
}
function prisma(args,env){
 const result=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),...args,'--schema',path.resolve(__dirname,'../prisma/schema.prisma')],{env,stdio:'pipe',timeout:300000,maxBuffer:4*1024*1024});
 if(result.status!==0)reject();
}
async function main(){
 const mode=execution(process.env);const lease=runnerLease(process.env);
 const envelope=JSON.parse(process.env.OPA_STAGING_MIGRATION_POLICY||'null');
 const policy=validatePolicy(envelope,process.env.GITHUB_SHA);
 await privatePath();
 const token=await oidc(process.env);
 delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;delete process.env.GITHUB_TOKEN;
 const runtime={...process.env};
 for(const name of [...boundary.secretNames,...boundary.settingNames])delete runtime[name];
 Object.assign(runtime,{OPA_ENVIRONMENT:'staging',NODE_ENV:'production',OPA_BUILD_SHA:process.env.GITHUB_SHA,OPA_DEPLOYMENT_RESOURCE_ID:policy.resources.app.id});
 for(const [name,value] of Object.entries(policy.settings))if(value!==null)runtime[name]=value;
 const versions=[];
 for(const [name,binding] of Object.entries(policy.secrets)){
  const data=await jsonRequest(binding.secretId+'?api-version=7.4',{headers:{Authorization:'Bearer '+token}});
  if(data.id!==binding.secretId||typeof data.value!=='string'||boundary.hash(data.value)!==binding.sha256)reject();
  runtime[name]=data.value;versions.push({name,secretId:binding.secretId,sha256:binding.sha256});
 }
 const dir=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'opa-staging-policy-'));
 const policyFile=path.join(dir,'migration.json');
 fs.writeFileSync(policyFile,JSON.stringify(envelope),{mode:0o600});
 runtime.OPA_ENVIRONMENT_POLICY_FILE=policyFile;
 try{
  boundary.preflight(runtime,'migration');
  for(const name of [...boundary.secretNames,...boundary.settingNames])delete process.env[name];
  Object.assign(process.env,runtime);
  const environment=require('../dist/shared/config/environment.js');
  await environment.initializeEnvironment(true,'migration');
  // Read-only schema validation; never migrate in auth-only mode.
  prisma(['validate'],runtime);
  const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasources:{db:{url:runtime.DATABASE_URL}}});
  let identity;
  try{identity=await db.$queryRaw`SELECT current_user AS role,current_database() AS database,host(inet_client_addr()) AS client_address FROM opa_deployment.environment_identity WHERE singleton=true`;}finally{await db.$disconnect()}
  if(identity.length!==1||identity[0].role!=='opa_staging_migrations'||identity[0].database!=='opa_staging'||identity[0].client_address!==lease.source.split('/')[0])reject();
  if(mode==='migrate'){
   const result=spawnSync(process.execPath,[path.join(__dirname,'staging-migrate.cjs')],{env:runtime,stdio:'pipe',timeout:1200000,maxBuffer:4*1024*1024});
   if(result.status!==0)reject();
   await environment.initializeEnvironment(false,'migration');
   prisma(['validate'],runtime);
  }
  const audit={status:'Passed',mode,approvedSha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,identity:'id-opa-staging-migrations',principalId:PRINCIPAL,environment:'staging',privateClientAddress:identity[0].client_address,policyExpiresAt:policy.expiresAt,secretVersions:versions,preflight:environment.environmentDiagnostic(),migrationsExecuted:mode==='migrate',cleanupOwner:'operator-host'};
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'opa-staging-audit.json'),JSON.stringify(audit,null,2));
  console.log(JSON.stringify(audit));
 }finally{for(const name of boundary.secretNames){delete runtime[name];delete process.env[name]}fs.rmSync(dir,{recursive:true,force:true})}
}
module.exports={execution,validatePolicy,validateBindings,runnerLease,SECRET_NAMES};
if(require.main===module)main().catch(()=>{console.error('Staging OIDC authentication/preflight failed; secret-bearing diagnostics suppressed');process.exitCode=1});