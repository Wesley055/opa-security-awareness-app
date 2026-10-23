-- CreateEnum
CREATE TYPE "SafeWalkEscalationState" AS ENUM ('SCHEDULED', 'CHECK_REQUIRED', 'ESCALATED', 'SATISFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SafeWalkNoticeKind" AS ENUM ('OWNER_CHECK', 'GUARDIAN_OVERDUE');

-- CreateTable
CREATE TABLE "SafeWalkGuardianCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedForSessionId" UUID,

    CONSTRAINT "SafeWalkGuardianCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafeWalkGuardianGrant" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "guardianUserId" UUID NOT NULL,
    "facilityScopeId" UUID,
    "policyVersion" VARCHAR(64) NOT NULL DEFAULT 'safewalk-status-v1',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SafeWalkGuardianGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafeWalkEscalation" (
    "sessionId" UUID NOT NULL,
    "state" "SafeWalkEscalationState" NOT NULL DEFAULT 'SCHEDULED',
    "checkDueAt" TIMESTAMP(3) NOT NULL,
    "guardianDueAt" TIMESTAMP(3) NOT NULL,
    "checkRequiredAt" TIMESTAMP(3),
    "responseDueAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "policyVersion" VARCHAR(64) NOT NULL DEFAULT 'safewalk-eta-v1',

    CONSTRAINT "SafeWalkEscalation_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "SafeWalkNotice" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "grantId" UUID,
    "kind" "SafeWalkNoticeKind" NOT NULL,
    "message" VARCHAR(512) NOT NULL,
    "policyVersion" VARCHAR(64) NOT NULL DEFAULT 'safewalk-eta-v1',
    "reasonCode" VARCHAR(64) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "SafeWalkNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafeWalkAudit" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "actorUserId" UUID,
    "grantId" UUID,
    "eventKey" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafeWalkAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SafeWalkGuardianCode_codeHash_key" ON "SafeWalkGuardianCode"("codeHash");

-- CreateIndex
CREATE INDEX "SafeWalkGuardianCode_userId_expiresAt_idx" ON "SafeWalkGuardianCode"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "SafeWalkGuardianGrant_guardianUserId_revokedAt_idx" ON "SafeWalkGuardianGrant"("guardianUserId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafeWalkGuardianGrant_sessionId_guardianUserId_key" ON "SafeWalkGuardianGrant"("sessionId", "guardianUserId");

-- CreateIndex
CREATE INDEX "SafeWalkEscalation_state_checkDueAt_idx" ON "SafeWalkEscalation"("state", "checkDueAt");

-- CreateIndex
CREATE INDEX "SafeWalkEscalation_state_responseDueAt_idx" ON "SafeWalkEscalation"("state", "responseDueAt");

-- CreateIndex
CREATE INDEX "SafeWalkNotice_recipientUserId_availableAt_idx" ON "SafeWalkNotice"("recipientUserId", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafeWalkNotice_sessionId_recipientUserId_kind_key" ON "SafeWalkNotice"("sessionId", "recipientUserId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SafeWalkAudit_eventKey_key" ON "SafeWalkAudit"("eventKey");

-- CreateIndex
CREATE INDEX "SafeWalkAudit_sessionId_occurredAt_idx" ON "SafeWalkAudit"("sessionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "JourneySession_id_userId_key" ON "JourneySession"("id", "userId");

-- AddForeignKey
ALTER TABLE "SafeWalkGuardianCode" ADD CONSTRAINT "SafeWalkGuardianCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeWalkGuardianGrant" ADD CONSTRAINT "SafeWalkGuardianGrant_sessionId_ownerUserId_fkey" FOREIGN KEY ("sessionId", "ownerUserId") REFERENCES "JourneySession"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeWalkGuardianGrant" ADD CONSTRAINT "SafeWalkGuardianGrant_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeWalkEscalation" ADD CONSTRAINT "SafeWalkEscalation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "JourneySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeWalkNotice" ADD CONSTRAINT "SafeWalkNotice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "JourneySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeWalkNotice" ADD CONSTRAINT "SafeWalkNotice_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeWalkNotice" ADD CONSTRAINT "SafeWalkNotice_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "SafeWalkGuardianGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeWalkAudit" ADD CONSTRAINT "SafeWalkAudit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "JourneySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-authored integrity checks supplement the generated additive schema.
ALTER TABLE "SafeWalkGuardianGrant" ADD CONSTRAINT "safewalk_guardian_not_owner" CHECK ("guardianUserId" <> "ownerUserId");
ALTER TABLE "SafeWalkNotice" ADD CONSTRAINT "safewalk_notice_grant_kind" CHECK (
  ("kind" = 'OWNER_CHECK' AND "grantId" IS NULL) OR
  ("kind" = 'GUARDIAN_OVERDUE' AND "grantId" IS NOT NULL)
);
ALTER TABLE "SafeWalkEscalation" ADD CONSTRAINT "safewalk_response_window" CHECK (
  "guardianDueAt" = "checkDueAt" + INTERVAL '3 minutes' AND
  ("responseDueAt" IS NULL OR (
    "checkRequiredAt" IS NOT NULL AND
    "responseDueAt" >= "guardianDueAt" AND
    "responseDueAt" >= "checkRequiredAt" + INTERVAL '3 minutes'
  ))
);

-- Backfill schedules from existing facts only; no historical notice or receipt is fabricated.
INSERT INTO "SafeWalkEscalation" ("sessionId", "state", "checkDueAt", "guardianDueAt", "settledAt")
SELECT "id",
  CASE
    WHEN "status" = 'ENDED' OR "redactedAt" IS NOT NULL THEN 'CLOSED'::"SafeWalkEscalationState"
    WHEN "safetyConfirmedAt" IS NOT NULL OR "arrivalConfirmedAt" IS NOT NULL THEN 'SATISFIED'::"SafeWalkEscalationState"
    ELSE 'SCHEDULED'::"SafeWalkEscalationState"
  END,
  "expectedArrivalAt" + INTERVAL '5 minutes',
  "expectedArrivalAt" + INTERVAL '8 minutes',
  CASE WHEN "status" = 'ENDED' OR "redactedAt" IS NOT NULL OR "safetyConfirmedAt" IS NOT NULL OR "arrivalConfirmedAt" IS NOT NULL
    THEN CURRENT_TIMESTAMP ELSE NULL END
FROM "JourneySession"
WHERE "purpose" = 'SAFEWALK' AND "expectedArrivalAt" IS NOT NULL
ON CONFLICT ("sessionId") DO NOTHING;
