'use strict';
// One owner approval input; computes artifact hashes, never signs or executes.
const fs=require('node:fs'),path=require('node:path'),C=require('./contract.cjs'),{APP}=require('./cutover.cjs');
function prepare(planFile,output) {
 const p=JSON.parse(fs.readFileSync(planFile)),base=path.dirname(path.resolve(planFile));
 C.requireThat(!fs.existsSync(output)&&/^[a-zA-Z0-9_-]{1,80}$/.test(p.releaseId||''),'NEW_OWNER_RELEASE');
 const hours=p.admissionHours??72,seconds=p.executionTimeoutSeconds??14400;
 C.requireThat(Number.isSafeInteger(hours)&&hours>=1&&hours<=168&&Number.isSafeInteger(seconds)&&seconds>=60&&seconds<=86400,'RELEASE_BOUNDS');
 C.requireThat(p.migration?.resources?.app?.id===APP&&p.migration.resources.database?.role===C.MIGRATOR&&/^[a-f0-9]{64}$/.test(p.migration.sentinelSha256||'')&&/^[a-f0-9]{64}$/.test(p.migration.secrets?.DATABASE_URL?.sha256||'')&&p.migration.runner?.kind==='azure-app-service'&&p.migration.runner.resourceId===APP,'VERIFIED_MIGRATION_BINDINGS_REQUIRED');
 const issued=Date.now(),m={version:1,environment:'production',purpose:'release',releaseId:p.releaseId,approvedByReference:p.approvedByReference,
  executorSHA256:require('./executor.cjs').fingerprint(),appResourceId:APP,scmOrigin:p.scmOrigin,initializeCustody:p.initializeCustody===true,approvedAt:new Date(issued).toISOString(),expiresAt:new Date(issued+hours*3600000).toISOString(),
  executionTimeoutSeconds:seconds,artifacts:{},forward:C.FORWARD,rollbackAcceptedSchemas:[42]};
 for(const name of ['maintenance','executionTools','operatorCredentialBindings','operatorObjectId','executionHostSshKeySHA256']){C.requireThat(p[name]!==undefined,'RELEASE_OPERATIONAL_BINDINGS_REQUIRED');m[name]=p[name]}
 const files={};
 for(const [name,relative] of Object.entries(p.artifacts||{})) {
  const file=path.resolve(base,relative);C.requireThat(fs.lstatSync(file).isFile(),'RELEASE_ARTIFACT_FILE');
  files[name]=file;
  m.artifacts[name]={path:path.relative(path.dirname(path.resolve(output)),file).split(path.sep).join('/'),sha256:C.hash(fs.readFileSync(file))};
 }
 C.requireThat(Object.keys(m.artifacts).length===9,'RELEASE_ARTIFACT_SET');
 const archive=require('./migration-archive.cjs').read(files.migrationArtifact),migration=archive.manifest;
 m.migrationManifestSHA256=archive.manifestSha256;
 m.migration={...p.migration,version:1,environment:'production',purpose:'migration',build:migration.build,
  approvedAt:m.approvedAt,expiresAt:m.expiresAt,executionTimeoutSeconds:seconds,approvalId:p.releaseId,action:'MIGRATE_OPA_PRODUCTION',
  artifactSha256:archive.manifestSha256,backupSha256:m.artifacts.backup.sha256};
 if(m.migration.emergencyWriterException) m.migration.emergencyWriterException={...m.migration.emergencyWriterException,
  approvalId:p.releaseId,build:migration.build,artifactSha256:archive.manifestSha256,
  start:new Date(Math.max(issued,Date.parse(m.migration.emergencyWriterException.start))).toISOString()};
 C.requireThat(JSON.parse(fs.readFileSync(files.backup)).approvalId===p.releaseId,'RECOVERY_RELEASE_BINDING');
 fs.writeFileSync(output,JSON.stringify(m),{flag:'wx',mode:0o600});
 return {status:'UNSIGNED_OWNER_APPROVAL_INPUT',sha256:C.hash(fs.readFileSync(output)),productionModified:false};
}
if(require.main===module){try{console.log(JSON.stringify(prepare(...process.argv.slice(2))))}catch{console.error('RELEASE_PREPARATION_REJECTED');process.exitCode=1}}
module.exports={prepare};
