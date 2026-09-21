import { NotificationService } from "./notification.service";
import { NotificationChannel } from "./dto/send-notification.dto";
import { buildNotificationPayload } from "./notification-payload";
import { DeliveryReadService } from "./delivery-read.controller";
import { incidentScope } from "../../shared/security/incident-scope";
import { ProtectedSnapshotsService } from "../protected-identity/protected-snapshots.service";

describe("Delivery production boundaries", () => {
  const payload = buildNotificationPayload({
    channel: NotificationChannel.SMS,
    recipient: "+2348012345678",
    personName: "Private",
    location: "Unknown",
    trackingUrl: "https://example.test/private",
  });
  it("resolves only the source-bound protected payload internally", async () => {
    const prisma = {
      incidentNotification: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: "notification",
            channel: "SMS",
            recipient: "[protected]",
            protectedSnapshotId: "snapshot",
            payload: null,
          }),
      },
    };
    const snapshots = {
      notificationPayload: jest.fn().mockResolvedValue(payload),
    };
    const provider = {
      send: jest
        .fn()
        .mockResolvedValue({
          success: true,
          provider: "SMS",
          messageId: "ref",
        }),
    };
    const ledger = {
      claimIncident: jest
        .fn()
        .mockResolvedValue({ id: "attempt", provider: "AFRICASTALKING" }),
      complete: jest.fn(),
    };
    const service = new NotificationService(
      prisma as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      snapshots as never,
      ledger as never,
    );
    await service.dispatchNotification("notification");
    expect(snapshots.notificationPayload).toHaveBeenCalledWith(
      "snapshot",
      "notification",
    );
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: payload.recipient }),
    );
    expect(JSON.stringify(ledger.complete.mock.calls)).not.toContain(
      payload.recipient,
    );
  });
  it("rejects institutional plaintext outboxes pending protected cutover", async () => {
    const prisma = {
      incidentNotification: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: "notification",
            channel: "SMS",
            recipient: payload.recipient,
            payload,
            incident: { facilityId: "tenant" },
          }),
      },
    };
    const provider = { send: jest.fn() };
    const ledger = {
      claimIncident: jest
        .fn()
        .mockResolvedValue({ id: "attempt", provider: "AFRICASTALKING" }),
      complete: jest.fn(),
    };
    await new NotificationService(
      prisma as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      undefined,
      ledger as never,
    ).dispatchNotification("notification");
    expect(provider.send).not.toHaveBeenCalled();
    expect(ledger.complete).toHaveBeenCalledWith(
      "attempt",
      expect.objectContaining({
        failureCategory: "INTERNAL_ERROR",
        retryable: false,
      }),
    );
  });
  it("does not fall back to plaintext when protected authorization fails", async () => {
    const prisma = {
      incidentNotification: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: "notification",
            channel: "SMS",
            recipient: payload.recipient,
            protectedSnapshotId: "copied",
            payload,
          }),
      },
    };
    const snapshots = {
      notificationPayload: jest.fn().mockRejectedValue(new Error("denied")),
    };
    const provider = { send: jest.fn() };
    const ledger = {
      claimIncident: jest
        .fn()
        .mockResolvedValue({ id: "attempt", provider: "AFRICASTALKING" }),
      complete: jest.fn(),
    };
    await new NotificationService(
      prisma as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      snapshots as never,
      ledger as never,
    ).dispatchNotification("notification");
    expect(provider.send).not.toHaveBeenCalled();
    expect(ledger.claimIncident).not.toHaveBeenCalled();
    expect(ledger.complete).not.toHaveBeenCalled();
  });
  it("uses the shared authoritative scope for readers and denies guessed cross-tenant incidents", async () => {
    const actor = {
      role: "FACILITY_OPERATOR",
      facilityId: "tenant-a",
      isActive: true,
      accountStatus: "ACTIVE",
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(actor) },
      incident: { findFirst: jest.fn().mockResolvedValue(null) },
      incidentNotification: { findMany: jest.fn() },
    };
    await expect(
      new DeliveryReadService(prisma as never).forActorIncident(
        "actor",
        "tenant-b-incident",
      ),
    ).rejects.toThrow("Incident not found");
    expect(prisma.incident.findFirst).toHaveBeenCalledWith({
      where: {
        AND: [{ id: "tenant-b-incident" }, incidentScope("actor", actor)],
      },
      select: { id: true },
    });
    expect(prisma.incidentNotification.findMany).not.toHaveBeenCalled();
  });
  it("seals institutional outbox data before persistence using existing grant and crypto boundaries", async () => {
    const old = process.env.PII_DELIVERY_ACTOR_USER_ID;
    process.env.PII_DELIVERY_ACTOR_USER_ID =
      "00000000-0000-4000-8000-000000000001";
    try {
      const tx = {
        incident: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ userId: "subject", facilityId: "tenant" }),
        },
      };
      const identity = {
        authorize: jest.fn(),
        protectInTransaction: jest.fn().mockResolvedValue({ id: "protected" }),
      };
      const snapshots = new ProtectedSnapshotsService(
        {} as never,
        identity as never,
      );
      const data = await snapshots.notificationData(tx as never, {
        id: "outbox",
        incidentId: "incident",
        contactName: "Private",
        contactType: "PRIMARY",
        recipient: payload.recipient,
        channel: "SMS",
        status: "QUEUED",
        payload,
      });
      expect(identity.authorize).toHaveBeenCalledWith(
        tx,
        "tenant",
        process.env.PII_DELIVERY_ACTOR_USER_ID,
        "DELIVERY",
      );
      expect(identity.protectInTransaction).toHaveBeenCalledWith(
        tx,
        process.env.PII_DELIVERY_ACTOR_USER_ID,
        {
          tenantId: "tenant",
          subjectUserId: "subject",
          sourceId: "outbox",
          kind: "NOTIFICATION_SNAPSHOT",
        },
        expect.any(String),
      );
      expect(data.recipient).toBe("[protected]");
      expect(data.contactName).toBe("[protected]");
      expect(JSON.stringify(data)).not.toContain(payload.recipient);
      expect(data.protectedSnapshotId).toBe("protected");
    } finally {
      if (old === undefined) delete process.env.PII_DELIVERY_ACTOR_USER_ID;
      else process.env.PII_DELIVERY_ACTOR_USER_ID = old;
    }
  });
});
