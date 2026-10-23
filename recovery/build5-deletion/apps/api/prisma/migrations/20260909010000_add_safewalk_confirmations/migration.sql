-- Additive; no historical confirmations are fabricated.
ALTER TABLE "JourneySession"
ADD COLUMN "safetyConfirmedAt" TIMESTAMP(3),
ADD COLUMN "arrivalConfirmedAt" TIMESTAMP(3);
