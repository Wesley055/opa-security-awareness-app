'use strict';
// Existing PostgreSQL roles and ACLs provide the maintenance fence. No API
// feature, new service, credentials on disk, or selective SOS exception.
const C=require('./contract.cjs'),{requireThat:R}=C;
const qi=s=>'"'+s.replaceAll('"','""')+'"';
const LOCK='opa-production-maintenance-35-42';
async function lock(db){R((await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS held',[LOCK])).rows[0]?.held===true,'MAINTENANCE_ALREADY_RUNNING')}
async function unlock(db){await db.query('SELECT pg_advisory_unlock(hashtext($1))',[LOCK])}
function acceptance(m,now=Date.now()){
 const p=m.maintenance;
 R(p?.mode==='full-maintenance'&&p.acceptedOutage===true&&p.noActiveUsersVerified===true,'MAINTENANCE_OWNER_ACCEPTANCE_REQUIRED');
 R(typeof p.activityEvidenceSHA256==='string'&&/^[a-f0-9]{64}$/.test(p.activityEvidenceSHA256)&&typeof p.communicationReference==='string'&&p.communicationReference.trim().length>0,'MAINTENANCE_ACTIVITY_AND_NOTICE_REQUIRED');
 R(Date.parse(p.start)<=now&&now<Date.parse(p.end)&&Date.parse(p.end)-Date.parse(p.start)<=1800000,'MAINTENANCE_WINDOW');
 R(m.migration.writersQuiesced===true&&!m.migration.emergencyWriterException,'FULL_MAINTENANCE_REQUIRED');
 return p;
}
async function retainedActivity(db){
 const specs={
  notifications:`SELECT id::text,encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex') digest FROM public."IncidentNotification" n WHERE status::text IN ('SENT','FAILED','CANCELLED') AND "deliveryStatus"::text IN ('UNKNOWN','QUEUED') ORDER BY id`,
  invitations:`SELECT id::text,encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex') digest FROM public."AccountInvitationDelivery" n WHERE status::text IN ('SENT','FAILED','CANCELLED') AND "deliveryStatus"::text IN ('UNKNOWN','QUEUED') ORDER BY id`,
  unmatchedReceipts:`SELECT r.id::text,encode(sha256(convert_to((to_jsonb(r)-'nextReconcileAt'-'reconcileCount')::text,'UTF8')),'hex') digest FROM public."ProviderDeliveryReceipt" r WHERE "processedAt" IS NULL AND NOT EXISTS(SELECT 1 FROM public."ProviderReference" p WHERE p.provider=r.provider AND p."accountScope"=r."accountScope" AND p."messageId"=r."messageId") ORDER BY r.id`
 };
 const bindings={};for(const [name,sql] of Object.entries(specs)){const rows=(await db.query(sql)).rows;bindings[name]={count:rows.length,sha256:C.hash(JSON.stringify(rows))}}return bindings;
}
async function activity(db,approvedRetained){
 const result={};
 const checks={
  genuineIncidents:`SELECT count(*)::int n FROM public."Incident" WHERE status::text IN ('OPEN','ACKNOWLEDGED') AND trigger::text<>'SYSTEM_TEST'`,
  testIncidents:`SELECT count(*)::int n FROM public."Incident" WHERE status::text IN ('OPEN','ACKNOWLEDGED') AND trigger::text='SYSTEM_TEST'`,
  journeys:`SELECT count(*)::int n FROM public."JourneySession" WHERE status::text IN ('STARTED','ACTIVE')`,
  emergencyNotifications:`SELECT count(*)::int n FROM public."IncidentNotification" WHERE status::text IN ('QUEUED','SENDING') OR "deliveryStatus"::text='ATTEMPTING'`,
  invitations:`SELECT count(*)::int n FROM public."AccountInvitationDelivery" WHERE status::text IN ('QUEUED','SENDING') OR "deliveryStatus"::text='ATTEMPTING'`,
  safeWalkNotices:`SELECT count(*)::int n FROM public."SafeWalkNotice" WHERE status::text IN ('QUEUED','SENDING') OR "deliveryStatus"::text IN ('QUEUED','ATTEMPTING','UNKNOWN')`,
  attempts:`SELECT count(*)::int n FROM public."DeliveryAttempt" WHERE status::text='ATTEMPTING'`,
  matchingReceipts:`SELECT count(*)::int n FROM public."ProviderDeliveryReceipt" r WHERE "processedAt" IS NULL AND EXISTS(SELECT 1 FROM public."ProviderReference" p WHERE p.provider=r.provider AND p."accountScope"=r."accountScope" AND p."messageId"=r."messageId")`,
  escalations:`SELECT count(*)::int n FROM public."SafeWalkEscalation" WHERE state::text IN ('SCHEDULED','CHECK_REQUIRED','ESCALATED')`
 };
 for(const [name,sql] of Object.entries(checks))result[name]=(await db.query(sql)).rows[0]?.n;
 R(Object.values(result).every(n=>Number.isSafeInteger(n)&&n===0),'MAINTENANCE_ACTIVITY_REQUIRES_RECONCILIATION');
 const retained=await retainedActivity(db);
 for(const [name,binding] of Object.entries(retained))R(binding.count===0||(approvedRetained?.[name]?.count===binding.count&&approvedRetained[name].sha256===binding.sha256),'RETAINED_ACTIVITY_BINDING_CHANGED');
 result.retainedActivity=retained;
 // Zero database work is necessary, but does not prove no active users. The
 // independently reviewed telemetry/communication receipt above is mandatory.
 return result;
}
async function state(db){return (await db.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname=$1`,[C.RUNTIME])).rows[0]}
async function drained(db,allowed=[]){
 const rows=(await db.query(`SELECT pid,usename FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`)).rows;
 R(rows.every(r=>allowed.includes(r.usename))&&rows.length<=allowed.length,'DATABASE_WRITERS_NOT_DRAINED');
 R((await db.query('SELECT count(*)::int n FROM pg_prepared_xacts WHERE database=current_database()')).rows[0]?.n===0,'PREPARED_TRANSACTIONS_NOT_DRAINED');
}
async function enter(db,manifest,save,now=Date.now){
 acceptance(manifest,now());await lock(db);
 try{
  const other=(await db.query(`SELECT DISTINCT r.rolname FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolcanlogin AND NOT r.rolsuper AND r.rolname NOT IN ($1,$2,current_user) AND n.nspname='public' AND c.relkind IN ('r','p') AND has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')`,[C.RUNTIME,C.MIGRATOR])).rows;
  R(other.length===0,'UNCONTROLLED_DATABASE_WRITER');
  const prior=await state(db);R(prior?.rolcanlogin===true,'UNEXPLAINED_EXISTING_MAINTENANCE');
  const beforeActivity=await activity(db,manifest.maintenance.retainedActivity);
  const snapshot={version:1,releaseId:manifest.releaseId,phase:'intent',originalLogin:true,beforeActivity,grants:[]};
  // Persist intent before any role mutation; failures never auto-reopen writes.
  await save(snapshot);
  await db.query(`ALTER ROLE ${qi(C.RUNTIME)} NOLOGIN`);
  snapshot.phase='login-fenced';await save(snapshot);
  // Existing sessions may finish already admitted transactions for 30 seconds.
  const end=now()+30000;
  while((await db.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND xact_start IS NOT NULL`,[C.RUNTIME])).rows[0].n>0&&now()<end)await new Promise(r=>setTimeout(r,250));
  await db.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND pid<>pg_backend_pid()',[C.RUNTIME]);
  await drained(db);
  snapshot.activity=await activity(db,manifest.maintenance.retainedActivity);snapshot.phase='drained';await save(snapshot);return snapshot;
 }catch(e){await unlock(db);throw e}
}
async function verifyFence(db,allowed=[]){R((await state(db))?.rolcanlogin===false,'RUNTIME_LOGIN_FENCE_REQUIRED');await drained(db,allowed)}
async function readOnlyStartup(db,snapshot,save){
 R(snapshot.phase==='drained','MAINTENANCE_PHASE');await verifyFence(db);
 // Reject alternate LOGIN writers, PUBLIC writes, column-only grants, runtime
 // ownership and SECURITY DEFINER write paths before allowing startup reads.
 const unsafe=(await db.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=$1)) OR EXISTS(SELECT 1 FROM information_schema.column_privileges WHERE grantee=$1 AND privilege_type IN ('INSERT','UPDATE') AND NOT EXISTS(SELECT 1 FROM information_schema.table_privileges t WHERE t.grantee=$1 AND t.table_schema=column_privileges.table_schema AND t.table_name=column_privileges.table_name AND t.privilege_type=column_privileges.privilege_type)) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege($1,p.oid,'EXECUTE')) AS unsafe`,[C.RUNTIME])).rows[0];
 R(unsafe?.unsafe===false,'UNFENCED_RUNTIME_WRITE_AUTHORITY');
 const grants=(await db.query(`SELECT n.nspname AS schema,c.relname AS name,c.relkind,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a WHERE n.nspname='public' AND c.relkind IN ('r','p','S') AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1) AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','USAGE') ORDER BY n.nspname,c.relname,a.privilege_type`,[C.RUNTIME])).rows;
 snapshot.grants=grants;snapshot.phase='acl-intent';await save(snapshot);
 await db.query('BEGIN');
 const authority=(await db.query("SELECT current_user AS name,pg_has_role(current_user,$1,'MEMBER') AS member",[C.OWNER])).rows[0];
 try{
  if(!authority.member)await db.query(`GRANT ${qi(C.OWNER)} TO ${qi(authority.name)}`);
  for(const g of grants)await db.query(`REVOKE ${g.privilege} ON ${g.relkind==='S'?'SEQUENCE':'TABLE'} ${qi(g.schema)}.${qi(g.name)} FROM ${qi(C.RUNTIME)}`);
  await assertReadOnly(db);
  await db.query(`ALTER ROLE ${qi(C.RUNTIME)} LOGIN`);if(!authority.member)await db.query(`REVOKE ${qi(C.OWNER)} FROM ${qi(authority.name)}`);await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e}
 snapshot.phase='read-only-startup';await save(snapshot);return snapshot;
}
async function assertReadOnly(db){
 const r=(await db.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND ((c.relkind IN ('r','p') AND has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')) OR (c.relkind='S' AND has_sequence_privilege($1,c.oid,'USAGE,UPDATE')))) AS writable`,[C.RUNTIME])).rows[0];
 R(r?.writable===false,'RUNTIME_WRITE_FENCE_INCOMPLETE');
}
async function restore(db,snapshot,{validatedSchema,validatedBuild,allowedBuilds},save){
 R(snapshot.phase==='read-only-startup'&&validatedSchema===42&&allowedBuilds.includes(validatedBuild),'VERIFIED_API42_RECOVERY_REQUIRED');
 await lock(db);await assertReadOnly(db);
 await db.query('BEGIN');
 const authority=(await db.query("SELECT current_user AS name,pg_has_role(current_user,$1,'MEMBER') AS member",[C.OWNER])).rows[0];
 try{
  if(!authority.member)await db.query(`GRANT ${qi(C.OWNER)} TO ${qi(authority.name)}`);
  for(const g of snapshot.grants){R(['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','USAGE'].includes(g.privilege)&&g.schema==='public'&&['r','p','S'].includes(g.relkind),'MAINTENANCE_GRANT_SCOPE');await db.query(`GRANT ${g.privilege} ON ${g.relkind==='S'?'SEQUENCE':'TABLE'} ${qi(g.schema)}.${qi(g.name)} TO ${qi(C.RUNTIME)}${g.grantable?' WITH GRANT OPTION':''}`)}
  await db.query(`ALTER ROLE ${qi(C.RUNTIME)} LOGIN`);if(!authority.member)await db.query(`REVOKE ${qi(C.OWNER)} FROM ${qi(authority.name)}`);await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e}
 snapshot.phase='restored';await save(snapshot);await unlock(db);return snapshot;
}
module.exports={acceptance,activity,retainedActivity,enter,verifyFence,readOnlyStartup,assertReadOnly,restore,lock,unlock};
