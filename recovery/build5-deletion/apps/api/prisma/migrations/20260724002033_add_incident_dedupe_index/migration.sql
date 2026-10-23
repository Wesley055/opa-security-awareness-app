-- CreateIndex
CREATE INDEX "Incident_userId_status_lastTriggeredAt_idx" ON "Incident"("userId", "status", "lastTriggeredAt");
