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
 PERFORM set_config('opa.revoke_migrator_was_member',pg_has_role(current_user,'opa_production_migrations','MEMBER')::text,true);
 IF NOT pg_has_role(current_user,'opa_production_migrations','MEMBER') THEN EXECUTE format('GRANT %I TO %I','opa_production_migrations',current_user); END IF;
END $$;

REVOKE "opa_production_release_owner" FROM "opa_production_migrations";
REVOKE CREATE ON SCHEMA public FROM "opa_production_migrations";
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public._prisma_migrations FROM "opa_production_migrations";
ALTER DEFAULT PRIVILEGES FOR ROLE "opa_production_migrations" IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "opa_production_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "opa_production_migrations" IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM "opa_production_runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE "opa_production_migrations" IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM "opa_production_runtime";
DO $$ BEGIN
 IF NOT current_setting('opa.revoke_migrator_was_member')::boolean THEN EXECUTE format('REVOKE %I FROM %I','opa_production_migrations',current_user); END IF;
END $$;

COMMIT;
-- Quiesce runner first. Administrator needs pg_signal_backend authority or
-- authority over these sessions, not a superuser migration login.
BEGIN;
DO $$ BEGIN
 PERFORM set_config('opa.transfer_migrator_was_member',pg_has_role(current_user,'opa_production_migrations','MEMBER')::text,true);
 IF NOT pg_has_role(current_user,'opa_production_migrations','MEMBER') THEN EXECUTE format('GRANT %I TO %I','opa_production_migrations',current_user); END IF;
END $$;

DO $$ BEGIN
 PERFORM set_config('opa.transfer_owner_was_member',pg_has_role(current_user,'opa_production_release_owner','MEMBER')::text,true);
 IF NOT pg_has_role(current_user,'opa_production_release_owner','MEMBER') THEN EXECUTE format('GRANT %I TO %I','opa_production_release_owner',current_user); END IF;
END $$;

SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='opa_production_migrations' AND pid<>pg_backend_pid();
DO $$ DECLARE attempt integer; BEGIN
 FOR attempt IN 1..50 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='opa_production_migrations');
  PERFORM pg_sleep(0.1);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='opa_production_migrations') THEN RAISE EXCEPTION 'MIGRATION_SESSIONS_REMAIN'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('opa_production_release_owner','opa_production_migrations','opa_production_runtime')
   AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 THEN RAISE EXCEPTION 'ADMIN_ROLE_ATTRIBUTES'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='opa_production_release_owner' AND NOT rolcanlogin)
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='opa_production_release_owner'))
 THEN RAISE EXCEPTION 'ADMIN_OWNER_ROLE'; END IF;
END $$;

GRANT CREATE ON SCHEMA public TO "opa_production_release_owner";
DO $$ BEGIN IF to_regclass('public."OnboardingAuthorityGrant"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."OnboardingAuthorityGrant"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."OnboardingAuthorityGrant" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."OnboardingAuthorityGrant" TO "opa_production_runtime";
 GRANT REFERENCES ON public."OnboardingAuthorityGrant" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."SupportEmployment"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."SupportEmployment"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."SupportEmployment" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."SupportEmployment" TO "opa_production_runtime";
 GRANT REFERENCES ON public."SupportEmployment" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."SupportCapabilityGrant"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."SupportCapabilityGrant"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."SupportCapabilityGrant" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."SupportCapabilityGrant" TO "opa_production_runtime";
 GRANT REFERENCES ON public."SupportCapabilityGrant" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."Organization"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."Organization"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."Organization" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."Organization" TO "opa_production_runtime";
 GRANT REFERENCES ON public."Organization" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."FacilitySupportAssignment"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."FacilitySupportAssignment"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."FacilitySupportAssignment" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."FacilitySupportAssignment" TO "opa_production_runtime";
 GRANT REFERENCES ON public."FacilitySupportAssignment" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."SupportCase"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."SupportCase"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."SupportCase" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."SupportCase" TO "opa_production_runtime";
 GRANT REFERENCES ON public."SupportCase" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."TemporaryElevation"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."TemporaryElevation"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."TemporaryElevation" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."TemporaryElevation" TO "opa_production_runtime";
 GRANT REFERENCES ON public."TemporaryElevation" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."CommissioningEvidence"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."CommissioningEvidence"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."CommissioningEvidence" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."CommissioningEvidence" TO "opa_production_runtime";
 GRANT REFERENCES ON public."CommissioningEvidence" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."FacilityResponsePolicy"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."FacilityResponsePolicy"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."FacilityResponsePolicy" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."FacilityResponsePolicy" TO "opa_production_runtime";
 GRANT REFERENCES ON public."FacilityResponsePolicy" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."ReportingProjection"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."ReportingProjection"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."ReportingProjection" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."ReportingProjection" TO "opa_production_runtime";
 GRANT REFERENCES ON public."ReportingProjection" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."AfterIncidentReport"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."AfterIncidentReport"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."AfterIncidentReport" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."AfterIncidentReport" TO "opa_production_runtime";
 GRANT REFERENCES ON public."AfterIncidentReport" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."CorrectiveAction"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."CorrectiveAction"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."CorrectiveAction" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."CorrectiveAction" TO "opa_production_runtime";
 GRANT REFERENCES ON public."CorrectiveAction" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."VisitorPass"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."VisitorPass"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."VisitorPass" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."VisitorPass" TO "opa_production_runtime";
 GRANT REFERENCES ON public."VisitorPass" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."GateEvent"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."GateEvent"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."GateEvent" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."GateEvent" TO "opa_production_runtime";
 GRANT REFERENCES ON public."GateEvent" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."DutyShift"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."DutyShift"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."DutyShift" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."DutyShift" TO "opa_production_runtime";
 GRANT REFERENCES ON public."DutyShift" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."DutyReport"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."DutyReport"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."DutyReport" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."DutyReport" TO "opa_production_runtime";
 GRANT REFERENCES ON public."DutyReport" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."StaffRecoveryCode"') IS NOT NULL THEN
 IF (SELECT relowner FROM pg_class WHERE oid=to_regclass('public."StaffRecoveryCode"')) NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('opa_production_migrations','opa_production_release_owner')) THEN RAISE EXCEPTION 'NEW_OBJECT_OWNER'; END IF;
 ALTER TABLE public."StaffRecoveryCode" OWNER TO "opa_production_release_owner";
 GRANT SELECT, INSERT, UPDATE, DELETE ON public."StaffRecoveryCode" TO "opa_production_runtime";
 GRANT REFERENCES ON public."StaffRecoveryCode" TO "opa_production_migrations";
END IF; END $$;
DO $$ BEGIN IF to_regclass('public."SupportCase_sequence_seq"') IS NOT NULL THEN ALTER SEQUENCE public."SupportCase_sequence_seq" OWNER TO "opa_production_release_owner"; GRANT USAGE, SELECT ON SEQUENCE public."SupportCase_sequence_seq" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."OnboardingPermission"') IS NOT NULL THEN ALTER TYPE public."OnboardingPermission" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."OnboardingPermission" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."FacilityMembershipState"') IS NOT NULL THEN ALTER TYPE public."FacilityMembershipState" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."FacilityMembershipState" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."SupportEmploymentState"') IS NOT NULL THEN ALTER TYPE public."SupportEmploymentState" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."SupportEmploymentState" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."SupportCapability"') IS NOT NULL THEN ALTER TYPE public."SupportCapability" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."SupportCapability" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."FacilityOperationalState"') IS NOT NULL THEN ALTER TYPE public."FacilityOperationalState" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."FacilityOperationalState" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."SupportCaseStatus"') IS NOT NULL THEN ALTER TYPE public."SupportCaseStatus" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."SupportCaseStatus" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."CorrectiveActionStatus"') IS NOT NULL THEN ALTER TYPE public."CorrectiveActionStatus" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."CorrectiveActionStatus" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."VisitorPassStatus"') IS NOT NULL THEN ALTER TYPE public."VisitorPassStatus" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."VisitorPassStatus" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."GateEventType"') IS NOT NULL THEN ALTER TYPE public."GateEventType" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."GateEventType" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."StaffPhotoStatus"') IS NOT NULL THEN ALTER TYPE public."StaffPhotoStatus" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."StaffPhotoStatus" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."DutyShiftEnd"') IS NOT NULL THEN ALTER TYPE public."DutyShiftEnd" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."DutyShiftEnd" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regtype('public."DutyReportOrigin"') IS NOT NULL THEN ALTER TYPE public."DutyReportOrigin" OWNER TO "opa_production_release_owner"; GRANT USAGE ON TYPE public."DutyReportOrigin" TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public."duty_report_immutable"()') IS NOT NULL THEN ALTER FUNCTION public."duty_report_immutable"() OWNER TO "opa_production_release_owner"; REVOKE ALL ON FUNCTION public."duty_report_immutable"() FROM PUBLIC, "opa_production_migrations"; GRANT EXECUTE ON FUNCTION public."duty_report_immutable"() TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public."protect_last_facility_admin"()') IS NOT NULL THEN ALTER FUNCTION public."protect_last_facility_admin"() OWNER TO "opa_production_release_owner"; REVOKE ALL ON FUNCTION public."protect_last_facility_admin"() FROM PUBLIC, "opa_production_migrations"; GRANT EXECUTE ON FUNCTION public."protect_last_facility_admin"() TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public."commission_facility_admin"()') IS NOT NULL THEN ALTER FUNCTION public."commission_facility_admin"() OWNER TO "opa_production_release_owner"; REVOKE ALL ON FUNCTION public."commission_facility_admin"() FROM PUBLIC, "opa_production_migrations"; GRANT EXECUTE ON FUNCTION public."commission_facility_admin"() TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public."protect_commissioning_evidence"()') IS NOT NULL THEN ALTER FUNCTION public."protect_commissioning_evidence"() OWNER TO "opa_production_release_owner"; REVOKE ALL ON FUNCTION public."protect_commissioning_evidence"() FROM PUBLIC, "opa_production_migrations"; GRANT EXECUTE ON FUNCTION public."protect_commissioning_evidence"() TO "opa_production_runtime"; END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public."synchronize_facility_operational_state"()') IS NOT NULL THEN ALTER FUNCTION public."synchronize_facility_operational_state"() OWNER TO "opa_production_release_owner"; REVOKE ALL ON FUNCTION public."synchronize_facility_operational_state"() FROM PUBLIC, "opa_production_migrations"; GRANT EXECUTE ON FUNCTION public."synchronize_facility_operational_state"() TO "opa_production_runtime"; END IF; END $$;
REVOKE CREATE ON SCHEMA public FROM "opa_production_release_owner";
DO $$ BEGIN
 IF NOT current_setting('opa.transfer_owner_was_member')::boolean THEN EXECUTE format('REVOKE %I FROM %I','opa_production_release_owner',current_user); END IF;
END $$;

DO $$ BEGIN
 IF NOT current_setting('opa.transfer_migrator_was_member')::boolean THEN EXECUTE format('REVOKE %I FROM %I','opa_production_migrations',current_user); END IF;
END $$;

COMMIT;
-- The independent verify-cleanup command must pass, including no remaining
-- migration-owned objects. Unexpected objects require an incident review.
