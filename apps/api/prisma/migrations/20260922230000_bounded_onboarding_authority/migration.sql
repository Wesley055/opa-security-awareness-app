CREATE TYPE "OnboardingPermission" AS ENUM ('STAFF_ONBOARDING');
CREATE TABLE "OnboardingAuthorityGrant" (
  "id" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "permission" "OnboardingPermission" NOT NULL DEFAULT 'STAFF_ONBOARDING',
  "approvedByUserId" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardingAuthorityGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_expiration_after_creation" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "onboarding_revocation_after_creation" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt"),
  CONSTRAINT "onboarding_no_self_grant" CHECK ("actorUserId" <> "approvedByUserId"),
  CONSTRAINT "OnboardingAuthorityGrant_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OnboardingAuthorityGrant_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OnboardingAuthorityGrant_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "onboarding_actor_scope_idx" ON "OnboardingAuthorityGrant"("actorUserId", "facilityId", "permission", "revokedAt", "expiresAt");
CREATE INDEX "OnboardingAuthorityGrant_facilityId_idx" ON "OnboardingAuthorityGrant"("facilityId");
CREATE INDEX "OnboardingAuthorityGrant_approvedByUserId_idx" ON "OnboardingAuthorityGrant"("approvedByUserId");
