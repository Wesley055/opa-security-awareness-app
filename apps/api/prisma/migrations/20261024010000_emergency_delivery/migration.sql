-- Release 48: emergency delivery (offline SOS reconciliation, SMS fallback, USSD)
-- and SafeWalk Nigeria-first. One migration, one transaction: all or nothing.
-- Additive only. Deliberately does NOT alter "Incident": the baseline table is
-- administrator-owned in production. Press time, channel and verification live in
-- "EmergencyActivation"; the Command Center also reads them from Incident.metadata.
BEGIN;
CREATE TYPE "IncidentChannel" AS ENUM ('APP', 'SMS', 'USSD');
CREATE TYPE "DeliveryVerification" AS ENUM ('APP_SIGNED_IN', 'SMS_SIGNED', 'SMS_NUMBER_ONLY', 'USSD_NUMBER');

ALTER TABLE "User" ADD COLUMN "preferredLanguage" VARCHAR(8);
ALTER TABLE "User" ADD CONSTRAINT user_preferred_language CHECK ("preferredLanguage" IS NULL OR "preferredLanguage" IN ('en','ha','pcm','yo','ig'));

CREATE TABLE "EmergencyActivation" (
  "id" UUID NOT NULL,
  "activationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  "firstChannel" "IncidentChannel" NOT NULL,
  "channels" "IncidentChannel"[] NOT NULL,
  "verification" "DeliveryVerification" NOT NULL,
  "pressedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmergencyActivation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT emergency_activation_channels CHECK (cardinality("channels") BETWEEN 1 AND 3 AND "firstChannel" = ANY("channels"))
);
CREATE UNIQUE INDEX "EmergencyActivation_activationId_key" ON "EmergencyActivation"("activationId");
CREATE INDEX "EmergencyActivation_incidentId_idx" ON "EmergencyActivation"("incidentId");
CREATE INDEX "EmergencyActivation_userId_receivedAt_idx" ON "EmergencyActivation"("userId", "receivedAt" DESC);
ALTER TABLE "EmergencyActivation" ADD CONSTRAINT "EmergencyActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyActivation" ADD CONSTRAINT "EmergencyActivation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SavedPlace" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "label" VARCHAR(24) NOT NULL,
  "description" VARCHAR(160),
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedPlace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT saved_place_position CHECK ("position" BETWEEN 1 AND 4),
  CONSTRAINT saved_place_pin CHECK (("latitude" IS NULL) = ("longitude" IS NULL))
);
CREATE UNIQUE INDEX "SavedPlace_userId_position_key" ON "SavedPlace"("userId", "position");
ALTER TABLE "SavedPlace" ADD CONSTRAINT "SavedPlace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeviceSmsKey" (
  "id" UUID NOT NULL,
  "keyId" VARCHAR(12) NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceSmsKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT device_sms_key_id CHECK ("keyId" ~ '^[A-Z2-7]{8}$')
);
CREATE UNIQUE INDEX "DeviceSmsKey_keyId_key" ON "DeviceSmsKey"("keyId");
CREATE INDEX "DeviceSmsKey_userId_idx" ON "DeviceSmsKey"("userId");
ALTER TABLE "DeviceSmsKey" ADD CONSTRAINT "DeviceSmsKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InboundMessage" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(24) NOT NULL,
  "providerMessageId" VARCHAR(120) NOT NULL,
  "msisdnHash" CHAR(64) NOT NULL,
  "outcome" VARCHAR(40) NOT NULL,
  "userId" UUID,
  "incidentId" UUID,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT inbound_message_hash CHECK ("msisdnHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "InboundMessage_provider_providerMessageId_key" ON "InboundMessage"("provider", "providerMessageId");
CREATE INDEX "InboundMessage_msisdnHash_receivedAt_idx" ON "InboundMessage"("msisdnHash", "receivedAt" DESC);

CREATE TABLE "UssdSession" (
  "id" UUID NOT NULL,
  "sessionId" VARCHAR(120) NOT NULL,
  "msisdnHash" CHAR(64) NOT NULL,
  "userId" UUID,
  "incidentId" UUID,
  "step" VARCHAR(24) NOT NULL,
  "language" VARCHAR(8),
  "outcome" VARCHAR(40),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UssdSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT ussd_session_hash CHECK ("msisdnHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "UssdSession_sessionId_key" ON "UssdSession"("sessionId");
CREATE INDEX "UssdSession_msisdnHash_createdAt_idx" ON "UssdSession"("msisdnHash", "createdAt" DESC);

-- Part 2: SafeWalk Nigeria-first (Issue #54), in the same transaction.
-- Additive only. Deliberately does NOT alter "JourneySession", "EmergencyContact"
-- or the existing SafeWalk tables, which may be administrator-owned in production.
-- Destination detail, arrival detection and contact alerts live in new tables.
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

-- Part 3: emergency assurance. Who among the emergency contacts confirmed seeing
-- an SOS, reminders and calls when nobody has, and the separate escalation to
-- Facility Admins when security has not acknowledged. Never delays the alert.
CREATE TABLE "IncidentContactAssurance" (
  "id" UUID NOT NULL,
  "incidentId" UUID NOT NULL,
  -- Set null if the contact is later deleted; the evidence stays.
  "emergencyContactId" UUID,
  "phoneHash" CHAR(64) NOT NULL,
  -- Snapshot for the duty officer ("Sister"); never the contact's name or number.
  "relationship" VARCHAR(40) NOT NULL,
  "askSentAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "confirmedVia" VARCHAR(16),
  "reminderSentAt" TIMESTAMP(3),
  "voiceCallAt" TIMESTAMP(3),
  "voiceOutcome" VARCHAR(40),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncidentContactAssurance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT incident_contact_assurance_hash CHECK ("phoneHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT incident_contact_assurance_via CHECK ("confirmedVia" IS NULL OR "confirmedVia" IN ('SMS_REPLY','VOICE_KEYPRESS'))
);
CREATE UNIQUE INDEX "IncidentContactAssurance_incidentId_emergencyContactId_key" ON "IncidentContactAssurance"("incidentId", "emergencyContactId");
CREATE INDEX "IncidentContactAssurance_phoneHash_createdAt_idx" ON "IncidentContactAssurance"("phoneHash", "createdAt" DESC);
CREATE INDEX "IncidentContactAssurance_closedAt_createdAt_idx" ON "IncidentContactAssurance"("closedAt", "createdAt");
ALTER TABLE "IncidentContactAssurance" ADD CONSTRAINT "IncidentContactAssurance_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentContactAssurance" ADD CONSTRAINT "IncidentContactAssurance_emergencyContactId_fkey" FOREIGN KEY ("emergencyContactId") REFERENCES "EmergencyContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "IncidentSecurityEscalation" (
  "incidentId" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recipients" INTEGER NOT NULL,
  "sent" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "IncidentSecurityEscalation_pkey" PRIMARY KEY ("incidentId")
);
ALTER TABLE "IncidentSecurityEscalation" ADD CONSTRAINT "IncidentSecurityEscalation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
