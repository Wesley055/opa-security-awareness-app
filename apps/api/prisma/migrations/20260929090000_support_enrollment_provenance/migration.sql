BEGIN;
-- Preserve ordinary public/tenant enrollment provenance; permit only the already
-- supported ADMIN-invited, facility-less Technical Support enrollment shape.
ALTER TABLE "EnrollmentRequest" DROP CONSTRAINT "EnrollmentRequest_provenance_check";
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_provenance_check" CHECK (
  ("requestedRole" = 'TECHNICAL_SUPPORT' AND "facilityId" IS NULL AND "invitedByUserId" IS NOT NULL)
  OR
  ("requestedRole" <> 'TECHNICAL_SUPPORT' AND (("facilityId" IS NULL) = ("invitedByUserId" IS NULL)))
);
COMMIT;
