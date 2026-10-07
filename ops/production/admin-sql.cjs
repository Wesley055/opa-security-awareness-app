"use strict";
// Generates reviewable SQL. It never connects to PostgreSQL or executes SQL.
const fs = require('node:fs'), path=require('node:path'), C=require('./contract.cjs');
const qi = n => '"'+n.replaceAll('"','""')+'"';
const ql = n => "'"+n.replaceAll("'","''")+"'";
const header = `\\set ON_ERROR_STOP on
-- Administrator only. Explicit production approval required before running.
-- No credentials in this script. Use an approved TLS psql service/credential provider.
DO $$ BEGIN
 IF current_database() <> ${ql(C.DB)} OR (SELECT count(*) FROM opa_deployment.environment_identity) <> 1
 OR NOT EXISTS(SELECT 1 FROM opa_deployment.environment_identity WHERE singleton AND environment='production')
 THEN RAISE EXCEPTION 'ADMIN_DATABASE_IDENTITY'; END IF;
 IF current_user IN (${ql(C.RUNTIME)},${ql(C.MIGRATOR)},${ql(C.OWNER)}) THEN RAISE EXCEPTION 'ADMIN_IDENTITY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolinherit)) THEN RAISE EXCEPTION 'ADMIN_INHERIT_REQUIRED'; END IF;
END $$;
`;
const ownerRole = qi(C.OWNER), migrator=qi(C.MIGRATOR), runtime=qi(C.RUNTIME);
function borrow(role,slot) {
  return `DO $$ BEGIN
 PERFORM set_config('opa.${slot}_was_member',pg_has_role(current_user,${ql(role)},'MEMBER')::text,true);
 IF NOT pg_has_role(current_user,${ql(role)},'MEMBER') THEN EXECUTE format('GRANT %I TO %I',${ql(role)},current_user); END IF;
END $$;\n`;
}
function release(role,slot) {
  return `DO $$ BEGIN
 IF NOT current_setting('opa.${slot}_was_member')::boolean THEN EXECUTE format('REVOKE %I FROM %I',${ql(role)},current_user); END IF;
END $$;\n`;
}
const scopeGuard = `DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN (${ql(C.OWNER)},${ql(C.MIGRATOR)},${ql(C.RUNTIME)})
   AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 THEN RAISE EXCEPTION 'ADMIN_ROLE_ATTRIBUTES'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${ql(C.OWNER)} AND NOT rolcanlogin)
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=${ql(C.OWNER)}))
 THEN RAISE EXCEPTION 'ADMIN_OWNER_ROLE'; END IF;
END $$;
`;
function sql() {
  const prepare = header+`BEGIN;
CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
${scopeGuard}
${borrow(C.OWNER,'prepare_owner')}
-- Required for ownership transfer, revoked before commit. No permanent schema DDL.
GRANT USAGE, CREATE ON SCHEMA public TO ${ownerRole};
`+C.EXISTING_TABLES.map(n=>`ALTER TABLE public.${qi(n)} OWNER TO ${ownerRole};`).join('\n')+`
ALTER TYPE public."UserRole" OWNER TO ${ownerRole};
-- Ownership is DDL authority, not proof an old owner retained ordinary ACLs.
GRANT SELECT ON public."User", public."Facility", public."EnrollmentRequest", public."IncidentTimelineEvent" TO ${ownerRole};
GRANT UPDATE ON public."User", public."Facility" TO ${ownerRole};
GRANT TRIGGER ON public."User", public."Facility" TO ${ownerRole};
GRANT USAGE ON TYPE public."UserRole" TO ${ownerRole};
REVOKE CREATE ON SCHEMA public FROM ${ownerRole};
-- PUBLIC TEMP permits temporary-table DDL: remove it; grant only to separately
-- reviewed administrators if required. This changes no application table data.
REVOKE TEMPORARY ON DATABASE ${qi(C.DB)} FROM PUBLIC, ${runtime}, ${migrator};
GRANT CONNECT ON DATABASE ${qi(C.DB)} TO ${migrator};
GRANT USAGE ON SCHEMA public, opa_deployment TO ${migrator};
GRANT SELECT ON opa_deployment.environment_identity TO ${migrator};
GRANT SELECT ON public._prisma_migrations TO ${migrator};
-- Metadata visibility for Prisma diff, not SELECT access to application data.
GRANT REFERENCES ON ${C.BASELINE_TABLES.map(n=>'public.'+qi(n)).join(', ')} TO ${migrator};
-- Retain existing ACLs on transferred objects. Never grant the owner to runtime.
${release(C.OWNER,'prepare_owner')}
COMMIT;
`;
  const activate = header+`BEGIN;
${scopeGuard}
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=${ql(C.MIGRATOR)}) THEN RAISE EXCEPTION 'MIGRATION_SESSIONS_EXIST'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN (${ql(C.RUNTIME)},${ql(C.MIGRATOR)})))
 THEN RAISE EXCEPTION 'UNEXPECTED_MEMBERSHIP'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname IN (${ql(C.OWNER)},${ql(C.MIGRATOR)})))
 THEN RAISE EXCEPTION 'UNEXPECTED_DELEGATION'; END IF;
END $$;
${borrow(C.MIGRATOR,'activate_migrator')}
GRANT ${ownerRole} TO ${migrator};
GRANT CREATE ON SCHEMA public TO ${migrator};
GRANT INSERT, UPDATE ON public._prisma_migrations TO ${migrator};
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime};
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${runtime};
-- Trigger functions are invoker rights; no SECURITY DEFINER is permitted.
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${runtime};
${release(C.MIGRATOR,'activate_migrator')}
COMMIT;
`;
  // Revocation is committed BEFORE ownership reconciliation. A failure to
  // reconcile must not roll back the privilege revocation transaction.
  const cleanup = header+`BEGIN;
${borrow(C.MIGRATOR,'revoke_migrator')}
REVOKE ${ownerRole} FROM ${migrator};
REVOKE CREATE ON SCHEMA public FROM ${migrator};
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public._prisma_migrations FROM ${migrator};
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${runtime};
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM ${runtime};
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM ${runtime};
${release(C.MIGRATOR,'revoke_migrator')}
COMMIT;
-- Quiesce runner first. Administrator needs pg_signal_backend authority or
-- authority over these sessions, not a superuser migration login.
BEGIN;
${borrow(C.MIGRATOR,'transfer_migrator')}
${borrow(C.OWNER,'transfer_owner')}
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=${ql(C.MIGRATOR)} AND pid<>pg_backend_pid();
DO $$ DECLARE attempt integer; BEGIN
 FOR attempt IN 1..50 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=${ql(C.MIGRATOR)});
  PERFORM pg_sleep(0.1);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=${ql(C.MIGRATOR)}) THEN RAISE EXCEPTION 'MIGRATION_SESSIONS_REMAIN'; END IF;
END $$;
${scopeGuard}
GRANT CREATE ON SCHEMA public TO ${ownerRole};
`+C.TABLES.map(n=>`DO $$ BEGIN IF to_regclass(${ql('public.'+qi(n))}) IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass(${ql('public.'+qi(n))})) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN (${ql(C.MIGRATOR)},${ql(C.OWNER)})) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public.${qi(n)} OWNER TO ${ownerRole};
 GRANT SELECT, INSERT, UPDATE, DELETE ON public.${qi(n)} TO ${runtime};
 GRANT REFERENCES ON public.${qi(n)} TO ${migrator};
END IF; END $$;`).join('\n')+'\n'+C.SEQUENCES.map(n=>`DO $$ BEGIN IF to_regclass(${ql('public.'+qi(n))}) IS NOT NULL THEN ALTER SEQUENCE public.${qi(n)} OWNER TO ${ownerRole}; GRANT USAGE, SELECT ON SEQUENCE public.${qi(n)} TO ${runtime}; END IF; END $$;`).join('\n')+'\n'+C.TYPES.map(n=>`DO $$ BEGIN IF to_regtype(${ql('public.'+qi(n))}) IS NOT NULL THEN ALTER TYPE public.${qi(n)} OWNER TO ${ownerRole}; GRANT USAGE ON TYPE public.${qi(n)} TO ${runtime}; END IF; END $$;`).join('\n')+'\n'+C.FUNCTIONS.map(n=>`DO $$ BEGIN IF to_regprocedure(${ql('public.'+qi(n)+'()')}) IS NOT NULL THEN ALTER FUNCTION public.${qi(n)}() OWNER TO ${ownerRole}; REVOKE ALL ON FUNCTION public.${qi(n)}() FROM PUBLIC, ${migrator}; GRANT EXECUTE ON FUNCTION public.${qi(n)}() TO ${runtime}; END IF; END $$;`).join('\n')+`
REVOKE CREATE ON SCHEMA public FROM ${ownerRole};
${release(C.OWNER,'transfer_owner')}
${release(C.MIGRATOR,'transfer_migrator')}
COMMIT;
-- The independent verify-cleanup command must pass, including no remaining
-- migration-owned objects. Unexpected objects require an incident review.
`;
  return {'prepare.sql':prepare,'activate.sql':activate,'cleanup.sql':cleanup};
}
if (require.main===module) {
  try {
    C.requireThat(process.argv.length===3,'ADMIN_ARGUMENTS');
    const dir=path.resolve(process.argv[2]); C.requireThat(!fs.existsSync(dir),'ADMIN_NEW_DIRECTORY');
    fs.mkdirSync(dir,{recursive:true});
    for (const [name,bytes] of Object.entries(sql())) fs.writeFileSync(path.join(dir,name),bytes,{flag:'wx'});
    console.log(JSON.stringify({status:'generated',scripts:Object.fromEntries(Object.entries(sql()).map(([n,b])=>[n,C.hash(b)]))}));
  } catch { console.error('ADMIN_SQL_GENERATION_REJECTED'); process.exitCode=1; }
}
module.exports={sql};
