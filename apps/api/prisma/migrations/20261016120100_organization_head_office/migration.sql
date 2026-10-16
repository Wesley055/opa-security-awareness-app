BEGIN;
-- Head Office (ORGANIZATION_ADMIN) scope and branch regions. Additive only:
-- nullable columns, small indexes and constraints validated against tiny tables.
ALTER TABLE "User" ADD COLUMN "organizationId" UUID;
ALTER TABLE "EnrollmentRequest" ADD COLUMN "organizationId" UUID;
ALTER TABLE "Facility" ADD COLUMN "region" VARCHAR(80);

CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
CREATE INDEX "Facility_organizationId_region_idx" ON "Facility"("organizationId", "region");

ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An organization administrator always belongs to exactly one organization and
-- never to a facility; no other role carries an organization.
ALTER TABLE "User" ADD CONSTRAINT organization_admin_scope CHECK (
  (role = 'ORGANIZATION_ADMIN') = ("organizationId" IS NOT NULL)
  AND (role <> 'ORGANIZATION_ADMIN' OR "facilityId" IS NULL)
);
ALTER TABLE "Facility" ADD CONSTRAINT facility_region_text CHECK (
  region IS NULL OR length(trim(region)) > 0
);

ALTER TABLE "EnrollmentRequest" DROP CONSTRAINT "EnrollmentRequest_institutional_role_check";
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_institutional_role_check" CHECK (
  "requestedRole" = 'USER'
  OR ("requestedRole" IN ('FACILITY_ADMIN','FACILITY_OPERATOR') AND "facilityId" IS NOT NULL AND "invitedByUserId" IS NOT NULL)
  OR ("requestedRole" = 'TECHNICAL_SUPPORT' AND "facilityId" IS NULL AND "invitedByUserId" IS NOT NULL)
  OR ("requestedRole" = 'ORGANIZATION_ADMIN' AND "facilityId" IS NULL AND "invitedByUserId" IS NOT NULL AND "organizationId" IS NOT NULL)
);
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_organization_scope_check" CHECK (
  "organizationId" IS NULL OR "requestedRole" = 'ORGANIZATION_ADMIN'
);
ALTER TABLE "EnrollmentRequest" DROP CONSTRAINT "EnrollmentRequest_provenance_check";
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_provenance_check" CHECK (
  ("requestedRole" IN ('TECHNICAL_SUPPORT','ORGANIZATION_ADMIN') AND "facilityId" IS NULL AND "invitedByUserId" IS NOT NULL)
  OR
  ("requestedRole" NOT IN ('TECHNICAL_SUPPORT','ORGANIZATION_ADMIN') AND (("facilityId" IS NULL) = ("invitedByUserId" IS NULL)))
);
COMMIT;
