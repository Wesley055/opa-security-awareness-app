-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "lastTriggeredAt" TIMESTAMP(3),
ADD COLUMN     "retriggerCount" INTEGER NOT NULL DEFAULT 0;
