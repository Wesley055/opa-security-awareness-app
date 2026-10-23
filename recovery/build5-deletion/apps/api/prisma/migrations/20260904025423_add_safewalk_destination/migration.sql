-- AlterTable
ALTER TABLE "JourneySession" ADD COLUMN     "arrivalGraceMinutes" INTEGER,
ADD COLUMN     "destinationLabel" VARCHAR(256),
ADD COLUMN     "destinationLatitude" DECIMAL(9,6),
ADD COLUMN     "destinationLongitude" DECIMAL(9,6),
ADD COLUMN     "expectedArrivalAt" TIMESTAMP(3);
