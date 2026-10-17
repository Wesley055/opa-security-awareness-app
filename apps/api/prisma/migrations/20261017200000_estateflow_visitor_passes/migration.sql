BEGIN;
-- EstateFlow: visitor passes verified at the gate by a six-digit code (QR optional).
-- Additive only: two new tables, two enums, two estate settings with defaults.
CREATE TYPE "VisitorPassStatus" AS ENUM ('ISSUED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'REVOKED', 'EXPIRED');
CREATE TYPE "GateEventType" AS ENUM ('VERIFIED', 'VERIFY_FAILED', 'ENTRY', 'DENIED', 'EXIT', 'OVERSTAY', 'MANUAL_ENTRY');

ALTER TABLE "Facility" ADD COLUMN "visitorDefaultMinutes" INTEGER NOT NULL DEFAULT 240;
ALTER TABLE "Facility" ADD COLUMN "overstayGraceMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Facility" ADD CONSTRAINT facility_visitor_settings CHECK (
  "visitorDefaultMinutes" BETWEEN 15 AND 4320 AND "overstayGraceMinutes" BETWEEN 0 AND 720
);

CREATE TABLE "VisitorPass" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "hostUserId" UUID NOT NULL,
  "visitorCiphertext" TEXT NOT NULL,
  "destination" VARCHAR(120) NOT NULL,
  "codeDigest" CHAR(64) NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "expectedMinutes" INTEGER NOT NULL,
  "status" "VisitorPassStatus" NOT NULL DEFAULT 'ISSUED',
  "checkedInAt" TIMESTAMP(3),
  "checkedInByUserId" UUID,
  "checkedOutAt" TIMESTAMP(3),
  "checkedOutByUserId" UUID,
  "overstayAlertedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitorPass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT visitor_pass_window CHECK ("validUntil" > "validFrom"),
  CONSTRAINT visitor_pass_duration CHECK ("expectedMinutes" BETWEEN 15 AND 4320),
  CONSTRAINT visitor_pass_destination CHECK (length(trim("destination")) > 0),
  CONSTRAINT visitor_pass_code CHECK ("codeDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT visitor_pass_checkin CHECK (("status" IN ('CHECKED_IN', 'CHECKED_OUT')) = ("checkedInAt" IS NOT NULL) OR "status" = 'EXPIRED'),
  CONSTRAINT visitor_pass_checkout CHECK (("status" = 'CHECKED_OUT') = ("checkedOutAt" IS NOT NULL))
);
CREATE INDEX "VisitorPass_facilityId_status_idx" ON "VisitorPass"("facilityId", "status");
CREATE INDEX "VisitorPass_hostUserId_createdAt_idx" ON "VisitorPass"("hostUserId", "createdAt");
CREATE INDEX "VisitorPass_facilityId_codeDigest_idx" ON "VisitorPass"("facilityId", "codeDigest");
-- A code identifies at most one live pass in an estate.
CREATE UNIQUE INDEX "VisitorPass_live_code_key" ON "VisitorPass"("facilityId", "codeDigest") WHERE "status" IN ('ISSUED', 'CHECKED_IN');
ALTER TABLE "VisitorPass" ADD CONSTRAINT "VisitorPass_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitorPass" ADD CONSTRAINT "VisitorPass_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GateEvent" (
  "id" UUID NOT NULL,
  "facilityId" UUID NOT NULL,
  "passId" UUID,
  "type" "GateEventType" NOT NULL,
  "actorUserId" UUID,
  "note" VARCHAR(200),
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GateEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GateEvent_facilityId_occurredAt_idx" ON "GateEvent"("facilityId", "occurredAt");
CREATE INDEX "GateEvent_actorUserId_type_occurredAt_idx" ON "GateEvent"("actorUserId", "type", "occurredAt");
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_passId_fkey" FOREIGN KEY ("passId") REFERENCES "VisitorPass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
