BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'ATTEMPTING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeliveryFailureCategory" AS ENUM ('AUTHENTICATION', 'INVALID_RECIPIENT', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'NETWORK', 'TIMEOUT', 'REJECTED', 'EXPIRED', 'UNKNOWN_PROVIDER_ERROR', 'INTERNAL_ERROR');

-- AlterTable
ALTER TABLE "IncidentNotification" ADD COLUMN     "confirmedDeliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "failureCategory" "DeliveryFailureCategory",
ADD COLUMN     "firstAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "providerAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AccountInvitationDelivery" ADD COLUMN     "confirmedDeliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "failureCategory" "DeliveryFailureCategory",
ADD COLUMN     "firstAttemptAt" TIMESTAMP(3),
ADD COLUMN     "providerAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" UUID NOT NULL,
    "incidentNotificationId" UUID,
    "invitationDeliveryId" UUID,
    "number" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "accountScope" VARCHAR(128) NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "providerAcceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureCategory" "DeliveryFailureCategory",
    "retryable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderReference" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "accountScope" VARCHAR(128) NOT NULL,
    "messageId" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryStatusEvent" (
    "id" UUID NOT NULL,
    "incidentNotificationId" UUID,
    "invitationDeliveryId" UUID,
    "attemptId" UUID,
    "previousStatus" "DeliveryStatus",
    "newStatus" "DeliveryStatus" NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(32),
    "reason" VARCHAR(64) NOT NULL,
    "failureCategory" "DeliveryFailureCategory",
    "receiptId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderDeliveryReceipt" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "accountScope" VARCHAR(128) NOT NULL,
    "eventId" VARCHAR(256) NOT NULL,
    "messageId" VARCHAR(256) NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "failureCategory" "DeliveryFailureCategory",
    "eventType" VARCHAR(64) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "nextReconcileAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconcileCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProviderDeliveryReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryAttempt_status_startedAt_idx" ON "DeliveryAttempt"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_incidentNotificationId_number_key" ON "DeliveryAttempt"("incidentNotificationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_invitationDeliveryId_number_key" ON "DeliveryAttempt"("invitationDeliveryId", "number");

-- CreateIndex
CREATE INDEX "ProviderReference_attemptId_idx" ON "ProviderReference"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderReference_provider_accountScope_messageId_key" ON "ProviderReference"("provider", "accountScope", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryStatusEvent_receiptId_key" ON "DeliveryStatusEvent"("receiptId");

-- CreateIndex
CREATE INDEX "DeliveryStatusEvent_incidentNotificationId_recordedAt_id_idx" ON "DeliveryStatusEvent"("incidentNotificationId", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "DeliveryStatusEvent_invitationDeliveryId_recordedAt_id_idx" ON "DeliveryStatusEvent"("invitationDeliveryId", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "DeliveryStatusEvent_attemptId_recordedAt_idx" ON "DeliveryStatusEvent"("attemptId", "recordedAt");

-- CreateIndex
CREATE INDEX "ProviderDeliveryReceipt_processedAt_nextReconcileAt_idx" ON "ProviderDeliveryReceipt"("processedAt", "nextReconcileAt");

-- CreateIndex
CREATE INDEX "ProviderDeliveryReceipt_provider_accountScope_messageId_idx" ON "ProviderDeliveryReceipt"("provider", "accountScope", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderDeliveryReceipt_provider_accountScope_eventId_key" ON "ProviderDeliveryReceipt"("provider", "accountScope", "eventId");

-- CreateIndex
CREATE INDEX "IncidentNotification_status_nextAttemptAt_queuedAt_idx" ON "IncidentNotification"("status", "nextAttemptAt", "queuedAt");

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_incidentNotificationId_fkey" FOREIGN KEY ("incidentNotificationId") REFERENCES "IncidentNotification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_invitationDeliveryId_fkey" FOREIGN KEY ("invitationDeliveryId") REFERENCES "AccountInvitationDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderReference" ADD CONSTRAINT "ProviderReference_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "DeliveryAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStatusEvent" ADD CONSTRAINT "DeliveryStatusEvent_incidentNotificationId_fkey" FOREIGN KEY ("incidentNotificationId") REFERENCES "IncidentNotification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStatusEvent" ADD CONSTRAINT "DeliveryStatusEvent_invitationDeliveryId_fkey" FOREIGN KEY ("invitationDeliveryId") REFERENCES "AccountInvitationDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStatusEvent" ADD CONSTRAINT "DeliveryStatusEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "DeliveryAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStatusEvent" ADD CONSTRAINT "DeliveryStatusEvent_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ProviderDeliveryReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing rows remain UNKNOWN. No timestamps or provider receipts are invented.
ALTER TABLE "IncidentNotification" ALTER COLUMN "deliveryStatus" SET DEFAULT 'QUEUED';
ALTER TABLE "AccountInvitationDelivery" ALTER COLUMN "deliveryStatus" SET DEFAULT 'QUEUED';
CREATE INDEX "IncidentNotification_incidentId_id_idx" ON "IncidentNotification"("incidentId", "id");

ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_exactly_one_owner"
  CHECK (num_nonnulls("incidentNotificationId", "invitationDeliveryId") = 1);
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_positive_number" CHECK ("number" > 0);
ALTER TABLE "DeliveryStatusEvent" ADD CONSTRAINT "DeliveryStatusEvent_exactly_one_owner"
  CHECK (num_nonnulls("incidentNotificationId", "invitationDeliveryId") = 1);

-- Queue evidence belongs to the durable outbox transaction, including all
-- existing createMany producers. This avoids a second queue or best-effort audit.
CREATE FUNCTION opa_delivery_initial_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."deliveryStatus" := CASE WHEN NEW.status = 'QUEUED' THEN 'QUEUED'::"DeliveryStatus" ELSE 'UNKNOWN'::"DeliveryStatus" END;
  RETURN NEW;
END $$;
CREATE FUNCTION opa_delivery_queue_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "DeliveryStatusEvent" (id, "incidentNotificationId", "invitationDeliveryId", "newStatus", source, reason, "occurredAt")
  VALUES (gen_random_uuid(), CASE WHEN TG_TABLE_NAME = 'IncidentNotification' THEN NEW.id END,
    CASE WHEN TG_TABLE_NAME = 'AccountInvitationDelivery' THEN NEW.id END,
    NEW."deliveryStatus", 'OUTBOX', CASE WHEN NEW.status = 'QUEUED' THEN 'DURABLY_QUEUED' ELSE 'LEGACY_UNVERIFIED' END, NEW."queuedAt");
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_initial_state BEFORE INSERT ON "IncidentNotification" FOR EACH ROW EXECUTE FUNCTION opa_delivery_initial_state();
CREATE TRIGGER delivery_initial_state BEFORE INSERT ON "AccountInvitationDelivery" FOR EACH ROW EXECUTE FUNCTION opa_delivery_initial_state();
CREATE TRIGGER delivery_queue_event AFTER INSERT ON "IncidentNotification" FOR EACH ROW EXECUTE FUNCTION opa_delivery_queue_event();
CREATE TRIGGER delivery_queue_event AFTER INSERT ON "AccountInvitationDelivery" FOR EACH ROW EXECUTE FUNCTION opa_delivery_queue_event();

-- Audit facts are append-only, unlike the explicitly rebuildable projections.
CREATE FUNCTION opa_delivery_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Delivery audit records are immutable'; END $$;
CREATE TRIGGER delivery_event_immutable BEFORE UPDATE OR DELETE ON "DeliveryStatusEvent" FOR EACH ROW EXECUTE FUNCTION opa_delivery_immutable();
CREATE TRIGGER delivery_reference_immutable BEFORE UPDATE OR DELETE ON "ProviderReference" FOR EACH ROW EXECUTE FUNCTION opa_delivery_immutable();

CREATE FUNCTION opa_delivery_event_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "DeliveryAttempt";
BEGIN
  IF NEW."attemptId" IS NOT NULL THEN
    SELECT * INTO STRICT a FROM "DeliveryAttempt" WHERE id = NEW."attemptId";
    IF a."incidentNotificationId" IS DISTINCT FROM NEW."incidentNotificationId" OR a."invitationDeliveryId" IS DISTINCT FROM NEW."invitationDeliveryId" THEN
      RAISE EXCEPTION 'Delivery event owner does not match attempt';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_event_owner BEFORE INSERT ON "DeliveryStatusEvent" FOR EACH ROW EXECUTE FUNCTION opa_delivery_event_owner();

CREATE FUNCTION opa_delivery_reference_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "DeliveryAttempt";
BEGIN
  SELECT * INTO STRICT a FROM "DeliveryAttempt" WHERE id = NEW."attemptId";
  IF a.provider <> NEW.provider OR a."accountScope" <> NEW."accountScope" THEN
    RAISE EXCEPTION 'Delivery reference provider does not match attempt';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_reference_owner BEFORE INSERT ON "ProviderReference" FOR EACH ROW EXECUTE FUNCTION opa_delivery_reference_owner();
COMMIT;
