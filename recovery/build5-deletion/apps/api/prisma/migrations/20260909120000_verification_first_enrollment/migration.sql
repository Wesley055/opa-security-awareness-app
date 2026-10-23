-- Additive cutover: existing users, credentials and legacy queued invitations are retained.
CREATE TABLE "EnrollmentRequest" (
  "id" UUID NOT NULL,
  "facilityId" UUID,
  "invitedByUserId" UUID,
  "identityCiphertext" TEXT NOT NULL,
  "idempotencyDigest" VARCHAR(64) NOT NULL,
  "emailTokenHash" VARCHAR(64),
  "phoneTokenHash" VARCHAR(64),
  "acceptanceTokenHash" VARCHAR(64),
  "proofAttempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "acceptedUserId" UUID,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnrollmentRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnrollmentRequest_provenance_check" CHECK (("facilityId" IS NULL) = ("invitedByUserId" IS NULL)),
  CONSTRAINT "EnrollmentRequest_acceptance_check" CHECK (("acceptedAt" IS NULL) = ("acceptedUserId" IS NULL) AND ("acceptedAt" IS NULL OR "verifiedAt" IS NOT NULL)),
  CONSTRAINT "EnrollmentRequest_attempts_check" CHECK ("proofAttempts" BETWEEN 0 AND 5)
);
CREATE UNIQUE INDEX "EnrollmentRequest_idempotencyDigest_key" ON "EnrollmentRequest"("idempotencyDigest");
CREATE INDEX "EnrollmentRequest_facilityId_createdAt_idx" ON "EnrollmentRequest"("facilityId", "createdAt");
CREATE INDEX "EnrollmentRequest_expiresAt_idx" ON "EnrollmentRequest"("expiresAt");
ALTER TABLE "AccountInvitationDelivery"
  ALTER COLUMN "userId" DROP NOT NULL,
  ALTER COLUMN "facilityId" DROP NOT NULL,
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'LEGACY_INVITATION',
  ADD COLUMN "enrollmentId" UUID,
  ADD COLUMN "requestCiphertext" TEXT,
  ADD CONSTRAINT "AccountInvitationDelivery_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "EnrollmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountInvitationDelivery_purpose_check" CHECK (
    ("purpose" = 'LEGACY_INVITATION' AND "userId" IS NOT NULL AND "facilityId" IS NOT NULL AND "enrollmentId" IS NULL AND "requestCiphertext" IS NULL)
    OR ("purpose" = 'ENROLLMENT' AND "userId" IS NULL AND "facilityId" IS NULL AND "enrollmentId" IS NOT NULL AND "requestCiphertext" IS NULL AND "recipient" = '' AND "channel" IN ('EMAIL', 'SMS'))
    OR ("purpose" = 'PASSWORD_RESET' AND "userId" IS NULL AND "facilityId" IS NULL AND "enrollmentId" IS NULL AND "requestCiphertext" IS NOT NULL AND "recipient" = '' AND "channel" = 'EMAIL')
  );
CREATE UNIQUE INDEX "AccountInvitationDelivery_enrollmentId_channel_key" ON "AccountInvitationDelivery"("enrollmentId", "channel");
