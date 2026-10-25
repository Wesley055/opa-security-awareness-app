-- Release 48 (part 2): SafeWalk Nigeria-first (Issue #54).
-- Additive only. Deliberately does NOT alter "JourneySession", "EmergencyContact"
-- or the existing SafeWalk tables, which may be administrator-owned in production.
-- Destination detail, arrival detection and contact alerts live in new tables.
BEGIN;
CREATE TYPE "SafeWalkDestinationKind" AS ENUM ('PLACE', 'SAVED_PLACE', 'CURRENT_LOCATION', 'DESCRIPTION');
CREATE TYPE "SafeWalkContactConsentStatus" AS ENUM ('PENDING', 'CONSENTED', 'DECLINED', 'REVOKED');

-- One row per SafeWalk journey started by the new app.
CREATE TABLE "SafeWalkPlan" (
  "sessionId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "destinationKind" "SafeWalkDestinationKind" NOT NULL,
  "placeId" VARCHAR(256),
  -- Free text the person typed. Never treated as a verified location.
  "destinationDescription" VARCHAR(160),
  "arrivalRadiusMeters" INTEGER NOT NULL DEFAULT 100,
  -- Arrival detected by the phone. NOT a safety confirmation; nobody is told.
  "arrivalDetectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SafeWalkPlan_pkey" PRIMARY KEY ("sessionId"),
  CONSTRAINT safewalk_plan_radius CHECK ("arrivalRadiusMeters" BETWEEN 30 AND 500)
);
CREATE INDEX "SafeWalkPlan_userId_idx" ON "SafeWalkPlan"("userId");
ALTER TABLE "SafeWalkPlan" ADD CONSTRAINT "SafeWalkPlan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "JourneySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SafeWalkPlan" ADD CONSTRAINT "SafeWalkPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An emergency contact's own agreement to receive SafeWalk texts, given by
-- replying YES from the number that was invited. A changed number voids it.
CREATE TABLE "SafeWalkContactConsent" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "emergencyContactId" UUID NOT NULL,
  "phoneHash" CHAR(64) NOT NULL,
  "status" "SafeWalkContactConsentStatus" NOT NULL DEFAULT 'PENDING',
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inviteCount" INTEGER NOT NULL DEFAULT 1,
  "respondedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafeWalkContactConsent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT safewalk_consent_hash CHECK ("phoneHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "SafeWalkContactConsent_emergencyContactId_key" ON "SafeWalkContactConsent"("emergencyContactId");
CREATE INDEX "SafeWalkContactConsent_phoneHash_status_idx" ON "SafeWalkContactConsent"("phoneHash", "status");
CREATE INDEX "SafeWalkContactConsent_userId_idx" ON "SafeWalkContactConsent"("userId");
ALTER TABLE "SafeWalkContactConsent" ADD CONSTRAINT "SafeWalkContactConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SafeWalkContactConsent" ADD CONSTRAINT "SafeWalkContactConsent_emergencyContactId_fkey" FOREIGN KEY ("emergencyContactId") REFERENCES "EmergencyContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contacts chosen for one journey, and the single overdue text each may get.
CREATE TABLE "SafeWalkContactNotice" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "consentId" UUID NOT NULL,
  -- SELECTED -> QUEUED (overdue) -> SENT | FAILED; CANCELLED when the journey settles first.
  "status" VARCHAR(16) NOT NULL DEFAULT 'SELECTED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "queuedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "providerMessageId" VARCHAR(120),
  "failureCategory" VARCHAR(40),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SafeWalkContactNotice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT safewalk_contact_notice_status CHECK ("status" IN ('SELECTED','QUEUED','SENT','FAILED','CANCELLED'))
);
CREATE UNIQUE INDEX "SafeWalkContactNotice_sessionId_consentId_key" ON "SafeWalkContactNotice"("sessionId", "consentId");
CREATE INDEX "SafeWalkContactNotice_status_nextAttemptAt_idx" ON "SafeWalkContactNotice"("status", "nextAttemptAt");
ALTER TABLE "SafeWalkContactNotice" ADD CONSTRAINT "SafeWalkContactNotice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SafeWalkPlan"("sessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SafeWalkContactNotice" ADD CONSTRAINT "SafeWalkContactNotice_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "SafeWalkContactConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
