-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ReportingProjection" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "sourceDigest" VARCHAR(64) NOT NULL,
    "generatorVersion" VARCHAR(64) NOT NULL,
    "sourceCutoff" TIMESTAMP(3) NOT NULL,
    "document" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportingProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AfterIncidentReport" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "requestKey" UUID NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "generatorVersion" VARCHAR(64) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" UUID NOT NULL,
    "sourceCutoff" TIMESTAMP(3) NOT NULL,
    "sourceDigest" VARCHAR(64) NOT NULL,
    "supersedesId" UUID,
    "document" JSONB NOT NULL,

    CONSTRAINT "AfterIncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectiveAction" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "airId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "ownerId" UUID NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priority" VARCHAR(16) NOT NULL,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completionEvidenceId" UUID,
    "completedAt" TIMESTAMP(3),
    "verifiedBy" UUID,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "CorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportingProjection_facilityId_updatedAt_idx" ON "ReportingProjection"("facilityId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportingProjection_facilityId_incidentId_key" ON "ReportingProjection"("facilityId", "incidentId");

-- CreateIndex
CREATE INDEX "AfterIncidentReport_facilityId_generatedAt_idx" ON "AfterIncidentReport"("facilityId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AfterIncidentReport_id_facilityId_incidentId_key" ON "AfterIncidentReport"("id", "facilityId", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "AfterIncidentReport_facilityId_incidentId_version_key" ON "AfterIncidentReport"("facilityId", "incidentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AfterIncidentReport_facilityId_incidentId_requestKey_key" ON "AfterIncidentReport"("facilityId", "incidentId", "requestKey");

-- CreateIndex
CREATE INDEX "CorrectiveAction_facilityId_incidentId_idx" ON "CorrectiveAction"("facilityId", "incidentId");

-- CreateIndex
CREATE INDEX "CorrectiveAction_facilityId_status_dueAt_idx" ON "CorrectiveAction"("facilityId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectiveAction_facilityId_requestKey_key" ON "CorrectiveAction"("facilityId", "requestKey");

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_airId_facilityId_incidentId_fkey" FOREIGN KEY ("airId", "facilityId", "incidentId") REFERENCES "AfterIncidentReport"("id", "facilityId", "incidentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Local reporting integrity checks. No operational table is changed.
ALTER TABLE "AfterIncidentReport" ADD CONSTRAINT "air_positive_versions" CHECK ("version" > 0 AND "schemaVersion" > 0);
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "corrective_positive_version" CHECK ("version" > 0);
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "corrective_priority" CHECK ("priority" IN ('LOW','MEDIUM','HIGH','URGENT'));
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "corrective_completion" CHECK (
  "status" NOT IN ('COMPLETED','VERIFIED') OR ("completionEvidenceId" IS NOT NULL AND "completedAt" IS NOT NULL)
);
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "corrective_independent_verification" CHECK (
  "status" <> 'VERIFIED' OR ("verifiedBy" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "verifiedBy" <> "ownerId")
);
