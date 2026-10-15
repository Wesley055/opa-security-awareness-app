\set ON_ERROR_STOP on
-- Restore only the two previously absent overrides; preserve every other setting.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'opa-api-production-database' OR current_user IN ('opa_production_migrations','opa_production_runtime')
 THEN RAISE EXCEPTION 'BOUND_DATABASE_IDENTITY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_db_role_setting WHERE
 setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND setrole=(SELECT oid FROM pg_roles WHERE rolname='opa_production_migrations')
 AND setconfig @> ARRAY['lock_timeout=500ms','statement_timeout=2s'])
 THEN RAISE EXCEPTION 'TIMEOUT_SETTINGS_DRIFT'; END IF;
END $$;
ALTER ROLE opa_production_migrations IN DATABASE "opa-api-production-database" RESET lock_timeout;
ALTER ROLE opa_production_migrations IN DATABASE "opa-api-production-database" RESET statement_timeout;
COMMIT;
