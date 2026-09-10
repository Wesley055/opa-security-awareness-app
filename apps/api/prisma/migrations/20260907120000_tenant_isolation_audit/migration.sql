CREATE TABLE "AdministrativeAuditEvent" (
  "id" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "actorRole" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceId" UUID NOT NULL,
  "facilityId" UUID,
  "previousFacilityId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdministrativeAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdministrativeAuditEvent_facilityId_createdAt_idx" ON "AdministrativeAuditEvent"("facilityId", "createdAt");
CREATE INDEX "AdministrativeAuditEvent_actorUserId_createdAt_idx" ON "AdministrativeAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "AccountInvitationDelivery_facilityId_userId_queuedAt_idx" ON "AccountInvitationDelivery"("facilityId", "userId", "queuedAt" DESC);
