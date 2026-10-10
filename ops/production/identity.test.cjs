'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});const key={...pair.publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
const identity=require('./app-service-identity.cjs'),run=require('./run.cjs'),C=require('./contract.cjs');
const principalId='ed24b331-4dfe-4e07-8aa9-83f835ce7b6c',tenantId='adb3fb59-1ac3-42c2-b39a-d70c7006ccbc';
function fixture(){
 const policy={runner:{kind:'azure-app-service',resourceId:identity.APP,identity:{principalId,tenantId}}};
 const now=Math.floor(Date.now()/1000);
 const claims={iss:'https://sts.windows.net/'+tenantId+'/',oid:principalId,tid:tenantId,xms_mirid:identity.APP,aud:'https://management.azure.com/',nbf:now-30,exp:now+600};
 const arm={id:identity.APP,type:'Microsoft.Web/sites',identity:{type:'SystemAssigned',principalId,tenantId}};
 const env={IDENTITY_ENDPOINT:'http://169.254.129.1:8081/msi/token',IDENTITY_HEADER:'synthetic-local-header'};
 return {policy,claims,arm,env};
}
function token(claims){const input=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');return input+'.'+crypto.sign('RSA-SHA256',Buffer.from(input),pair.privateKey).toString('base64url');}
async function exercise(f,override){let count=0;const calls=[];const verify=identity.makeVerifier(async(u,h)=>{calls.push({url:u.toString(),headers:h});if(override)return override(++count,u,h);return ++count===1?{token_type:'Bearer',access_token:token(f.claims)}:count===2?{issuer:'https://sts.windows.net/'+tenantId+'/',jwks_uri:'https://login.microsoftonline.com/'+tenantId+'/discovery/keys'}:{keys:[key]};});await verify(f.policy,f.env);return calls;}
test('App Service identity requires verified Entra signature and policy claims',async()=>{
 const f=fixture(),calls=await exercise(f);assert.equal(calls.length,3);
 const local=new URL(calls[0].url);assert.equal(local.searchParams.get('api-version'),'2019-08-01');assert.equal(local.searchParams.get('resource'),'https://management.azure.com/');assert(!local.searchParams.has('client_id'));
 assert.equal(calls[0].headers['X-IDENTITY-HEADER'],f.env.IDENTITY_HEADER);
 assert.equal(calls[1].url,'https://login.microsoftonline.com/'+tenantId+'/.well-known/openid-configuration');assert.equal(calls[2].url,'https://login.microsoftonline.com/'+tenantId+'/discovery/keys');assert.deepEqual(calls[1].headers,{});assert.deepEqual(calls[2].headers,{});
});
for(const [name,mutate,code] of [
 ['wrong policy resource',f=>f.policy.runner.resourceId+='/slots/test','APP_IDENTITY_RESOURCE'],
 ['missing signed identity binding',f=>delete f.policy.runner.identity,'APP_IDENTITY_POLICY'],
 ['unexpected identity policy field',f=>f.policy.runner.identity.fallback=true,'APP_IDENTITY_POLICY'],
 ['token belongs to another caller despite readable target',f=>f.claims.oid='00000000-0000-0000-0000-000000000000','APP_IDENTITY_PRINCIPAL'],
 ['token tenant mismatch',f=>f.claims.tid='00000000-0000-0000-0000-000000000000','APP_IDENTITY_PRINCIPAL'],
 ['token managed resource mismatch',f=>f.claims.xms_mirid+='/slots/test','APP_IDENTITY_RESOURCE'],
 ['token missing managed resource claim',f=>delete f.claims.xms_mirid,'APP_IDENTITY_RESOURCE'],
 ['token wrong audience',f=>f.claims.aud='https://unapproved.invalid/','APP_IDENTITY_AUDIENCE'],
 ['expired token',f=>f.claims.exp=1,'APP_IDENTITY_TOKEN_TIME'],
 ['future token',f=>f.claims.nbf=9999999999,'APP_IDENTITY_TOKEN_TIME'],
 ['missing identity header',f=>delete f.env.IDENTITY_HEADER,'APP_IDENTITY_HEADER'],
 ['remote identity endpoint',f=>f.env.IDENTITY_ENDPOINT='http://unapproved.invalid/msi/token','APP_IDENTITY_ENDPOINT'],
 ['endpoint query can select alternate identity',f=>f.env.IDENTITY_ENDPOINT+='?client_id=unapproved','APP_IDENTITY_ENDPOINT'],
 ['endpoint URL includes credential',f=>f.env.IDENTITY_ENDPOINT='http://user:secret@127.0.0.1/msi/token','APP_IDENTITY_ENDPOINT'],
 ['identity header injection',f=>f.env.IDENTITY_HEADER+='\r\nAuthorization: unapproved','APP_IDENTITY_HEADER']
])test(name,async()=>{const f=fixture();mutate(f);await assert.rejects(exercise(f),{message:code});});
test('Entra key retrieval failure rejects token',async()=>{const f=fixture();await assert.rejects(exercise(f,n=>{if(n===1)return {token_type:'Bearer',access_token:token(f.claims)};throw Error('APP_IDENTITY_HTTP');}),/^Error: APP_IDENTITY_HTTP$/);});
test('untrusted network error body cannot disclose header or token',async()=>{const f=fixture();await assert.rejects(exercise(f,()=>{throw Error('sensitive-diagnostic '+f.env.IDENTITY_HEADER);}),/^Error: APP_IDENTITY_REJECTED$/);});
test('opaque token is rejected, never guessed',async()=>{const f=fixture();await assert.rejects(exercise(f,n=>n===1?{token_type:'Bearer',access_token:'opaque-test-value'}:f.arm),/^Error: APP_IDENTITY_TOKEN_FORMAT$/);});
function responses(f,t=token(f.claims),d={issuer:'https://sts.windows.net/'+tenantId+'/',jwks_uri:'https://login.microsoftonline.com/'+tenantId+'/discovery/keys'},keys=[key]){return n=>n===1?{token_type:'Bearer',access_token:t}:n===2?d:{keys};}
test('forged signature cannot authenticate expected identity claims',async()=>{const f=fixture(),parts=token(f.claims).split('.');parts[2]=Buffer.alloc(256).toString('base64url');await assert.rejects(exercise(f,responses(f,parts.join('.'))),/APP_IDENTITY_TOKEN_SIGNATURE/);});
test('modified payload invalidates an otherwise valid signature',async()=>{const f=fixture(),parts=token(f.claims).split('.');parts[1]=Buffer.from(JSON.stringify({...f.claims,exp:f.claims.exp+1})).toString('base64url');await assert.rejects(exercise(f,responses(f,parts.join('.'))),/APP_IDENTITY_TOKEN_SIGNATURE/);});
test('algorithm none and token-supplied key URLs rejected',async()=>{const f=fixture();for(const header of [{alg:'none',kid:key.kid},{alg:'RS256',kid:key.kid,jku:'https://unapproved.invalid/keys'}]){const parts=token(f.claims).split('.');parts[0]=Buffer.from(JSON.stringify(header)).toString('base64url');await assert.rejects(exercise(f,responses(f,parts.join('.'))),/APP_IDENTITY_TOKEN_SIGNATURE/);}});
test('issuer is pinned to reviewed tenant',async()=>{const f=fixture();await assert.rejects(exercise(f,responses(f,token(f.claims),{issuer:'https://unapproved.invalid/',jwks_uri:'https://login.microsoftonline.com/'+tenantId+'/discovery/keys'})),/APP_IDENTITY_ISSUER/);});
test('discovery cannot redirect key lookup to another authority',async()=>{const f=fixture();await assert.rejects(exercise(f,responses(f,token(f.claims),{issuer:f.claims.iss,jwks_uri:'https://unapproved.invalid/keys'})),/APP_IDENTITY_AUTHORITY/);});
test('unknown and ambiguous signing keys rejected',async()=>{const f=fixture();for(const keys of [[],[key,key]])await assert.rejects(exercise(f,responses(f,token(f.claims),undefined,keys)),/APP_IDENTITY_TOKEN_SIGNATURE/);});
test('key issuer mismatch rejected',async()=>{const f=fixture();await assert.rejects(exercise(f,responses(f,token(f.claims),undefined,[{...key,issuer:'https://sts.windows.net/00000000-0000-0000-0000-000000000000/'}])),/APP_IDENTITY_ISSUER/);});
test('candidate preserves VM IMDS and private NIC/DNS checks',()=>{const s=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8');assert(s.includes("if(p.runner?.kind==='azure-app-service') return require('./app-service-network.cjs').verifyAppNetwork(p);"));assert(s.includes("else { R(p.runner?.kind==='azure-vm','RUNNER_BINDING');const metadata=await imds();"));assert(s.includes("'RUNNER_PRIVATE_NIC'"));assert(s.includes("'DATABASE_PRIVATE_DNS'"));assert(s.includes("http://169.254.169.254/metadata/instance/compute?api-version=2021-02-01"));});
function policyFixture(){
 const f=fixture(),base=identity.APP.slice(0,identity.APP.indexOf('Microsoft.Web/sites/'));
 const dbURL='postgresql://opa_production_migrations:synthetic-only@'+C.HOST+':5432/'+C.DB+'?sslmode=require&sslaccept=strict';
 const artifact={manifest:{build:'a'.repeat(40)},manifestSha256:'b'.repeat(64)};
 const backup={version:1,server:'opa-api-production-server',database:C.DB,publicAccess:'Disabled',retentionDays:7,observedAt:new Date().toISOString(),earliestRestoreDate:new Date(Date.now()-86400000).toISOString(),restorePoint:new Date(Date.now()-60000).toISOString(),evidenceSha256:'a'.repeat(64),approvalId:'test-identity'};
 const bytes=Buffer.from(JSON.stringify(backup)),vault=base+'Microsoft.KeyVault/vaults/opa-kv-production';
 const p={version:1,environment:'production',purpose:'migration',build:artifact.manifest.build,approvedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),approvalId:'test-identity',action:'MIGRATE_OPA_PRODUCTION',writersQuiesced:true,artifactSha256:artifact.manifestSha256,backupSha256:C.hash(bytes),sentinelSha256:'c'.repeat(64),resources:{app:{environment:'production',id:identity.APP},database:{environment:'production',id:base+'Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server',host:C.HOST,port:5432,database:C.DB,role:C.MIGRATOR},vault:{environment:'production',id:vault,secretOrigin:'https://opa-kv-production.vault.azure.net'}},secrets:{DATABASE_URL:{environment:'production',vaultId:vault,secretId:'https://opa-kv-production.vault.azure.net/secrets/test-identity/'+'d'.repeat(32),sha256:C.hash(dbURL)}},runner:{...f.policy.runner,privateAddresses:['10.0.0.4'],databaseAddresses:['10.0.1.4']}};
 const env={OPA_ENVIRONMENT:'production',NODE_ENV:'production',OPA_BUILD_SHA:artifact.manifest.build,OPA_DEPLOYMENT_RESOURCE_ID:identity.APP,DATABASE_URL:dbURL};
 return {p,env,artifact,bytes};
}
function inputs(f){return run.policyInputs(path.resolve(__dirname,'../..'),f.artifact,f.env,f.bytes,'preflight',()=>f.p);}
test('new App Service policy requires signed identity fields',()=>{const f=policyFixture();assert.equal(inputs(f),f.p);delete f.p.runner.identity;assert.throws(()=>inputs(f),/APP_IDENTITY_POLICY/);});
test('VM policy remains unchanged and rejects extra identity fields',()=>{const f=policyFixture();f.p.runner={kind:'azure-vm',resourceId:identity.APP.slice(0,identity.APP.indexOf('Microsoft.Web/sites/'))+'Microsoft.Compute/virtualMachines/test-only',privateAddresses:['10.0.0.4'],databaseAddresses:['10.0.1.4']};assert.equal(inputs(f),f.p);f.p.runner.identity={principalId,tenantId};assert.throws(()=>inputs(f),/POLICY_FIELDS/);});
test('policy retains backup, artifact, window and private-address gates',()=>{for(const change of [f=>f.p.runner.privateAddresses=['8.8.8.8'],f=>f.p.backupSha256='d'.repeat(64),f=>f.p.artifactSha256='e'.repeat(64),f=>f.p.expiresAt='2000-01-01T00:00:00Z']){const f=policyFixture();change(f);assert.throws(()=>inputs(f));}});
