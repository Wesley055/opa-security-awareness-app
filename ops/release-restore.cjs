'use strict';
// Cleanup-only entry point. It cannot deploy, sign, migrate or publish custody.
const fs=require('node:fs'),path=require('node:path'),C=require('./production/contract.cjs'),R=C.requireThat;
async function main(){
 const [file,approved,deploymentFile]=process.argv.slice(2);
 R(process.env.OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256===approved&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'EXACT_CUTOVER_APPROVAL_REQUIRED');
 const unsigned=JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(file)).payload,'base64'));
 // Approval expiry blocks new privileged work, never the narrowly scoped
 // restoration of previously captured privileges after verified recovery.
 const release=require('./production/cutover.cjs').verify(file,{now:Date.parse(unsigned.approvedAt)});R(release.sha256===approved,'EXACT_CUTOVER_APPROVAL_REQUIRED');
 const deployment=JSON.parse(fs.readFileSync(deploymentFile)),database=JSON.parse(fs.readFileSync(path.join(release.directory,release.manifest.releaseId+'.database-phase-receipt.json')));
 R(deployment.manifestSHA256===approved&&['deployment-phase-complete','rolled-back'].includes(deployment.status)&&database.manifestSHA256===approved&&database.activeMigrations===42&&database.cleanupRequired===false,'VERIFIED_DEPLOYMENT_AND_DATABASE_REQUIRED');
 const rollback=deployment.status==='rolled-back',health=deployment.steps.find(s=>s.name===(rollback?'verify-rollback':'verify-api-health'));
 R(health?.status==='passed'&&health.result?.health===200&&health.result.readiness===200,'VERIFIED_DEPLOYMENT_HEALTH_REQUIRED');
 const snapshotFile=path.join(release.directory,release.manifest.releaseId+'.maintenance.json'),snapshotBytes=fs.readFileSync(snapshotFile),snapshot=JSON.parse(snapshotBytes);
 const proof=database.steps.find(s=>s.name==='allow-fenced-api-startup');
 R(proof?.result?.snapshotSHA256===C.hash(snapshotBytes)&&snapshot.releaseId===release.manifest.releaseId&&snapshot.phase==='read-only-startup','MAINTENANCE_SNAPSHOT_BINDING');
 const markerFile=path.resolve(release.directory,'..','maintenance.lock'),marker=JSON.parse(fs.readFileSync(markerFile));R(marker.manifestSHA256===approved&&marker.releaseId===snapshot.releaseId,'MAINTENANCE_LOCK_BINDING');
 const bytes=fs.readFileSync(0);R(bytes.length<=65536,'RELEASE_INPUT_SIZE');let input;try{input=JSON.parse(bytes)}finally{bytes.fill(0)}
 require('./release-session.cjs').privilegedInputs(input,60);
 const adapter=require('./production/cutover-host.cjs').create(input),policies=adapter.prepareDeployment(release),deadline=Date.now()+180000;
 const live=await adapter.health(release,rollback,deadline);R(live.build===health.result.build,'RECOVERY_BUILD_CHANGED');
 const root=require('./production/migration-archive.cjs').extract(release.files.migrationArtifact,require('node:os').tmpdir()).root,{Client}=require(path.join(root,'node_modules/pg'));
 const db=new Client(require('./production/run.cjs').connectOptions(input.OPA_RELEASE_ADMIN_DATABASE_URL));
 try{
  await db.connect();
  const identity=(await db.query('SELECT current_user AS role,host(inet_server_addr()) AS address,to_jsonb(i) AS sentinel FROM opa_deployment.environment_identity i')).rows;
  R(identity.length===1&&identity[0].role===release.manifest.operatorCredentialBindings.adminRole&&release.manifest.migration.runner.databaseAddresses.includes(identity[0].address)&&C.hash(JSON.stringify(identity[0].sentinel))===release.manifest.migration.sentinelSha256,'RESTORATION_DATABASE_IDENTITY');
  const ledger=(await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations')).rows;
  const artifact=require('./production/run.cjs').verifyArtifact(root);C.ledger(ledger,artifact.manifest.candidate);
  R((await db.query('SELECT NOT pg_has_role($1,$2,\'MEMBER\') AND NOT has_schema_privilege($1,\'public\',\'CREATE\') AND NOT has_table_privilege($1,\'public._prisma_migrations\',\'INSERT,UPDATE\') AS clean',[C.MIGRATOR,C.OWNER])).rows[0]?.clean===true,'MIGRATION_PRIVILEGE_CLEANUP_REQUIRED');
  const save=async value=>{const history=snapshotFile+'.'+value.phase+'.json',fd=fs.openSync(history,'wx',0o600);try{fs.writeSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}const next=history+'.next';fs.copyFileSync(history,next,fs.constants.COPYFILE_EXCL);fs.renameSync(next,snapshotFile)};
  await require('./production/maintenance.cjs').restore(db,snapshot,{validatedSchema:42,validatedBuild:live.build,allowedBuilds:[policies.approved.build,policies.rollback.build]},save);
  fs.unlinkSync(markerFile);
  const result={status:'writers-restored',manifestSHA256:approved,activeMigrations:42,build:live.build,privilegesClean:true,restoredAt:new Date().toISOString()};
  fs.writeFileSync(path.join(release.directory,release.manifest.releaseId+'.writer-restoration-receipt.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
 }finally{await db.end();for(const k of Object.keys(input))delete input[k];fs.rmSync(root,{recursive:true,force:true})}
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'MAINTENANCE_RESTORATION_REJECTED');process.exitCode=1});
