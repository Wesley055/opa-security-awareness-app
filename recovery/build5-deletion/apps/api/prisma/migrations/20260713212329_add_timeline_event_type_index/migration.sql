-- CreateIndex
CREATE INDEX "IncidentTimelineEvent_incidentId_type_occurredAt_idx" ON "IncidentTimelineEvent"("incidentId", "type", "occurredAt");
