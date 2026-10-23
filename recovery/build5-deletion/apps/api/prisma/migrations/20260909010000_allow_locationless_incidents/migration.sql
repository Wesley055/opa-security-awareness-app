-- Preserve all existing rows and incident identity indexes.
ALTER TABLE "Incident"
  ALTER COLUMN "latitude" DROP NOT NULL,
  ALTER COLUMN "longitude" DROP NOT NULL;

-- Unknown location is a missing pair, never a partial coordinate.
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_location_pair_check"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
