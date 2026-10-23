-- CreateEnum
CREATE TYPE "TrackingAccessScope" AS ENUM ('FAMILY_BEARER', 'VERIFIED_CONTACT', 'AUTHORIZED_RESPONDER');

-- CreateTable
CREATE TABLE "IncidentAccessToken" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "scope" "TrackingAccessScope" NOT NULL DEFAULT 'FAMILY_BEARER',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiry" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentAccessToken_tokenHash_key" ON "IncidentAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "IncidentAccessToken_incidentId_revokedAt_idx" ON "IncidentAccessToken"("incidentId", "revokedAt");

-- CreateIndex
CREATE INDEX "IncidentAccessToken_expiresAt_idx" ON "IncidentAccessToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "IncidentAccessToken" ADD CONSTRAINT "IncidentAccessToken_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
