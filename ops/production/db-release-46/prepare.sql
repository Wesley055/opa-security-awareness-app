\set ON_ERROR_STOP on
-- Administrator only. Release 46 preparation: transfer ownership of the existing
-- FacilityType enum to the scoped NOLOGIN owner so the migration can add the four
-- sector values (same pattern as the reviewed UserRole transfer). Changes no data.
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
 IF to_regtype('public."FacilityType"') IS NULL THEN RAISE EXCEPTION 'FACILITY_TYPE_MISSING'; END IF;
 -- The owner may only be the administrator itself or already the release owner.
 IF (SELECT typowner FROM pg_type WHERE oid=to_regtype('public."FacilityType"'))
    NOT IN (SELECT oid FROM pg_roles WHERE rolname IN (current_user,'opa_production_release_owner'))
 THEN RAISE EXCEPTION 'FACILITY_TYPE_UNEXPECTED_OWNER'; END IF;
END $$;
DO $$ BEGIN
 PERFORM set_config('opa.prepare46_owner_was_member',pg_has_role(current_user,'opa_production_release_owner','MEMBER')::text,true);
 IF NOT pg_has_role(current_user,'opa_production_release_owner','MEMBER') THEN EXECUTE format('GRANT %I TO %I','opa_production_release_owner',current_user); END IF;
END $$;
-- Required for ownership transfer, revoked before commit.
GRANT USAGE, CREATE ON SCHEMA public TO "opa_production_release_owner";
ALTER TYPE public."FacilityType" OWNER TO "opa_production_release_owner";
GRANT USAGE ON TYPE public."FacilityType" TO "opa_production_runtime";
REVOKE CREATE ON SCHEMA public FROM "opa_production_release_owner";
DO $$ BEGIN
 IF NOT current_setting('opa.prepare46_owner_was_member')::boolean THEN EXECUTE format('REVOKE %I FROM %I','opa_production_release_owner',current_user); END IF;
END $$;
COMMIT;
