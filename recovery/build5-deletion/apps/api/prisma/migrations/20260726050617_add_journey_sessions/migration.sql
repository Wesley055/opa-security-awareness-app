-- CreateEnum
CREATE TYPE "JourneyPurpose" AS ENUM ('INCIDENT', 'SAFEWALK', 'GUARDIAN', 'MANUAL', 'SYSTEM_TEST');

-- CreateEnum
CREATE TYPE "JourneySessionStatus" AS ENUM ('STARTED', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "JourneySessionEndReason" AS ENUM ('USER_ENDED', 'INCIDENT_RESOLVED', 'TIMED_OUT', 'SUPERSEDED', 'ADMIN_ENDED');

-- CreateEnum
CREATE TYPE "JourneyRedactionReason" AS ENUM ('RETENTION_POLICY', 'SUBJECT_REQUEST', 'LEGAL_HOLD_RELEASE');

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "journeySessionId" UUID;

-- CreateTable
CREATE TABLE "JourneySession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "JourneyPurpose" NOT NULL,
    "status" "JourneySessionStatus" NOT NULL DEFAULT 'STARTED',
    "endedAt" TIMESTAMP(3),
    "endedReason" "JourneySessionEndReason",
    "lastFixReceivedAt" TIMESTAMP(3),
    "deviceId" VARCHAR(128),
    "redactedAt" TIMESTAMP(3),
    "redactionReason" "JourneyRedactionReason",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyLocationFix" (
    "id" UUID NOT NULL,
    "journeySessionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "batteryLevel" INTEGER,
    "isCharging" BOOLEAN,
    "source" VARCHAR(32) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nonce" VARCHAR(64),
    "payloadHash" VARCHAR(64) NOT NULL,
    "previousHash" VARCHAR(64),
    "hash" VARCHAR(64) NOT NULL,
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "JourneyLocationFix_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JourneySession_userId_status_startedAt_idx" ON "JourneySession"("userId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "JourneySession_status_lastFixReceivedAt_idx" ON "JourneySession"("status", "lastFixReceivedAt");

-- CreateIndex
CREATE INDEX "JourneyLocationFix_journeySessionId_receivedAt_idx" ON "JourneyLocationFix"("journeySessionId", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "JourneyLocationFix_journeySessionId_recordedAt_idx" ON "JourneyLocationFix"("journeySessionId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyLocationFix_journeySessionId_sequence_key" ON "JourneyLocationFix"("journeySessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyLocationFix_journeySessionId_idempotencyKey_key" ON "JourneyLocationFix"("journeySessionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Incident_journeySessionId_idx" ON "Incident"("journeySessionId");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_journeySessionId_fkey" FOREIGN KEY ("journeySessionId") REFERENCES "JourneySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneySession" ADD CONSTRAINT "JourneySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyLocationFix" ADD CONSTRAINT "JourneyLocationFix_journeySessionId_fkey" FOREIGN KEY ("journeySessionId") REFERENCES "JourneySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active JourneySession per user. Prisma cannot express a partial
-- unique index, so this is hand-added. See ADR-009.
CREATE UNIQUE INDEX "journey_session_one_active_per_user"
  ON "JourneySession" ("userId")
  WHERE "status" IN ('STARTED', 'ACTIVE');
