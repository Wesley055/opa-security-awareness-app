-- Nullable references preserve legacy writers/readers until explicit per-row cutover.
ALTER TABLE "IncidentNotification" ADD COLUMN "protectedSnapshotId" UUID;
ALTER TABLE "AccountInvitationDelivery" ADD COLUMN "protectedSnapshotId" UUID;
ALTER TABLE "IncidentNotification" ADD CONSTRAINT "IncidentNotification_protectedSnapshotId_fkey"
 FOREIGN KEY ("protectedSnapshotId") REFERENCES "ProtectedIdentifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountInvitationDelivery" ADD CONSTRAINT "AccountInvitationDelivery_protectedSnapshotId_fkey"
 FOREIGN KEY ("protectedSnapshotId") REFERENCES "ProtectedIdentifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentNotification" ADD CONSTRAINT "incident_snapshot_no_plaintext"
 CHECK ("protectedSnapshotId" IS NULL OR ("recipient" = '[protected]' AND "contactName" = '[protected]' AND "payload" IS NULL));
ALTER TABLE "AccountInvitationDelivery" ADD CONSTRAINT "invitation_snapshot_no_plaintext"
 CHECK ("protectedSnapshotId" IS NULL OR "recipient" = '[protected]');
