-- Release 48: emergency delivery (offline SOS reconciliation, SMS fallback, USSD).
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
COMMIT;
