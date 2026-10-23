-- CreateTable
CREATE TABLE "IncidentTimelineEvent" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "source" TEXT NOT NULL,
    "actorUserId" UUID,
    "correlationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "IncidentTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentTimelineEvent_incidentId_occurredAt_idx" ON "IncidentTimelineEvent"("incidentId", "occurredAt");

-- CreateIndex
CREATE INDEX "IncidentTimelineEvent_correlationId_idx" ON "IncidentTimelineEvent"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentTimelineEvent_incidentId_sequence_key" ON "IncidentTimelineEvent"("incidentId", "sequence");

-- AddForeignKey
ALTER TABLE "IncidentTimelineEvent" ADD CONSTRAINT "IncidentTimelineEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
