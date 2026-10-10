'use strict';
const C=require('./contract.cjs');
const {requireThat:R}=C;
const APP='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/Microsoft.Web/sites/opa-api-production';
const SERVER='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server';
const EVIDENCE='545ae0dc1a37aa321d315faf0c65a5beff177c922fd29c7fecec237ac8376702';
const ORIGINAL='1805464b09906c4ae80950bfc56f8e6c54403cd955ef49841f1fecbbf195eb2f';
const APPLY='3a07f1918c0876ea8df00bc0dfc22f73633370426508ba0423b636ee79785fd4';
const RESTORE='d3e07c73371fcc039bf4409599b5b0efd68b75fccce61a7ee8eaccabb52d41c9';
const ACTIVE=['sos-activation','incident-creation','location-tracking','notification-outbox'];
function validate(p,artifact,env,now=Date.now()) {
 if(p.writersQuiesced===true){R(p.emergencyWriterException===undefined,'WRITER_CONTRADICTION');return;}
 R(p.writersQuiesced===false,'WRITER_STATE');
 const e=p.emergencyWriterException;
 C.onlyKeys(e,['version','cutoverId','approvalId','build','artifactSha256','originalManifestSha256','forward','compatibilityEvidenceSha256','appResourceId','databaseResourceId','start','end','lockTimeoutMs','statementTimeoutMs','maxSOSDatabasePhaseMs','timeoutApplySha256','timeoutRestoreSha256','activeWriterClasses','otherWritersQuiesced','writerStateEvidenceSha256'],'EMERGENCY_FIELDS');
 R(e.version===1 && e.cutoverId==='opa-seven-20261010-sos','EMERGENCY_SCOPE');
 R(e.approvalId===p.approvalId && e.build===p.build && e.artifactSha256===artifact.manifestSha256,'EMERGENCY_ARTIFACT');
 R(e.originalManifestSha256===ORIGINAL && e.compatibilityEvidenceSha256===EVIDENCE,'EMERGENCY_EVIDENCE');
 C.onlyKeys(e.forward,Object.keys(C.FORWARD),'EMERGENCY_MIGRATIONS');
 R(Object.keys(e.forward).length===7 && Object.entries(C.FORWARD).every(([n,h])=>e.forward[n]===h && artifact.manifest.forward[n]===h && artifact.manifest.candidate[n]===h),'EMERGENCY_MIGRATIONS');
 R(Object.keys(artifact.manifest.baseline).length===35 && Object.keys(artifact.manifest.candidate).length===42,'EMERGENCY_MIGRATIONS');
 R(p.resources?.app?.id===APP && p.resources?.database?.id===SERVER && e.appResourceId===APP && e.databaseResourceId===SERVER && p.runner?.kind==='azure-app-service' && p.runner.resourceId===APP,'EMERGENCY_RESOURCES');
 R(p.runner.identity?.tenantId==='adb3fb59-1ac3-42c2-b39a-d70c7006ccbc' && p.runner.identity?.principalId==='ed24b331-4dfe-4e07-8aa9-83f835ce7b6c','EMERGENCY_IDENTITY');
 const start=Date.parse(e.start),end=Date.parse(e.end);
 R(Number.isFinite(start) && Number.isFinite(end) && end>start && end-start<=3600000 && now>=start && now<end && Date.parse(p.approvedAt)<=start && Date.parse(p.expiresAt)<=end,'EMERGENCY_WINDOW');
 R(e.lockTimeoutMs===500 && e.statementTimeoutMs===2000 && e.maxSOSDatabasePhaseMs===3000 && e.timeoutApplySha256===APPLY && e.timeoutRestoreSha256===RESTORE,'EMERGENCY_LIMITS');
 R(JSON.stringify(e.activeWriterClasses)===JSON.stringify(ACTIVE) && e.otherWritersQuiesced===true && /^[a-f0-9]{64}$/.test(e.writerStateEvidenceSha256 || ''),'EMERGENCY_WRITERS');
 const u=new URL(env.DATABASE_URL);
 R([...u.searchParams.keys()].every(k=>['sslmode','sslaccept'].includes(k)),'EMERGENCY_CONNECTION_OPTIONS');
}
async function verifyTimeouts(client) {
 const {rows}=await client.query(`SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout,
 (SELECT setconfig FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND setrole=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS role_settings`);
 R(rows.length===1 && rows[0].lock_timeout==='500ms' && rows[0].statement_timeout==='2s' && Array.isArray(rows[0].role_settings) && rows[0].role_settings.includes('lock_timeout=500ms') && rows[0].role_settings.includes('statement_timeout=2s'),'EMERGENCY_TIMEOUTS');
}
async function verifyRestoredTimeouts(client) {
 const {rows}=await client.query("SELECT setconfig FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole=(SELECT oid FROM pg_roles WHERE rolname=current_user)");
 R(rows.length<=1 && (!rows[0] || !rows[0].setconfig.some(v=>v.startsWith('lock_timeout=') || v.startsWith('statement_timeout='))),'EMERGENCY_TIMEOUT_RESTORATION');
}
module.exports={validate,verifyTimeouts,verifyRestoredTimeouts,APP,SERVER,EVIDENCE,ORIGINAL,APPLY,RESTORE,ACTIVE};
