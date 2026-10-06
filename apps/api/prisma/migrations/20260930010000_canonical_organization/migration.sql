BEGIN;
-- CreateEnum
CREATE TYPE "FacilityOperationalState" AS ENUM ('CREATED', 'COMMISSIONING', 'OPERATIONAL', 'SUSPENDED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "operationalState" "FacilityOperationalState" NOT NULL DEFAULT 'CREATED',
ADD COLUMN     "organizationId" UUID;

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilitySupportAssignment" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "assignedByUserId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "FacilitySupportAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" UUID NOT NULL,
    "sequence" SERIAL NOT NULL,
    "facilityId" UUID NOT NULL,
    "reportedByUserId" UUID NOT NULL,
    "assignedToUserId" UUID NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "priority" VARCHAR(16) NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporaryElevation" (
    "id" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "supportCaseId" UUID NOT NULL,
    "capability" "SupportCapability" NOT NULL,
    "approvedByUserId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemporaryElevation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissioningEvidence" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "supportCaseId" UUID NOT NULL,
    "recordedByUserId" UUID NOT NULL,
    "facilityAdminUserId" UUID,
    "gate" VARCHAR(80) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "evidence" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissioningEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacilitySupportAssignment_actorUserId_facilityId_revokedAt_idx" ON "FacilitySupportAssignment"("actorUserId", "facilityId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCase_sequence_key" ON "SupportCase"("sequence");

-- CreateIndex
CREATE INDEX "SupportCase_facilityId_status_createdAt_idx" ON "SupportCase"("facilityId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCase_assignedToUserId_status_idx" ON "SupportCase"("assignedToUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCase_id_facilityId_key" ON "SupportCase"("id", "facilityId");

-- CreateIndex
CREATE INDEX "TemporaryElevation_actorUserId_facilityId_capability_revoke_idx" ON "TemporaryElevation"("actorUserId", "facilityId", "capability", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "TemporaryElevation_supportCaseId_facilityId_idx" ON "TemporaryElevation"("supportCaseId", "facilityId");

-- CreateIndex
CREATE INDEX "CommissioningEvidence_facilityId_gate_createdAt_idx" ON "CommissioningEvidence"("facilityId", "gate", "createdAt");

-- CreateIndex
CREATE INDEX "CommissioningEvidence_supportCaseId_facilityId_idx" ON "CommissioningEvidence"("supportCaseId", "facilityId");

-- CreateIndex
CREATE INDEX "Facility_organizationId_idx" ON "Facility"("organizationId");

-- CreateIndex
CREATE INDEX "Facility_operationalState_idx" ON "Facility"("operationalState");

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySupportAssignment" ADD CONSTRAINT "FacilitySupportAssignment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySupportAssignment" ADD CONSTRAINT "FacilitySupportAssignment_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySupportAssignment" ADD CONSTRAINT "FacilitySupportAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryElevation" ADD CONSTRAINT "TemporaryElevation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryElevation" ADD CONSTRAINT "TemporaryElevation_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryElevation" ADD CONSTRAINT "TemporaryElevation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryElevation" ADD CONSTRAINT "TemporaryElevation_supportCaseId_facilityId_fkey" FOREIGN KEY ("supportCaseId", "facilityId") REFERENCES "SupportCase"("id", "facilityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissioningEvidence" ADD CONSTRAINT "CommissioningEvidence_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissioningEvidence" ADD CONSTRAINT "CommissioningEvidence_supportCaseId_facilityId_fkey" FOREIGN KEY ("supportCaseId", "facilityId") REFERENCES "SupportCase"("id", "facilityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissioningEvidence" ADD CONSTRAINT "CommissioningEvidence_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissioningEvidence" ADD CONSTRAINT "CommissioningEvidence_facilityAdminUserId_fkey" FOREIGN KEY ("facilityAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Historical authority is retained, never auto-converted to assignments.
-- Existing facilities require explicit association and commissioning evidence.
UPDATE "Facility" SET "operationalState"='SUSPENDED' WHERE NOT "isActive";
CREATE UNIQUE INDEX "FacilitySupportAssignment_active_owner" ON "FacilitySupportAssignment"("facilityId") WHERE "revokedAt" IS NULL;
ALTER TABLE "FacilitySupportAssignment"
 ADD CONSTRAINT assignment_no_self CHECK ("actorUserId" <> "assignedByUserId"),
 ADD CONSTRAINT assignment_reason CHECK (length(trim(reason)) > 0),
 ADD CONSTRAINT assignment_revocation CHECK ("revokedAt" IS NULL OR "revokedAt">="createdAt");
ALTER TABLE "SupportCase"
 ADD CONSTRAINT support_case_priority CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
 ADD CONSTRAINT support_case_text CHECK (length(trim(category))>0 AND length(trim(summary))>0);
ALTER TABLE "TemporaryElevation"
 ADD CONSTRAINT elevation_no_self CHECK ("actorUserId"<>"approvedByUserId"),
 ADD CONSTRAINT elevation_reason CHECK (length(trim(reason))>0),
 ADD CONSTRAINT elevation_interval CHECK ("expiresAt">"startsAt" AND "expiresAt">"createdAt"),
 ADD CONSTRAINT elevation_revocation CHECK ("revokedAt" IS NULL OR "revokedAt">="createdAt");
ALTER TABLE "CommissioningEvidence"
 ADD CONSTRAINT commissioning_evidence_nonempty CHECK (length(trim(evidence))>0),
 ADD CONSTRAINT commissioning_gate CHECK (gate IN ('CONFIGURATION','SMS','EMAIL','FACILITY_ADMIN','COMMAND_CENTER','OPERATOR','RESIDENT','PHYSICAL_SOS','TRAINING_WORKSPACE','TRAINING_OPERATOR_MANAGEMENT','TRAINING_RESIDENT_ONBOARDING','TRAINING_INCIDENT_LIFECYCLE','TRAINING_OPERATOR_OVERSIGHT','TRAINING_ESCALATION','TRAINING_SUPPORT','TRAINING_PHYSICAL_ACCEPTANCE'));
CREATE FUNCTION protect_commissioning_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'COMMISSIONING_EVIDENCE_APPEND_ONLY' USING ERRCODE='23514'; END $$;
CREATE TRIGGER protect_commissioning_evidence BEFORE UPDATE OR DELETE ON "CommissioningEvidence" FOR EACH ROW EXECUTE FUNCTION protect_commissioning_evidence();

COMMIT;
