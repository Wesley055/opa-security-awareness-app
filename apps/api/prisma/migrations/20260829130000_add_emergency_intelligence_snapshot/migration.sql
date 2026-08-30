-- CreateTable
CREATE TABLE "EmergencyIntelligenceSnapshot" (
    "journeySessionId" UUID NOT NULL,
    "sourceFixSequence" INTEGER NOT NULL,
    "sourceFixReceivedAt" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redactedAt" TIMESTAMP(3),
    "payload" JSONB,

    CONSTRAINT "EmergencyIntelligenceSnapshot_pkey"
      PRIMARY KEY ("journeySessionId")
);

-- CreateIndex
CREATE INDEX "EmergencyIntelligenceSnapshot_sourceFixReceivedAt_idx"
  ON "EmergencyIntelligenceSnapshot"("sourceFixReceivedAt");

-- AddForeignKey
ALTER TABLE "EmergencyIntelligenceSnapshot"
  ADD CONSTRAINT "EmergencyIntelligenceSnapshot_journeySessionId_fkey"
  FOREIGN KEY ("journeySessionId")
  REFERENCES "JourneySession"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- Provenance: the snapshot identifies an actual canonical fix belonging to
-- the same JourneySession.
ALTER TABLE "EmergencyIntelligenceSnapshot"
  ADD CONSTRAINT "EmergencyIntelligenceSnapshot_journeySessionId_sourceFixSe_fkey"
  FOREIGN KEY ("journeySessionId", "sourceFixSequence")
  REFERENCES "JourneyLocationFix"("journeySessionId", "sequence")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;