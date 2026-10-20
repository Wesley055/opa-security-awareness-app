-- OPA Duty Reports + staff profile photos + sector facility types.
-- Additive only: new enum values, nullable User columns, two new tables, three new enums.
-- Enum values are added outside the transaction block (ALTER TYPE ... ADD VALUE).
ALTER TYPE "FacilityType" ADD VALUE IF NOT EXISTS 'ESTATE';
ALTER TYPE "FacilityType" ADD VALUE IF NOT EXISTS 'SCHOOL';
ALTER TYPE "FacilityType" ADD VALUE IF NOT EXISTS 'BANK';
ALTER TYPE "FacilityType" ADD VALUE IF NOT EXISTS 'ORGANIZATION';

BEGIN;
CREATE TYPE "StaffPhotoStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "DutyShiftEnd" AS ENUM ('OPERATOR', 'SYSTEM');
CREATE TYPE "DutyReportOrigin" AS ENUM ('OPERATOR_SUBMITTED', 'SYSTEM_GENERATED');

ALTER TABLE "User" ADD COLUMN "photoKey" VARCHAR(200);
ALTER TABLE "User" ADD COLUMN "photoStatus" "StaffPhotoStatus";
ALTER TABLE "User" ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "photoReviewedBy" UUID;
ALTER TABLE "User" ADD COLUMN "photoReviewedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT user_photo_consistency CHECK (("photoKey" IS NULL) = ("photoStatus" IS NULL));

CREATE TABLE "DutyShift" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "operatorId" UUID NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "endedBy" "DutyShiftEnd",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DutyShift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT duty_shift_end CHECK (("endedAt" IS NULL) = ("endedBy" IS NULL)),
  CONSTRAINT duty_shift_window CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);
CREATE INDEX "DutyShift_facilityId_startedAt_idx" ON "DutyShift"("facilityId", "startedAt" DESC);
CREATE INDEX "DutyShift_operatorId_endedAt_idx" ON "DutyShift"("operatorId", "endedAt");
-- One open shift per operator.
CREATE UNIQUE INDEX duty_shift_one_open ON "DutyShift"("operatorId") WHERE "endedAt" IS NULL;
ALTER TABLE "DutyShift" ADD CONSTRAINT "DutyShift_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DutyShift" ADD CONSTRAINT "DutyShift_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DutyReport" (
  "id" UUID NOT NULL,
  "shiftId" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "origin" "DutyReportOrigin" NOT NULL,
  "submittedById" UUID,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "late" BOOLEAN NOT NULL DEFAULT false,
  "sourceCutoff" TIMESTAMP(3) NOT NULL,
  "sourceDigest" CHAR(64) NOT NULL,
  "document" JSONB NOT NULL,
  "notes" VARCHAR(4000),
  "handoverItems" JSONB,
  "acknowledgedById" UUID,
  "acknowledgedAt" TIMESTAMP(3),
  "supersedesId" UUID,
  CONSTRAINT "DutyReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT duty_report_version CHECK ("version" >= 1),
  CONSTRAINT duty_report_digest CHECK ("sourceDigest" ~ '^[0-9a-f]{64}$'),
  -- A system-generated report has no submitter, notes or handover: it is never operator-submitted.
  CONSTRAINT duty_report_origin CHECK (
    ("origin" = 'OPERATOR_SUBMITTED' AND "submittedById" IS NOT NULL)
    OR ("origin" = 'SYSTEM_GENERATED' AND "submittedById" IS NULL AND "notes" IS NULL AND "handoverItems" IS NULL AND "late" = false)
  ),
  CONSTRAINT duty_report_ack CHECK (("acknowledgedById" IS NULL) = ("acknowledgedAt" IS NULL))
);
CREATE UNIQUE INDEX "DutyReport_shiftId_origin_version_key" ON "DutyReport"("shiftId", "origin", "version");
CREATE INDEX "DutyReport_facilityId_submittedAt_idx" ON "DutyReport"("facilityId", "submittedAt" DESC);
ALTER TABLE "DutyReport" ADD CONSTRAINT "DutyReport_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "DutyShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DutyReport" ADD CONSTRAINT "DutyReport_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability: after insert only the acknowledgement may be set, once.
CREATE FUNCTION duty_report_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DUTY_REPORT_IMMUTABLE'; END IF;
  IF OLD."acknowledgedAt" IS NOT NULL
     OR NEW."shiftId" IS DISTINCT FROM OLD."shiftId" OR NEW."facilityId" IS DISTINCT FROM OLD."facilityId"
     OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."origin" IS DISTINCT FROM OLD."origin"
     OR NEW."submittedById" IS DISTINCT FROM OLD."submittedById" OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
     OR NEW."late" IS DISTINCT FROM OLD."late" OR NEW."sourceCutoff" IS DISTINCT FROM OLD."sourceCutoff"
     OR NEW."sourceDigest" IS DISTINCT FROM OLD."sourceDigest" OR NEW."document" IS DISTINCT FROM OLD."document"
     OR NEW."notes" IS DISTINCT FROM OLD."notes" OR NEW."handoverItems" IS DISTINCT FROM OLD."handoverItems"
     OR NEW."supersedesId" IS DISTINCT FROM OLD."supersedesId" THEN
    RAISE EXCEPTION 'DUTY_REPORT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER duty_report_immutable BEFORE UPDATE OR DELETE ON "DutyReport" FOR EACH ROW EXECUTE FUNCTION duty_report_immutable();
COMMIT;
