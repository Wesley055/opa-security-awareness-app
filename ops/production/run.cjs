"use strict";
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),http=require('node:http'),dns=require('node:dns').promises,os=require('node:os');
const C=require('./contract.cjs'), I=require('./inspect.cjs'), {walk}=require('./build-artifact.cjs');
const {requireThat:R,hash}=C;
function verifyArtifact(root) {
  const bytes=fs.readFileSync(path.join(root,'migration-artifact.json')), m=JSON.parse(bytes);
  R(m.version===1 && /^[a-f0-9]{40}$/.test(m.build || '') && m.baselineBuild===C.BASE && m.prisma==='6.19.3' && m.nodeMajor===22 && m.executionReady===true,'ARTIFACT_CONTRACT');
  R(process.versions.node.split('.')[0]==='22' && m.platform===process.platform && m.arch===process.arch,'ARTIFACT_PLATFORM');
  R(Object.keys(m.baseline).length===35 && Object.keys(m.candidate).length===42 && JSON.stringify(m.forward)===JSON.stringify(C.FORWARD),'ARTIFACT_MIGRATIONS');
  R(Object.entries({...m.baseline,...C.FORWARD}).every(([n,h])=>m.candidate[n]===h),'ARTIFACT_DELTA');
  const actual=walk(root); delete actual['migration-artifact.json'];
  R(Object.keys(actual).length===Object.keys(m.files).length && Object.entries(m.files).every(([n,h])=>actual[n]===h),'ARTIFACT_TAMPERED');
  for (const [name,h] of Object.entries(m.candidate)) R(m.files[`apps/api/prisma/migrations/${name}/migration.sql`]===h,'ARTIFACT_SQL_HASH');
  R(JSON.parse(fs.readFileSync(path.join(root,'node_modules/prisma/package.json'))).version==='6.19.3','ARTIFACT_CLI_VERSION');
  return {manifest:m,manifestSha256:hash(bytes)};
}
function policyInputs(root, artifact, env, backupBytes, mode, readPolicy) {
  R(env.OPA_ENVIRONMENT==='production' && env.NODE_ENV==='production' && env.OPA_BUILD_SHA===artifact.manifest.build,'ENVIRONMENT');
  const boundary=require(path.join(root,'packages/environment-policy/index.cjs'));
  const p=(readPolicy || boundary.readPolicy)(env.OPA_ENVIRONMENT_POLICY_FILE,'production','migration');
  R(p.purpose==='migration' && p.environment==='production' && p.version===1 && p.build===artifact.manifest.build,'POLICY_SCOPE');
  C.onlyKeys(p,['version','environment','purpose','build','approvedAt','expiresAt','approvalId','action','writersQuiesced','artifactSha256','backupSha256','sentinelSha256','resources','secrets','runner'],'POLICY_FIELDS');
  const now=Date.now();
  R(Number.isFinite(Date.parse(p.approvedAt)) && Date.parse(p.approvedAt)<=now && Date.parse(p.expiresAt)>now && Date.parse(p.expiresAt)-Date.parse(p.approvedAt)<=3600000,'POLICY_WINDOW');
  R(p.artifactSha256===artifact.manifestSha256 && p.backupSha256===hash(backupBytes),'POLICY_ARTIFACT_BACKUP');
  R(/^[a-f0-9]{64}$/.test(p.sentinelSha256 || ''),'POLICY_SENTINEL');
  const b=JSON.parse(backupBytes); C.backupEvidence(b);
  R(/^[a-zA-Z0-9_-]{1,80}$/.test(p.approvalId || '') && p.approvalId===b.approvalId && p.action==='MIGRATE_OPA_PRODUCTION' && p.writersQuiesced===true,'OPERATOR_APPROVAL');
  const db=p.resources?.database, app=p.resources?.app, vault=p.resources?.vault;
  R(db?.environment==='production' && db.host===C.HOST && db.port===5432 && db.database===C.DB && db.role===C.MIGRATOR,'DATABASE_BINDING');
  const id=/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/opa-production\/providers\//i;
  R(id.test(db.id || '') && db.id.endsWith('/Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server') && id.test(app?.id || '') && app.id.endsWith('/Microsoft.Web/sites/opa-api-production') && env.OPA_DEPLOYMENT_RESOURCE_ID===app.id,'AZURE_RESOURCE');
  R(app.environment==='production' && app.id.split('/')[2].toLowerCase()===db.id.split('/')[2].toLowerCase(),'APP_ENVIRONMENT');
  R(vault?.environment==='production' && /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[a-zA-Z0-9_.()-]+\/providers\/Microsoft.KeyVault\/vaults\/[a-zA-Z0-9-]+$/i.test(vault.id || '') && vault.id.split('/')[2].toLowerCase()===db.id.split('/')[2].toLowerCase() && vault.secretOrigin===`https://${vault.id.split('/').at(-1)}.vault.azure.net`,'VAULT_BINDING');
  R(p.secrets?.DATABASE_URL?.environment==='production' && p.secrets.DATABASE_URL.sha256===hash(env.DATABASE_URL || '') && /^https:\/\/[a-z0-9-]+\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]+\/[a-f0-9]{32}$/.test(p.secrets.DATABASE_URL.secretId || ''),'DATABASE_SECRET_BINDING');
  R(p.secrets.DATABASE_URL.vaultId===vault.id && p.secrets.DATABASE_URL.secretId.startsWith(vault.secretOrigin+'/secrets/') && Object.keys(p.secrets).length===1 && boundary.secretNames.filter(n=>n!=='DATABASE_URL').every(n=>!env[n]),'MIGRATION_SECRET_SCOPE');
  for(const [object,keys] of [[p.resources,['app','database','vault']],[app,['environment','id']],[db,['environment','id','host','port','database','role']],[vault,['environment','id','secretOrigin']],[p.secrets.DATABASE_URL,['environment','vaultId','secretId','sha256']],[p.runner,['kind','resourceId','privateAddresses','databaseAddresses']]])C.onlyKeys(object,keys,'POLICY_FIELDS');
  boundary.databaseBinding(env.DATABASE_URL,db);
  R(env.DATABASE_URL && new URL(env.DATABASE_URL).password,'DATABASE_CREDENTIAL');
  const productionAppRunner='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/Microsoft.Web/sites/opa-api-production';
  const vmRunner=p.runner?.kind==='azure-vm' && id.test(p.runner.resourceId || '') && /\/Microsoft.Compute\/virtualMachines\/[a-zA-Z0-9_-]+$/.test(p.runner.resourceId);
  const appRunner=p.runner?.kind==='azure-app-service' && p.runner.resourceId===productionAppRunner && p.runner.resourceId===app.id;
  R(vmRunner || appRunner,'RUNNER_BINDING');
  for (const addresses of [p.runner.privateAddresses,p.runner.databaseAddresses]) R(Array.isArray(addresses) && addresses.length>0 && addresses.length<=8 && addresses.every(privateIPv4) && new Set(addresses).size===addresses.length,'PRIVATE_ADDRESSES');
  R(p.runner.resourceId.split('/')[2].toLowerCase()===db.id.split('/')[2].toLowerCase(),'RUNNER_SUBSCRIPTION');
  if (mode==='execute') R(env.OPA_MIGRATION_CONFIRMATION===`MIGRATE_OPA_PRODUCTION:${p.build}:${p.artifactSha256}:${p.approvalId}`,'EXPLICIT_AUTHORIZATION');
  return p;
}
function privateIPv4(value) {
  if (typeof value!=='string' || !/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false;
  const a=value.split('.').map(Number);
  return a.every((n,i)=>n>=0 && n<=255 && String(n)===value.split('.')[i]) && (a[0]===10 || a[0]===172 && a[1]>=16 && a[1]<=31 || a[0]===192 && a[1]===168);
}
function imds() {
  return new Promise((resolve,reject)=>{
    const req=http.get('http://169.254.169.254/metadata/instance/compute?api-version=2021-02-01',{headers:{Metadata:'true'},timeout:3000},res=>{
      let body=''; if(res.statusCode!==200){res.resume();reject(Error('RUNNER_METADATA'));return;}
      res.on('data',d=>{body+=d; if(body.length>65536)req.destroy(Error('RUNNER_METADATA'));});
      res.on('end',()=>{try{resolve(JSON.parse(body));}catch{reject(Error('RUNNER_METADATA'));}});
    }); req.on('timeout',()=>req.destroy(Error('RUNNER_METADATA')));req.on('error',()=>reject(Error('RUNNER_METADATA')));
  });
}
async function runner(p) {
  const metadata=await imds(); R(metadata.resourceId===p.runner.resourceId,'RUNNER_IDENTITY');
  const addresses=Object.values(os.networkInterfaces()).flat().filter(Boolean).filter(a=>!a.internal && a.family==='IPv4').map(a=>a.address);
  R(p.runner.privateAddresses.some(a=>addresses.includes(a)),'RUNNER_PRIVATE_NIC');
  const db=await dns.lookup(C.HOST,{all:true});
  R(db.length>0 && db.every(a=>a.family===4 && p.runner.databaseAddresses.includes(a.address)),'DATABASE_PRIVATE_DNS');
}
function connectOptions(url) {
  const u=new URL(url);
  // Do not pass Prisma-specific SSL query parameters to pg, which may replace
  // an explicit SSL object. Both clients independently validate certificates.
  return {host:u.hostname,port:Number(u.port || 5432),database:decodeURIComponent(u.pathname.slice(1)),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,query_timeout:30000,application_name:'opa-production-migration'};
}
async function cli(root, args, env, expiresAt) {
  const remaining=expiresAt ? Date.parse(expiresAt)-Date.now() : 600000;
  R(Number.isFinite(remaining) && remaining>0,'PRISMA_POLICY_EXPIRED');
  const safe={PATH:env.PATH,SystemRoot:env.SystemRoot,TEMP:env.TEMP,TMP:env.TMP,HOME:env.HOME,USERPROFILE:env.USERPROFILE,DATABASE_URL:env.DATABASE_URL,CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'};
  return new Promise((resolve,reject)=>{
    const child=cp.spawn(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),...args],{cwd:root,env:safe,stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
    // Discard both streams, including database error details and SQL data. Do
    // not buffer, print or write diagnostics that could contain credentials.
    child.stdout.resume(); child.stderr.resume();
    let hardTimer,timedOut=false;
    const stop=force=>{
      try {
        if(process.platform==='win32' && child.pid) cp.spawnSync(path.join(env.SystemRoot || 'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:10000,env:{SystemRoot:env.SystemRoot}});
        else if(process.platform!=='win32' && child.pid)process.kill(-child.pid,force?'SIGKILL':'SIGTERM');
        else child.kill(force?'SIGKILL':'SIGTERM');
      }catch{try{child.kill('SIGKILL');}catch{/* independent administrator cleanup is still required */}}
    };
    const timer=setTimeout(()=>{timedOut=true;stop(false);hardTimer=setTimeout(()=>{stop(true);reject(Error('PRISMA_TIMEOUT'));},3000);},Math.max(1,Math.min(600000,remaining)));
    const clear=()=>{clearTimeout(timer);clearTimeout(hardTimer);};
    child.on('error',()=>{clear();reject(Error('PRISMA_PROCESS'));});
    child.on('exit',(code,signal)=>{clear(); if(timedOut || code!==0 || signal)reject(Error('PRISMA_REJECTED'));else resolve();});
  });
}
async function executeLifecycle({client,artifact,policy,mode,invoke,receipt,save}) {
  let before;
  try {
    await client.connect();
    before=await I.identity(client,policy); receipt.sentinelSha256=before;
    if(mode==='verify-cleanup') {
      receipt.posture=await I.posture(client,false);receipt.status='cleanup-verified';receipt.cleanupRequired=false;
    } else if(mode==='verify-post') {
      await I.posture(client,false); await I.history(client,artifact.manifest.candidate); receipt.activeMigrations=42; await I.structure(client);
      await invoke(['migrate','diff','--from-schema-datasource','apps/api/prisma/schema.prisma','--to-schema-datamodel','apps/api/prisma/schema.prisma','--exit-code']);
      receipt.status='verified'; receipt.activeMigrations=42; receipt.cleanupRequired=false;
    } else {
      await I.posture(client,true); await I.history(client,artifact.manifest.baseline);await I.preStructure(client);
      receipt.compatibility=await I.compatibility(client);receipt.activeMigrations=35;
      receipt.status='preflight-passed';receipt.cleanupRequired=true;save();
      if(mode==='execute') {
        // Persist intent before spawning. An absent final receipt after crash
        // must be treated as an uncertain mutation requiring admin cleanup.
        receipt.status='execution-started';save();
        R(Date.parse(policy.expiresAt)>Date.now(),'EXECUTION_POLICY_EXPIRED');
        await invoke(['migrate','deploy','--schema','apps/api/prisma/schema.prisma']);
        await I.history(client,artifact.manifest.candidate); receipt.activeMigrations=42; await I.structure(client); await I.posture(client,true);
        await invoke(['migrate','diff','--from-schema-datasource','apps/api/prisma/schema.prisma','--to-schema-datamodel','apps/api/prisma/schema.prisma','--exit-code']);
        receipt.activeMigrations=42;receipt.status='migrated-awaiting-admin-cleanup';
      }
    }
    R(await I.identity(client,policy)===before,'SENTINEL_CHANGED');
    R(Date.parse(policy.expiresAt)>Date.now(),'VERIFICATION_POLICY_EXPIRED');
  } catch {
    receipt.status='failed'; receipt.cleanupRequired=true;
    throw Error('PRODUCTION_MIGRATION_STOPPED');
  } finally {
    try { await client.end();receipt.connectionClosed=true; }
    catch { receipt.connectionClosed=false;receipt.cleanupRequired=true;receipt.status='failed'; }
    save();
  }
  R(receipt.status!=='failed','CONNECTION_CLEANUP_FAILED');
}
async function main() {
  const [mode,backupFile,receiptFile]=process.argv.slice(2);
  R(process.argv.length===5 && ['preflight','execute','verify-post','verify-cleanup'].includes(mode),'RUN_ARGUMENTS');
  const root=path.resolve(__dirname,'../..');
  R(!process.env.NODE_OPTIONS && !process.env.NODE_PATH && process.execArgv.length===0,'NODE_INJECTION');
  R(!path.resolve(receiptFile).startsWith(root+path.sep) && !fs.existsSync(receiptFile),'EXTERNAL_NEW_RECEIPT_REQUIRED');
  const receipt={version:1,environment:'production',mode,startedAt:new Date().toISOString(),status:'rejected',cleanupRequired:true};
  // Reserve the receipt before introducing DB access. Explicit fields only.
  const fd=fs.openSync(receiptFile,'wx',0o600);
  const save=()=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(receipt,null,2)+'\n',0,'utf8');fs.fsyncSync(fd);};
  try {
    save(); const artifact=verifyArtifact(root);
    const p=policyInputs(root,artifact,process.env,fs.readFileSync(backupFile),mode);
    receipt.build=p.build;receipt.artifactSha256=p.artifactSha256;receipt.approvalId=p.approvalId;receipt.policySha256=hash(fs.readFileSync(process.env.OPA_ENVIRONMENT_POLICY_FILE));
    await runner(p); save();
    const {Client}=require(path.join(root,'node_modules/pg'));
    const client=new Client(connectOptions(process.env.DATABASE_URL));
    await executeLifecycle({client,artifact,policy:p,mode,receipt,save,invoke:args=>cli(root,args,process.env,p.expiresAt)});
  } finally { save();fs.closeSync(fd); }
  console.log(JSON.stringify({status:receipt.status,cleanupRequired:receipt.cleanupRequired}));
}
if(require.main===module) main().catch(()=>{console.error('PRODUCTION_MIGRATION_STOPPED; ADMIN CLEANUP AND INDEPENDENT VERIFICATION REQUIRED');process.exitCode=1;});
module.exports={verifyArtifact,policyInputs,privateIPv4,connectOptions,executeLifecycle,cli,runner};
