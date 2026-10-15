'use strict';
const fs=require('node:fs'),path=require('node:path');
const C=require('./contract.cjs'),boundary=require('../../packages/environment-policy/index.cjs');
const {requireThat:R}=C;
const APP='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/Microsoft.Web/sites/opa-api-production';
function verify(file,{keys,now=Date.now()}={}) {
  const raw=fs.readFileSync(file),envelope=JSON.parse(raw);
  const m=boundary.verifyEnvelope(envelope,'production','release',keys);
  R(m.version===1&&m.appResourceId===APP&&/^[a-zA-Z0-9_-]{1,80}$/.test(m.releaseId||'')&&
    typeof m.approvedByReference==='string'&&m.approvedByReference.length>0,'RELEASE_OWNER_SCOPE');
  R(Date.parse(m.approvedAt)<=now&&Date.parse(m.expiresAt)>now&&Date.parse(m.expiresAt)-Date.parse(m.approvedAt)<=7*86400000,'RELEASE_WINDOW');
  R(Number.isSafeInteger(m.executionTimeoutSeconds)&&m.executionTimeoutSeconds>=60&&m.executionTimeoutSeconds<=86400,'RELEASE_EXECUTION_BOUND');
  R(m.executorSHA256===require('./executor.cjs').fingerprint(),'RELEASE_EXECUTOR_DRIFT');
  const names=['api','apiManifest','runtimeAuthorization','custody','migrationArtifact','backup','rollbackApi','rollbackManifest','rollbackAuthorization'];
  R(m.artifacts&&Object.keys(m.artifacts).length===names.length,'RELEASE_ARTIFACTS');
  const files={};
  for(const name of names) {
    const a=m.artifacts[name];C.onlyKeys(a,['path','sha256'],'RELEASE_ARTIFACT_FIELDS');
    R(typeof a.path==='string'&&/^[a-f0-9]{64}$/.test(a.sha256||''),'RELEASE_ARTIFACT_BINDING');
    const target=path.resolve(path.dirname(file),a.path);R(fs.lstatSync(target).isFile(),'RELEASE_REGULAR_FILE');
    R(C.hash(fs.readFileSync(target))===a.sha256,'RELEASE_ARTIFACT_TAMPERED');files[name]=target;
  }
  R(m.migration?.purpose==='migration'&&m.migration.approvalId===m.releaseId&&
    m.migration.approvedAt===m.approvedAt&&m.migration.expiresAt===m.expiresAt&&
    m.migration.executionTimeoutSeconds===m.executionTimeoutSeconds&&m.migration.resources?.app?.id===APP&&
    m.migration.artifactSha256===m.migrationManifestSHA256&&m.migration.backupSha256===m.artifacts.backup.sha256,'RELEASE_MIGRATION_BINDING');
  R(JSON.stringify(m.forward)===JSON.stringify(C.FORWARD)&&m.rollbackAcceptedSchemas?.includes(42),'RELEASE_ROLLBACK_SCHEMA');
  const archive=require('./migration-archive.cjs').read(files.migrationArtifact);
  R(archive.manifestSha256===m.migrationManifestSHA256&&archive.manifest.build===m.migration.build,'RELEASE_MIGRATION_MANIFEST');
  return {manifest:m,files,directory:path.dirname(path.resolve(file)),sha256:C.hash(raw)};
}
async function execute(release,{adapters,now=Date.now,save=()=>{},migrationOnly=false,databaseReceipt}={}) {
  const m=release.manifest,receipt={version:1,releaseId:m.releaseId,manifestSHA256:release.sha256,status:'started',steps:[],cleanupRequired:false};
  const check=()=>R(now()<Date.parse(m.expiresAt),'RELEASE_ADMISSION_EXPIRED');
  const step=async(name,fn)=>{receipt.steps.push({name,status:'started'});save(receipt);const result=await fn();if(result!==undefined)receipt.steps.at(-1).result=result;receipt.steps.at(-1).status='passed';save(receipt)};
  let migrationAdmitted=false,deployAdmitted=false,deployDeadline;
  try {
    if(databaseReceipt) {
      R(!migrationOnly&&databaseReceipt.manifestSHA256===release.sha256&&databaseReceipt.status==='migration-phase-complete'&&databaseReceipt.cleanupRequired===false&&databaseReceipt.activeMigrations===42&&databaseReceipt.maintenanceRequired===true&&databaseReceipt.steps?.some(s=>s.name==='allow-fenced-api-startup'&&s.status==='passed'),'VERIFIED_DATABASE_PHASE_REQUIRED');
      receipt.databasePhaseReceiptSHA256=C.hash(JSON.stringify(databaseReceipt));receipt.activeMigrations=42;migrationAdmitted=true;
      check();await step('verify-deployment-artifacts',()=>adapters.prepareDeployment(release));
    } else {
    check();await step('verify-host-and-artifacts',()=>adapters.verify(release));
    check();await step('verify-recovery-readiness',()=>adapters.recovery(release));
    check();await step('enter-controlled-maintenance',()=>adapters.enterMaintenance(release));
    receipt.maintenanceRequired=true;save(receipt);
    check();receipt.cleanupRequired=true;save(receipt);
    try {
      await step('activate-dedicated-migration-identity',()=>adapters.activate(release));
      check();migrationAdmitted=true;
      await step('migrate-and-validate',()=>adapters.migrate(release,checkpoint=>{receipt.steps.at(-1).result=checkpoint;save(receipt)}));
    } finally {
      // Revocation of temporary authority is never blocked by approval expiry.
      try {await step('cleanup-privileges',()=>adapters.cleanup(release))}
      finally {await step('verify-privilege-cleanup',()=>adapters.verifyCleanup(release))}
      receipt.cleanupRequired=false;save(receipt);
    }
    receipt.activeMigrations=receipt.steps.find(s=>s.name==='migrate-and-validate')?.result?.activeMigrations;
    await step('allow-fenced-api-startup',()=>adapters.allowReadOnlyStartup(release));
    if(migrationOnly){R(receipt.activeMigrations===42,'MIGRATION_PHASE_SCHEMA42_REQUIRED');receipt.status='migration-phase-complete';save(receipt);return receipt}
    }
    check();deployAdmitted=true;deployDeadline=now()+m.executionTimeoutSeconds*1000;
    await step('publish-runtime-custody',()=>adapters.publishRuntime(release,false,deployDeadline));
    R(now()<deployDeadline,'DEPLOYMENT_DEADLINE');
    await step('deploy-api',()=>adapters.deploy(release,false,deployDeadline));
    await step('verify-api-health',()=>adapters.health(release,false,deployDeadline));
    R(now()<deployDeadline,'DEPLOYMENT_DEADLINE');receipt.status='deployment-phase-complete';
  } catch(e) {
    receipt.status='failed';
    if(deployAdmitted&&now()<deployDeadline) {
      try {
        await step('restore-approved-durable-runtime',()=>adapters.publishRuntime(release,true,deployDeadline));
        await step('rollback-api',()=>adapters.deploy(release,true,deployDeadline));
        await step('verify-rollback',()=>adapters.health(release,true,deployDeadline));
        receipt.status='rolled-back';
      } catch {receipt.status='rollback-failed';}
    }
    receipt.errorCode=/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'CUTOVER_FAILED';
    save(receipt);throw Object.assign(Error(receipt.errorCode),{receipt});
  } finally {receipt.migrationAdmitted=migrationAdmitted;save(receipt)}
  save(receipt);return receipt;
}
async function main() {
  const [file,mode,approvedHash]=process.argv.slice(2),release=verify(file);
  if(mode==='--verify'){console.log(JSON.stringify({status:'verified',manifestSHA256:release.sha256}));return}
  R(mode==='--execute-migrations','PHASE_SAFE_EXECUTION_REQUIRED');
  R(approvedHash===release.sha256,'EXACT_CUTOVER_APPROVAL_REQUIRED');
  R(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'NODE_INJECTION');
  const receiptFile=path.resolve(path.dirname(file),release.manifest.releaseId+'.database-phase-receipt.json');
  const fd=fs.openSync(receiptFile,'wx',0o600);
  const save=r=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(r,null,2));fs.fsyncSync(fd)};
  try {const result=await execute(release,{adapters:require('./cutover-host.cjs').create(process.env),save,migrationOnly:true});console.log(JSON.stringify({status:result.status,manifestSHA256:release.sha256,receipt:receiptFile}))}
  finally{fs.closeSync(fd)}
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'CUTOVER_REJECTED');process.exitCode=1});
module.exports={verify,execute,APP};
