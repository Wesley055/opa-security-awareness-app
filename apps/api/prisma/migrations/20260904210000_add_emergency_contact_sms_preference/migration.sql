-- Add explicit per-contact emergency SMS recipient selection.
--
-- Existing contacts remain selected so deployment cannot silently disable
-- emergency notification coverage. Users may explicitly opt individual
-- contacts out after the preference is exposed in the mobile app.
ALTER TABLE "EmergencyContact"
ADD COLUMN "receivesEmergencySms" BOOLEAN NOT NULL DEFAULT true;
