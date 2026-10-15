\set ON_ERROR_STOP on
-- REVIEW CANDIDATE ONLY. No production execution authorized.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'opa-api-production-database' OR current_user IN ('opa_production_migrations','opa_production_runtime')
 OR NOT EXISTS(SELECT 1 FROM opa_deployment.environment_identity WHERE singleton AND environment='production')
 THEN RAISE EXCEPTION 'BOUND_DATABASE_IDENTITY'; END IF;
 IF EXISTS(SELECT 1 FROM pg_db_role_setting d CROSS JOIN LATERAL unnest(d.setconfig) c
 WHERE d.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND d.setrole=(SELECT oid FROM pg_roles WHERE rolname='opa_production_migrations')
 AND split_part(c,'=',1) IN ('lock_timeout','statement_timeout'))
 THEN RAISE EXCEPTION 'EXISTING_SCOPED_TIMEOUT_REQUIRES_REVIEW'; END IF;
END $$;
ALTER ROLE opa_production_migrations IN DATABASE "opa-api-production-database" SET lock_timeout='500ms';
ALTER ROLE opa_production_migrations IN DATABASE "opa-api-production-database" SET statement_timeout='2s';
COMMIT;
