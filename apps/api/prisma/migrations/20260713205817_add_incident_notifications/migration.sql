-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'WHATSAPP', 'VOICE', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "IncidentNotification" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "contactId" UUID,
    "contactName" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentNotification_incidentId_queuedAt_idx" ON "IncidentNotification"("incidentId", "queuedAt");

-- CreateIndex
CREATE INDEX "IncidentNotification_status_queuedAt_idx" ON "IncidentNotification"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "IncidentNotification_providerMessageId_idx" ON "IncidentNotification"("providerMessageId");

-- AddForeignKey
ALTER TABLE "IncidentNotification" ADD CONSTRAINT "IncidentNotification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
