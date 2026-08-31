-- Durable outbox for account invitation delivery.
--
-- Provisioning commits the account and a QUEUED row here in one
-- transaction, so a provider outage can never roll back or silently lose a
-- resident seat. A worker claims the row, issues a fresh activation code,
-- sends, and records the outcome.
--
-- NO PAYLOAD COLUMN. The activation credential exists only as a hash on
-- "User"; the message is built in memory at send time and discarded.
--
-- NO deliveredAt. Provider acceptance is not delivery, and there is no
-- delivery-receipt webhook yet.
CREATE TABLE "AccountInvitationDelivery" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "invitedByUserId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "recipient" TEXT NOT NULL,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountInvitationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountInvitationDelivery_userId_idx"
  ON "AccountInvitationDelivery"("userId");

-- The worker's claim query: due QUEUED rows, oldest original queue time first.
CREATE INDEX "AccountInvitationDelivery_status_nextAttemptAt_queuedAt_idx"
  ON "AccountInvitationDelivery"("status", "nextAttemptAt", "queuedAt");

-- The invited resident and the facility are Restrict: this row records what
-- OPA sent on whose behalf and outlives convenience.
ALTER TABLE "AccountInvitationDelivery"
  ADD CONSTRAINT "AccountInvitationDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountInvitationDelivery"
  ADD CONSTRAINT "AccountInvitationDelivery_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The inviting administrator is SET NULL, matching User.invitedByUserId: an
-- administrator's own lifecycle must not be blocked by invitations they
-- once sent, while the record of what OPA sent survives them.
ALTER TABLE "AccountInvitationDelivery"
  ADD CONSTRAINT "AccountInvitationDelivery_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;