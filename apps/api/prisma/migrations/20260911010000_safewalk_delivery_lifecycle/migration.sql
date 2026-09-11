BEGIN;
ALTER TABLE "JourneySession" ADD COLUMN "safeWalkCreateKey" UUID, ADD COLUMN "safeWalkEmergencyIncidentId" UUID, ADD COLUMN "safeWalkEmergencyAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "JourneySession_userId_safeWalkCreateKey_key" ON "JourneySession"("userId", "safeWalkCreateKey");
ALTER TABLE "JourneySession" ADD CONSTRAINT "safewalk_emergency_pair" CHECK (("safeWalkEmergencyIncidentId" IS NULL) = ("safeWalkEmergencyAt" IS NULL));
ALTER TABLE "JourneySession" ADD CONSTRAINT "safewalk_emergency_incident_fkey" FOREIGN KEY ("safeWalkEmergencyIncidentId") REFERENCES "Incident"(id) ON DELETE RESTRICT;
ALTER TABLE "SafeWalkNotice"
  ADD COLUMN "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "status" "NotificationStatus" NOT NULL DEFAULT 'FAILED',
  ADD COLUMN "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "recipient" TEXT,
  ADD COLUMN "protectedSnapshotId" UUID,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "firstAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "providerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedDeliveredAt" TIMESTAMP(3),
  ADD COLUMN "failureCategory" "DeliveryFailureCategory",
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT;
-- Historical inbox entries are not fabricated delivery attempts or queued emails.
ALTER TABLE "SafeWalkNotice" ALTER COLUMN "status" SET DEFAULT 'QUEUED', ALTER COLUMN "deliveryStatus" SET DEFAULT 'QUEUED';
ALTER TABLE "DeliveryAttempt" ADD COLUMN "safeWalkNoticeId" UUID REFERENCES "SafeWalkNotice"(id) ON DELETE RESTRICT;
ALTER TABLE "DeliveryStatusEvent" ADD COLUMN "safeWalkNoticeId" UUID REFERENCES "SafeWalkNotice"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX "DeliveryAttempt_safeWalkNoticeId_number_key" ON "DeliveryAttempt"("safeWalkNoticeId", number);
CREATE INDEX "DeliveryStatusEvent_safeWalkNoticeId_recordedAt_id_idx" ON "DeliveryStatusEvent"("safeWalkNoticeId", "recordedAt", id);
ALTER TABLE "DeliveryAttempt" DROP CONSTRAINT "DeliveryAttempt_exactly_one_owner", ADD CONSTRAINT "DeliveryAttempt_exactly_one_owner" CHECK (num_nonnulls("incidentNotificationId", "invitationDeliveryId", "safeWalkNoticeId") = 1);
ALTER TABLE "DeliveryStatusEvent" DROP CONSTRAINT "DeliveryStatusEvent_exactly_one_owner", ADD CONSTRAINT "DeliveryStatusEvent_exactly_one_owner" CHECK (num_nonnulls("incidentNotificationId", "invitationDeliveryId", "safeWalkNoticeId") = 1);
CREATE OR REPLACE FUNCTION opa_delivery_event_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "DeliveryAttempt";
BEGIN
  IF NEW."attemptId" IS NOT NULL THEN
    SELECT * INTO STRICT a FROM "DeliveryAttempt" WHERE id = NEW."attemptId";
    IF a."incidentNotificationId" IS DISTINCT FROM NEW."incidentNotificationId" OR a."invitationDeliveryId" IS DISTINCT FROM NEW."invitationDeliveryId" OR a."safeWalkNoticeId" IS DISTINCT FROM NEW."safeWalkNoticeId" THEN
      RAISE EXCEPTION 'Delivery event owner does not match attempt';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION opa_delivery_queue_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "DeliveryStatusEvent" (id, "incidentNotificationId", "invitationDeliveryId", "safeWalkNoticeId", "newStatus", source, reason, "occurredAt")
  VALUES (gen_random_uuid(), CASE WHEN TG_TABLE_NAME = 'IncidentNotification' THEN NEW.id END,
    CASE WHEN TG_TABLE_NAME = 'AccountInvitationDelivery' THEN NEW.id END,
    CASE WHEN TG_TABLE_NAME = 'SafeWalkNotice' THEN NEW.id END,
    NEW."deliveryStatus", 'OUTBOX', CASE WHEN NEW.status = 'QUEUED' THEN 'DURABLY_QUEUED' ELSE 'LEGACY_UNVERIFIED' END,
    CASE WHEN TG_TABLE_NAME = 'SafeWalkNotice' THEN (to_jsonb(NEW)->>'availableAt')::timestamp ELSE (to_jsonb(NEW)->>'queuedAt')::timestamp END);
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_initial_state BEFORE INSERT ON "SafeWalkNotice" FOR EACH ROW EXECUTE FUNCTION opa_delivery_initial_state();
CREATE TRIGGER delivery_queue_event AFTER INSERT ON "SafeWalkNotice" FOR EACH ROW EXECUTE FUNCTION opa_delivery_queue_event();
CREATE TRIGGER safewalk_audit_immutable BEFORE UPDATE OR DELETE ON "SafeWalkAudit" FOR EACH ROW EXECUTE FUNCTION opa_delivery_immutable();
COMMIT;
