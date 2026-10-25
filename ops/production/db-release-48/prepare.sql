\set ON_ERROR_STOP on
-- Administrator only. Release 48 preparation. Changes no data.
-- Migration 48 creates tables with foreign keys to the baseline "Incident",
-- "JourneySession" and "EmergencyContact" tables, and adds one column to
-- "User". A foreign key needs REFERENCES on the referenced table; adding a
-- column needs ownership. This grants REFERENCES on those three tables to the
-- scoped NOLOGIN release owner (the migrator inherits it only while
-- activated), and refuses if "User" is not already owned by the release owner
-- (release 46 added columns to it).
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
 IF to_regclass('public."Incident"') IS NULL OR to_regclass('public."User"') IS NULL
 OR to_regclass('public."JourneySession"') IS NULL OR to_regclass('public."EmergencyContact"') IS NULL THEN RAISE EXCEPTION 'BASELINE_TABLE_MISSING'; END IF;
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."User"')) <> (SELECT oid FROM pg_roles WHERE rolname='opa_production_release_owner')
 THEN RAISE EXCEPTION 'USER_TABLE_UNEXPECTED_OWNER'; END IF;
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."Incident"'))
    NOT IN (SELECT oid FROM pg_roles WHERE rolname IN (current_user,'opa_production_release_owner'))
 THEN RAISE EXCEPTION 'INCIDENT_TABLE_UNEXPECTED_OWNER'; END IF;
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."JourneySession"'))
    NOT IN (SELECT oid FROM pg_roles WHERE rolname IN (current_user,'opa_production_release_owner'))
 THEN RAISE EXCEPTION 'JOURNEY_TABLE_UNEXPECTED_OWNER'; END IF;
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."EmergencyContact"'))
    NOT IN (SELECT oid FROM pg_roles WHERE rolname IN (current_user,'opa_production_release_owner'))
 THEN RAISE EXCEPTION 'CONTACT_TABLE_UNEXPECTED_OWNER'; END IF;
END $$;
-- Idempotent; a no-op where the release owner already owns the table.
GRANT REFERENCES ON public."Incident" TO "opa_production_release_owner";
GRANT REFERENCES ON public."JourneySession" TO "opa_production_release_owner";
GRANT REFERENCES ON public."EmergencyContact" TO "opa_production_release_owner";
COMMIT;
