ALTER TABLE "EnrollmentRequest"
  ADD COLUMN "requestedRole" "UserRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "lastResentAt" TIMESTAMP(3);
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_institutional_role_check"
  CHECK ("requestedRole" = 'USER' OR ("requestedRole" IN ('FACILITY_ADMIN', 'FACILITY_OPERATOR') AND "facilityId" IS NOT NULL AND "invitedByUserId" IS NOT NULL));
ALTER TABLE "AdministrativeAuditEvent"
  ADD COLUMN "reason" VARCHAR(500),
  ADD COLUMN "beforeState" JSONB,
  ADD COLUMN "afterState" JSONB;
