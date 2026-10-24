\set ON_ERROR_STOP on
-- Administrator only. Explicit production approval required before running.
-- No credentials in this script. Use an approved TLS psql service/credential provider.
DO $$ BEGIN
 IF current_database() <> 'opa-api-production-database' OR (SELECT count(*) FROM opa_deployment.environment_identity) <> 1
 OR NOT EXISTS(SELECT 1 FROM opa_deployment.environment_identity WHERE singleton AND environment='production')
 THEN RAISE EXCEPTION 'ADMIN_DATABASE_IDENTITY'; END IF;
 IF current_user IN ('opa_production_runtime','opa_production_migrations','opa_production_release_owner') THEN RAISE EXCEPTION 'ADMIN_IDENTITY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolinherit)) THEN RAISE EXCEPTION 'ADMIN_INHERIT_REQUIRED'; END IF;
END $$;
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('opa_production_release_owner','opa_production_migrations','opa_production_runtime')
   AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 THEN RAISE EXCEPTION 'ADMIN_ROLE_ATTRIBUTES'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='opa_production_release_owner' AND NOT rolcanlogin)
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='opa_production_release_owner'))
 THEN RAISE EXCEPTION 'ADMIN_OWNER_ROLE'; END IF;
END $$;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='opa_production_migrations') THEN RAISE EXCEPTION 'MIGRATION_SESSIONS_EXIST'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_runtime','opa_production_migrations')))
 THEN RAISE EXCEPTION 'UNEXPECTED_MEMBERSHIP'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_release_owner','opa_production_migrations')))
 THEN RAISE EXCEPTION 'UNEXPECTED_DELEGATION'; END IF;
END $$;
DO $$ BEGIN
 PERFORM set_config('opa.activate_migrator_was_member',pg_has_role(current_user,'opa_production_migrations','MEMBER')::text,true);
 IF NOT pg_has_role(current_user,'opa_production_migrations','MEMBER') THEN EXECUTE format('GRANT %I TO %I','opa_production_migrations',current_user); END IF;
END $$;

GRANT "opa_production_release_owner" TO "opa_production_migrations";
GRANT CREATE ON SCHEMA public TO "opa_production_migrations";
GRANT INSERT, UPDATE ON public._prisma_migrations TO "opa_production_migrations";
ALTER DEFAULT PRIVILEGES FOR ROLE "opa_production_migrations" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "opa_production_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "opa_production_migrations" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "opa_production_runtime";
-- Trigger functions are invoker rights; no SECURITY DEFINER is permitted.
ALTER DEFAULT PRIVILEGES FOR ROLE "opa_production_migrations" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "opa_production_migrations" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "opa_production_runtime";
DO $$ BEGIN
 IF NOT current_setting('opa.activate_migrator_was_member')::boolean THEN EXECUTE format('REVOKE %I FROM %I','opa_production_migrations',current_user); END IF;
END $$;

COMMIT;
