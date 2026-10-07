"use strict";
const C = require('./contract.cjs');
const fs=require('node:fs'),path=require('node:path');
const {requireThat:R} = C;
async function identity(client, policy) {
  const rows = (await client.query(`SELECT singleton, environment, to_jsonb(i) AS sentinel, current_database() AS database, current_user AS role,
    host(inet_server_addr()) AS address FROM opa_deployment.environment_identity i`)).rows;
  R(rows.length===1 && rows[0].singleton===true && rows[0].environment==='production' && rows[0].database===C.DB && rows[0].role===C.MIGRATOR,'DATABASE_IDENTITY');
  R(policy.runner.databaseAddresses.includes(rows[0].address),'DATABASE_PRIVATE_ADDRESS');
  const digest=C.hash(JSON.stringify(rows[0].sentinel));
  R(digest===policy.sentinelSha256,'SENTINEL_BINDING');
  return digest;
}
async function history(client, expected) {
  const rows = (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations')).rows;
  C.ledger(rows,expected);
  return Object.keys(expected).length;
}
// Counts only: personal data and database exception text never enter receipts.
async function compatibility(client) {
  const checks = {
    supportTenant:`SELECT count(*)::int AS n FROM public."User" WHERE role::text='TECHNICAL_SUPPORT' AND "facilityId" IS NOT NULL`,
    enrollment:`SELECT count(*)::int AS n FROM public."EnrollmentRequest" WHERE NOT (
      ("requestedRole"::text='TECHNICAL_SUPPORT' AND "facilityId" IS NULL AND "invitedByUserId" IS NOT NULL)
      OR ("requestedRole"::text<>'TECHNICAL_SUPPORT' AND (("facilityId" IS NULL)=("invitedByUserId" IS NULL))))`,
    institutional:`SELECT count(*)::int AS n FROM public."EnrollmentRequest" WHERE NOT (
      "requestedRole"::text='USER' OR ("requestedRole"::text IN ('FACILITY_ADMIN','FACILITY_OPERATOR') AND "facilityId" IS NOT NULL AND "invitedByUserId" IS NOT NULL)
      OR ("requestedRole"::text='TECHNICAL_SUPPORT' AND "facilityId" IS NULL AND "invitedByUserId" IS NOT NULL))`,
    operationalExceptions:`SELECT count(*)::int AS n FROM (SELECT "incidentId",payload->>'kind' FROM public."IncidentTimelineEvent"
      WHERE type='OPERATIONAL_EXCEPTION' AND payload->>'kind' IS NOT NULL GROUP BY "incidentId",payload->>'kind' HAVING count(*)>1) duplicates`,
  };
  const result = {};
  for (const [name,sql] of Object.entries(checks)) {
    result[name]=(await client.query(sql)).rows[0]?.n;
    R(result[name]===0,'DATA_COMPATIBILITY');
  }
  return result;
}
async function preStructure(client) {
  const drift=(await client.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]))
    OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=ANY($2::text[]))
    OR EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='public' AND f.proname=ANY($3::text[]))
    OR EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='UserRole' AND e.enumlabel='TECHNICAL_SUPPORT')
    OR EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT a.attisdropped AND ((c.relname='User' AND a.attname='membershipState') OR
      (c.relname='Facility' AND a.attname IN ('commissionedAt','operationalState','organizationId')) OR
      (c.relname='AdministrativeAuditEvent' AND a.attname IN ('authorityKind','authorityGrantId','caseReference','correlationId')))) AS drift`,
    [[...C.TABLES,...C.SEQUENCES,'operational_exception_once'],C.TYPES,C.FUNCTIONS])).rows[0];
  R(drift?.drift===false,'UNLEDGERED_SCHEMA_DRIFT');
}
async function posture(client, active) {
  const roles = (await client.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolcanlogin,rolinherit
    FROM pg_roles WHERE rolname=ANY($1::text[])`, [[C.RUNTIME,C.MIGRATOR,C.OWNER]])).rows;
  R(roles.length===3,'ROLE_MISSING');
  for (const role of roles) {
    R(!role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolreplication && !role.rolbypassrls,'ROLE_ELEVATION');
    R(role.rolcanlogin === (role.rolname!==C.OWNER),'ROLE_LOGIN');
  }
  R(roles.find(r=>r.rolname===C.MIGRATOR).rolinherit,'ROLE_INHERIT');
  const memberships = (await client.query(`WITH RECURSIVE m AS (
    SELECT member,roleid FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))
    UNION SELECT m.member,a.roleid FROM m JOIN pg_auth_members a ON a.member=m.roleid)
    SELECT child.rolname AS member,parent.rolname AS parent FROM m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid`,[[C.RUNTIME,C.MIGRATOR,C.OWNER]])).rows;
  R(memberships.length===(active?1:0) && memberships.every(m=>active && m.member===C.MIGRATOR && m.parent===C.OWNER),'ROLE_MEMBERSHIP');
  const delegates=(await client.query(`SELECT child.rolname AS member,parent.rolname AS parent,a.admin_option
    FROM pg_auth_members a JOIN pg_roles child ON child.oid=a.member JOIN pg_roles parent ON parent.oid=a.roleid
    WHERE parent.rolname=ANY($1::text[])`,[[C.MIGRATOR,C.OWNER]])).rows;
  R(delegates.length===(active?1:0) && delegates.every(d=>active && d.member===C.MIGRATOR && d.parent===C.OWNER && d.admin_option===false),'ROLE_DELEGATION');
  const metadata=(await client.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[]) AND has_table_privilege($2,c.oid,'REFERENCES')`,[C.BASELINE_TABLES,C.MIGRATOR])).rows[0];
  R(metadata?.n===C.BASELINE_TABLES.length,'SCHEMA_METADATA_PRIVILEGES');
  for (const name of [C.RUNTIME,C.MIGRATOR,C.OWNER]) {
    const p = (await client.query(`SELECT
      has_database_privilege($1,current_database(),'CONNECT') AS connect,
      has_database_privilege($1,current_database(),'CREATE') AS db_create,
      has_database_privilege($1,current_database(),'TEMP') AS temp,
      has_schema_privilege($1,'public','USAGE') AS usage,
      has_schema_privilege($1,'public','CREATE') AS public_create,
      has_schema_privilege($1,'opa_deployment','USAGE') AS sentinel_usage,
      has_table_privilege($1,'opa_deployment.environment_identity','SELECT') AS sentinel_read,
      EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname<>'public' AND (has_schema_privilege($1,n.oid,'CREATE') OR pg_has_role($1,n.nspowner,'MEMBER'))) AS other_schema_ddl,
      EXISTS(SELECT 1 FROM pg_namespace n WHERE pg_has_role($1,n.nspowner,'MEMBER')) AS schema_owner,
      pg_has_role($1,(SELECT datdba FROM pg_database WHERE datname=current_database()),'MEMBER') AS db_owner,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND c.relkind IN ('r','p','S','v','m','f') AND pg_has_role($1,c.relowner,'MEMBER')) AS object_owner,
      EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND pg_has_role($1,t.typowner,'MEMBER')) AS type_owner,
      EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND (pg_has_role($1,f.proowner,'MEMBER') OR (f.prosecdef AND has_function_privilege($1,f.oid,'EXECUTE')))) AS function_authority,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p')
        AND has_table_privilege($1,c.oid,'TRIGGER')) AS trigger_authority,
      EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='opa_deployment.environment_identity'::regclass AND a.attnum>0 AND NOT a.attisdropped
        AND (has_column_privilege($1,a.attrelid,a.attnum,'INSERT') OR has_column_privilege($1,a.attrelid,a.attnum,'UPDATE') OR has_column_privilege($1,a.attrelid,a.attnum,'REFERENCES'))) OR
      has_table_privilege($1,'opa_deployment.environment_identity','DELETE,TRUNCATE,REFERENCES,TRIGGER') AS sentinel_write,
      has_table_privilege($1,'public._prisma_migrations','SELECT') AS ledger_read,
      has_table_privilege($1,'public._prisma_migrations','INSERT') AS ledger_insert,
      has_table_privilege($1,'public._prisma_migrations','UPDATE') AS ledger_update,
      has_table_privilege($1,'public._prisma_migrations','DELETE,TRUNCATE,REFERENCES,TRIGGER') AS ledger_extra,
      EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public._prisma_migrations'::regclass AND a.attnum>0 AND NOT a.attisdropped
        AND (has_column_privilege($1,a.attrelid,a.attnum,'INSERT') OR has_column_privilege($1,a.attrelid,a.attnum,'UPDATE'))) AS ledger_column_write,
      EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
        AND c.oid NOT IN ('public._prisma_migrations'::regclass,'opa_deployment.environment_identity'::regclass)
        AND CASE WHEN a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p')
          THEN has_column_privilege($1,a.attrelid,a.attnum,'SELECT,INSERT,UPDATE') ELSE false END)
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND c.relkind IN ('r','p') AND c.oid NOT IN ('public._prisma_migrations'::regclass,'opa_deployment.environment_identity'::regclass)
        AND has_table_privilege($1,c.oid,'DELETE,TRUNCATE')) AS application_authority,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND c.relkind='S' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege($1,c.oid,'USAGE,SELECT,UPDATE') ELSE false END) AS sequence_authority`,[name])).rows[0];
    if(name===C.OWNER) {
      R(p && !p.db_create && !p.temp && !p.public_create && !p.other_schema_ddl && !p.schema_owner && !p.db_owner && !p.sentinel_usage && !p.sentinel_read && !p.sentinel_write && !p.ledger_read && !p.ledger_column_write && !p.ledger_extra,'OWNER_PRIVILEGES');
      continue;
    }
    R(p && p.connect && p.usage && p.sentinel_usage && p.sentinel_read && p.ledger_read && !p.db_create && !p.temp && !p.other_schema_ddl && !p.schema_owner && !p.db_owner && !p.sentinel_write && !p.ledger_extra,'ROLE_BOUNDARY');
    const elevated = active && name===C.MIGRATOR;
    R(p.public_create===elevated,'SCHEMA_CREATE');
    if (!elevated) R(!p.object_owner && !p.type_owner && !p.function_authority && !p.trigger_authority,'IDLE_DDL');
    if (name===C.MIGRATOR) R(p.ledger_insert===elevated && p.ledger_update===elevated && p.ledger_column_write===elevated,'LEDGER_PRIVILEGES');
    else R(!p.ledger_insert && !p.ledger_update && !p.ledger_column_write,'RUNTIME_LEDGER_WRITE');
    if(name===C.MIGRATOR && !active)R(!p.application_authority && !p.sequence_authority,'IDLE_APPLICATION_AUTHORITY');
  }
  // Even during activation, the owner and migration roles may own only the
  // reviewed public objects. Indexes and row/array types follow parent ownership.
  const outside = (await client.query(`SELECT EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))
      AND NOT ((n.nspname='public' AND (c.relname=ANY($2::text[]) OR (c.relkind='i' AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid WHERE i.indexrelid=c.oid AND t.relname=ANY($2::text[])))))
        OR (n.nspname='pg_toast' AND EXISTS(SELECT 1 FROM pg_class base JOIN pg_namespace bn ON bn.oid=base.relnamespace WHERE bn.nspname='public' AND base.relname=ANY($2::text[])
          AND (base.reltoastrelid=c.oid OR EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=c.oid AND i.indrelid=base.reltoastrelid)))))
    UNION ALL SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE f.proowner IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))
      AND NOT (n.nspname='public' AND f.proname=ANY($3::text[]) AND f.pronargs=0 AND NOT f.prosecdef)
    UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typowner IN (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))
      AND NOT (n.nspname='public' AND (t.typname=ANY($4::text[]) OR t.typname=ANY($5::text[])))) AS outside`,
    [[C.OWNER,C.MIGRATOR],[...C.EXISTING_TABLES,...C.TABLES,...C.SEQUENCES],C.FUNCTIONS,
      ['UserRole',...C.TYPES,...C.EXISTING_TABLES,...C.TABLES],['UserRole',...C.TYPES,...C.EXISTING_TABLES,...C.TABLES].map(n=>'_'+n)])).rows[0];
  R(outside?.outside===false,'OWNER_SCOPE');
  const expectedOwners=(await client.query(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[]) AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=$2)) AS existing,
    EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='UserRole' AND t.typowner=(SELECT oid FROM pg_roles WHERE rolname=$2)) AS user_role,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($3::text[]) AND c.relkind IN ('r','S') AND c.relowner NOT IN (SELECT oid FROM pg_roles WHERE rolname=ANY($4::text[])))
    OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=ANY($5::text[]) AND t.typowner NOT IN (SELECT oid FROM pg_roles WHERE rolname=ANY($4::text[])))
    OR EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='public' AND f.proname=ANY($6::text[]) AND f.proowner NOT IN (SELECT oid FROM pg_roles WHERE rolname=ANY($4::text[]))) AS wrong_new`,
    [C.EXISTING_TABLES,C.OWNER,[...C.TABLES,...C.SEQUENCES],active?[C.OWNER,C.MIGRATOR]:[C.OWNER],C.TYPES,C.FUNCTIONS])).rows[0];
  R(expectedOwners?.existing===C.EXISTING_TABLES.length && expectedOwners.user_role && !expectedOwners.wrong_new,'APPROVED_OBJECT_OWNERS');
  if (!active) {
    const defaults=(await client.query(`SELECT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=$1) AND a.grantee<>d.defaclrole) AS remains`,[C.MIGRATOR])).rows[0];
    R(defaults?.remains===false,'DEFAULT_GRANTS_REMAIN');
    const remaining = (await client.query(`SELECT count(*)::int AS n FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=$1)
      UNION ALL SELECT count(*)::int FROM pg_type WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname=$1)
      UNION ALL SELECT count(*)::int FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=$1)`,[C.MIGRATOR])).rows;
    R(remaining.every(r=>r.n===0),'MIGRATOR_OWNERSHIP_REMAINS');
  }
  return {runtimeDdl:false,migrationActive:active,sentinelMutable:false};
}
async function structure(client) {
  const checks = [
    ['tables',`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[])`,C.TABLES],
    ['types',`SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' AND t.typname=ANY($1::text[])`,C.TYPES],
    ['triggers',`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgname=ANY($1::text[])`,C.FUNCTIONS],
  ];
  for (const [,sql,names] of checks) R((await client.query(sql,[names])).rows[0]?.n===names.length,'SCHEMA_STRUCTURE');
  const files=Object.keys(C.FORWARD).map(n=>fs.readFileSync(path.resolve(__dirname,'../../apps/api/prisma/migrations',n,'migration.sql'),'utf8'));
  const sql=files.join('\n');
  // PostgreSQL NAMEDATALEN truncates these ASCII migration identifiers to 63
  // bytes, including the historical SupportCapabilityGrant index name.
  const names=regex=>[...new Set([...sql.matchAll(regex)].map(m=>(m[1] || m[2]).slice(0,63)))];
  const constraints=names(/\bCONSTRAINT\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi);
  const indexes=names(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi);
  for (const [query,expected] of [
    [`SELECT DISTINCT c.conname AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.convalidated AND c.conname=ANY($1::text[])`,constraints],
    [`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_index i ON i.indexrelid=c.oid WHERE n.nspname='public' AND i.indisvalid AND i.indisready AND c.relname=ANY($1::text[])`,indexes],
  ]) R((await client.query(query,[expected])).rows.length===expected.length,'MIGRATION_SCHEMA_OBJECTS');
  const bodies=new Map([...sql.matchAll(/CREATE FUNCTION\s+([a-z_]+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/g)].map(m=>[m[1],m[2].trim().replaceAll('\r\n','\n')]));
  R(bodies.size===C.FUNCTIONS.length,'FUNCTION_CONTRACT');
  const functions=(await client.query(`SELECT f.proname,f.prosrc FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='public'
    AND f.proname=ANY($1::text[]) AND f.pronargs=0 AND NOT f.prosecdef AND f.prorettype='trigger'::regtype`,[C.FUNCTIONS])).rows;
  R(functions.length===C.FUNCTIONS.length && functions.every(f=>bodies.get(f.proname)===f.prosrc.trim().replaceAll('\r\n','\n')),'FUNCTION_BODY');
  const triggers=(await client.query(`SELECT t.tgname,t.tgtype,c.relname,f.proname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc f ON f.oid=t.tgfoid
    WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgname=ANY($1::text[])`,[C.FUNCTIONS])).rows;
  const triggerContract={protect_last_facility_admin:['User',27],commission_facility_admin:['User',21],protect_commissioning_evidence:['CommissioningEvidence',27],synchronize_facility_operational_state:['Facility',23]};
  R(triggers.length===4 && triggers.every(t=>t.proname===t.tgname && triggerContract[t.tgname]?.[0]===t.relname && triggerContract[t.tgname]?.[1]===t.tgtype),'TRIGGER_CONTRACT');
  const invalid = (await client.query(`SELECT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready)) OR EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated) AS invalid`)).rows[0];
  R(invalid?.invalid===false,'SCHEMA_INVALID');
  // DML/type/sequence access for new runtime objects must survive owner transfer.
  for (const name of C.TABLES) {
    const p = (await client.query(`SELECT has_table_privilege($1,format('public.%I',$2),'SELECT') AND has_table_privilege($1,format('public.%I',$2),'INSERT') AND has_table_privilege($1,format('public.%I',$2),'UPDATE') AND has_table_privilege($1,format('public.%I',$2),'DELETE') AS ok`,[C.RUNTIME,name])).rows[0];
    R(p?.ok===true,'RUNTIME_NEW_TABLE_ACCESS');
  }
  for (const name of C.SEQUENCES) R((await client.query(`SELECT has_sequence_privilege($1,format('public.%I',$2),'USAGE') AS ok`,[C.RUNTIME,name])).rows[0]?.ok===true,'RUNTIME_SEQUENCE_ACCESS');
}
module.exports = {identity,history,compatibility,preStructure,posture,structure};
