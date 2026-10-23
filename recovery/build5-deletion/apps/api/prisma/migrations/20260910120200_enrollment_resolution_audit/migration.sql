-- Forward-only reconciliation: retain all prior audit rows and support anonymous pending requests.
ALTER TABLE "IdentityResolutionAudit" ALTER COLUMN "tenantId" DROP NOT NULL;
ALTER TABLE "IdentityResolutionAudit" ALTER COLUMN "actorUserId" DROP NOT NULL;
ALTER TABLE "IdentityResolutionAudit" ALTER COLUMN "grantId" DROP NOT NULL;
ALTER TABLE "IdentityResolutionAudit" ADD COLUMN "sourceType" VARCHAR(32) NOT NULL DEFAULT 'PROTECTED_IDENTIFIER';

-- Pending enrollment/reset requests retain their dedicated encrypted workflow.
ALTER TABLE "AccountInvitationDelivery" ADD CONSTRAINT "invitation_snapshot_legacy_only"
CHECK ("protectedSnapshotId" IS NULL OR ("purpose" = 'LEGACY_INVITATION' AND "userId" IS NOT NULL));
