BEGIN;
CREATE TYPE "FacilityMembershipState" AS ENUM ('ACTIVE','SUSPENDED','REVOKED');
CREATE TYPE "SupportEmploymentState" AS ENUM ('ACTIVE','SUSPENDED','ENDED');
CREATE TYPE "SupportCapability" AS ENUM ('FACILITY_READ','STAFF_READ','STAFF_PROVISION','STAFF_SUSPEND','STAFF_RECOVER_ACCESS','OPERATOR_MANAGE','ENROLLMENT_DIAGNOSTICS','ENROLLMENT_RETRY','DELIVERY_DIAGNOSTICS','COMMAND_CENTER_DIAGNOSTICS','INCIDENT_SUPPORT_READ','INCIDENT_RESOLVE','AUDIT_READ','SERVICE_HEALTH_READ','PII_RESOLVE','RESIDENT_SUPPORT_OVERRIDE','FACILITY_ADMIN_DEPROVISION');
ALTER TABLE "User" ADD COLUMN "membershipState" "FacilityMembershipState" NOT NULL DEFAULT 'ACTIVE';
UPDATE "User" SET "membershipState"='SUSPENDED' WHERE "facilityId" IS NOT NULL AND NOT "isActive";
ALTER TABLE "User" ADD CONSTRAINT support_no_tenant CHECK (role <> 'TECHNICAL_SUPPORT' OR "facilityId" IS NULL);
ALTER TABLE "Facility" ADD COLUMN "commissionedAt" TIMESTAMP(3);
UPDATE "Facility" f SET "commissionedAt"=CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "User" u WHERE u."facilityId"=f.id AND u.role='FACILITY_ADMIN' AND u."isActive" AND u."accountStatus"='ACTIVE' AND u."membershipState"='ACTIVE');
CREATE TABLE "SupportEmployment" (
 "userId" UUID PRIMARY KEY REFERENCES "User"(id) ON DELETE RESTRICT,
 state "SupportEmploymentState" NOT NULL DEFAULT 'ACTIVE',
 "appointedByUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT support_employment_no_self CHECK ("userId" <> "appointedByUserId")
);
CREATE TABLE "SupportCapabilityGrant" (
 id UUID PRIMARY KEY,
 "actorUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "approvedByUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "facilityId" UUID REFERENCES "Facility"(id) ON DELETE RESTRICT,
 capability "SupportCapability" NOT NULL,
 "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
 reason VARCHAR(500) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT support_grant_no_self CHECK ("actorUserId" <> "approvedByUserId"),
 CONSTRAINT support_grant_reason CHECK (length(trim(reason)) > 0),
 CONSTRAINT support_grant_scope CHECK ((capability IN ('FACILITY_READ','SERVICE_HEALTH_READ') AND "facilityId" IS NULL) OR (capability NOT IN ('FACILITY_READ','SERVICE_HEALTH_READ') AND "facilityId" IS NOT NULL)),
 CONSTRAINT support_grant_expiry CHECK ("expiresAt" IS NULL OR "expiresAt">"createdAt"),
 CONSTRAINT support_sensitive_expiry CHECK (capability NOT IN ('INCIDENT_RESOLVE','PII_RESOLVE','RESIDENT_SUPPORT_OVERRIDE','FACILITY_ADMIN_DEPROVISION','STAFF_RECOVER_ACCESS') OR "expiresAt" IS NOT NULL),
 CONSTRAINT support_grant_revocation CHECK ("revokedAt" IS NULL OR "revokedAt">="createdAt")
);
CREATE INDEX "SupportCapabilityGrant_actorUserId_capability_facilityId_revok_idx" ON "SupportCapabilityGrant"("actorUserId",capability,"facilityId","revokedAt","expiresAt");
ALTER TABLE "AdministrativeAuditEvent" ADD COLUMN "authorityKind" TEXT, ADD COLUMN "authorityGrantId" UUID, ADD COLUMN "caseReference" UUID, ADD COLUMN "correlationId" UUID;
ALTER TABLE "EnrollmentRequest" DROP CONSTRAINT "EnrollmentRequest_institutional_role_check";
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_institutional_role_check" CHECK ("requestedRole"='USER' OR ("requestedRole" IN ('FACILITY_ADMIN','FACILITY_OPERATOR') AND "facilityId" IS NOT NULL AND "invitedByUserId" IS NOT NULL) OR ("requestedRole"='TECHNICAL_SUPPORT' AND "facilityId" IS NULL AND "invitedByUserId" IS NOT NULL));
-- All writers, including older administrative paths, must serialize loss of an admin.
CREATE FUNCTION protect_last_facility_admin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "Facility"; remaining INTEGER;
BEGIN
 IF OLD.role='FACILITY_ADMIN' AND OLD."facilityId" IS NOT NULL AND OLD."isActive" AND OLD."accountStatus"='ACTIVE' AND OLD."membershipState"='ACTIVE' THEN
  IF TG_OP='DELETE' OR NEW.role <> OLD.role OR NEW."facilityId" IS DISTINCT FROM OLD."facilityId" OR NOT NEW."isActive" OR NEW."accountStatus"<>'ACTIVE' OR NEW."membershipState"<>'ACTIVE' THEN
   SELECT * INTO f FROM "Facility" WHERE id=OLD."facilityId" FOR UPDATE;
   IF f."isActive" AND f."commissionedAt" IS NOT NULL THEN
    SELECT count(*) INTO remaining FROM "User" WHERE "facilityId"=f.id AND id<>OLD.id AND role='FACILITY_ADMIN' AND "isActive" AND "accountStatus"='ACTIVE' AND "membershipState"='ACTIVE';
    IF remaining=0 THEN RAISE EXCEPTION 'LAST_ACTIVE_FACILITY_ADMIN' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_last_facility_admin BEFORE UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION protect_last_facility_admin();
CREATE FUNCTION commission_facility_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.role='FACILITY_ADMIN' AND NEW."facilityId" IS NOT NULL AND NEW."isActive" AND NEW."accountStatus"='ACTIVE' AND NEW."membershipState"='ACTIVE' THEN
  UPDATE "Facility" SET "commissionedAt"=COALESCE("commissionedAt",CURRENT_TIMESTAMP) WHERE id=NEW."facilityId";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER commission_facility_admin AFTER INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION commission_facility_admin();
COMMIT;
