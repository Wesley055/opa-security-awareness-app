-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('HOSPITAL', 'POLICE_STATION', 'FIRE_STATION', 'SECURITY_PROVIDER', 'NGO', 'GOVERNMENT_AGENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('AUDIO', 'VIDEO', 'IMAGE', 'GPS_LOG', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('PENDING', 'UPLOADING', 'STORED', 'FAILED', 'DELETED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'HOSPITAL_STAFF';

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "facilityId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "facilityId" UUID;

-- CreateTable
CREATE TABLE "Facility" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL,
    "address" TEXT,
    "phoneNumber" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "encryptionKeyId" TEXT,
    "capturedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Facility_type_isActive_idx" ON "Facility"("type", "isActive");

-- CreateIndex
CREATE INDEX "Facility_latitude_longitude_idx" ON "Facility"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Evidence_incidentId_createdAt_idx" ON "Evidence"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "Evidence_status_createdAt_idx" ON "Evidence"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_incidentId_sha256_key" ON "Evidence"("incidentId", "sha256");

-- CreateIndex
CREATE INDEX "Incident_facilityId_status_idx" ON "Incident"("facilityId", "status");

-- CreateIndex
CREATE INDEX "User_facilityId_idx" ON "User"("facilityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
