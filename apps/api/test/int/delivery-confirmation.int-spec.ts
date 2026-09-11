import { ProtectedSnapshotsService } from "../../src/modules/protected-identity/protected-snapshots.service";
import { ProtectedIdentityService } from "../../src/modules/protected-identity/protected-identity.service";
import { LocalIdentityCrypto } from "../../src/modules/protected-identity/identity-crypto";
import { randomUUID } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { prismaTest } from "./prisma-test-client";
import { DeliveryLedgerService } from "../../src/modules/notifications/delivery-ledger.service";
import { DeliveryReadService } from "../../src/modules/notifications/delivery-read.controller";
import {
  DeliveryReceiptController,
  ResendReceiptVerifier,
} from "../../src/modules/notifications/delivery-receipt.controller";
import { IncidentAccessGuard } from "../../src/shared/guards/incident-access.guard";
import { NotificationService } from "../../src/modules/notifications/notification.service";
import type { NotificationChannel } from "../../src/modules/notifications/dto/send-notification.dto";
import { buildNotificationPayload } from "../../src/modules/notifications/notification-payload";

const ledger = new DeliveryLedgerService(prismaTest as never);
const secret = "whsec_" + Buffer.alloc(32, 9).toString("base64");
async function queued(channel: "EMAIL" | "SMS" | "PUSH" = "EMAIL") {
  const facility = await prismaTest.facility.create({
    data: { name: "Test facility", type: "OTHER" },
  });
  const user = await prismaTest.user.create({
    data: {
      email: randomUUID() + "@example.test",
      phoneNumber: randomUUID(),
      firstName: "Private",
      lastName: "Person",
      passwordHash: null,
    },
  });
  const incident = await prismaTest.incident.create({
    data: { userId: user.id, facilityId: facility.id, trigger: "SOS_BUTTON" },
  });
  const row = await prismaTest.incidentNotification.create({
    data: {
      incidentId: incident.id,
      channel,
      status: "QUEUED",
      recipient: "recipient-private@example.test",
      contactId: null,
      contactName: "Private recipient",
      contactType: "Family",
      payload: buildNotificationPayload({
        channel: channel as NotificationChannel,
        recipient: "recipient-private@example.test",
        personName: "Private",
        location: "Unknown",
        trackingUrl: "https://example.test/i/secret",
      }),
    },
  });
  return { row, user, incident, facility };
}
async function receipt(
  messageId: string,
  status: "DELIVERED" | "FAILED" | "PROVIDER_ACCEPTED",
  eventId = randomUUID(),
) {
  return prismaTest.providerDeliveryReceipt.create({
    data: {
      provider: "RESEND",
      accountScope: "primary",
      eventId,
      messageId,
      status,
      failureCategory: status === "FAILED" ? "REJECTED" : null,
      eventType:
        status === "DELIVERED"
          ? "email.delivered"
          : status === "FAILED"
            ? "email.bounced"
            : "email.sent",
      occurredAt: new Date(),
    },
  });
}
const get = (id: string) =>
  prismaTest.incidentNotification.findUniqueOrThrow({ where: { id } });

describe("Delivery confirmation PostgreSQL invariants", () => {
  it("queue → attempting → accepted; acceptance is never delivered", async () => {
    const { row } = await queued("SMS");
    expect(row.deliveryStatus).toBe("QUEUED");
    expect(
      await prismaTest.deliveryStatusEvent.count({
        where: { incidentNotificationId: row.id, newStatus: "QUEUED" },
      }),
    ).toBe(1);
    const attempt = await ledger.claimIncident(row.id);
    expect((await get(row.id)).deliveryStatus).toBe("ATTEMPTING");
    await ledger.complete(attempt!.id, {
      success: true,
      provider: "SMS",
      messageId: "sms-ref",
    });
    expect((await get(row.id)).deliveryStatus).toBe("PROVIDER_ACCEPTED");
    expect((await get(row.id)).confirmedDeliveredAt).toBeNull();
    expect(
      await prismaTest.providerReference.count({
        where: { attemptId: attempt!.id },
      }),
    ).toBe(1);
  });
  it("retries a known retryable failure, preserving both attempts and reporting", async () => {
    const { row, incident, user } = await queued();
    const first = await ledger.claimIncident(row.id);
    await ledger.complete(first!.id, {
      success: false,
      provider: "Email",
      failureCategory: "RATE_LIMITED",
      retryable: true,
    });
    expect((await get(row.id)).status).toBe("QUEUED");
    expect(await ledger.claimIncident(row.id)).toBeNull();
    await prismaTest.incidentNotification.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const second = await ledger.claimIncident(row.id);
    expect(second!.number).toBe(2);
    await ledger.complete(second!.id, {
      success: true,
      provider: "Email",
      messageId: "email-ref",
    });
    const r = await receipt("email-ref", "DELIVERED");
    await ledger.applyReceipt(r.id);
    const projection = await new DeliveryReadService(
      prismaTest as never,
    ).forActorIncident(user.id, incident.id);
    expect(projection.items[0]).toMatchObject({
      status: "DELIVERED",
      attemptCount: 2,
      retryCount: 1,
      failedAttemptCount: 1,
      historyComplete: true,
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /recipient-private|Private recipient|secret|email-ref/,
    );
    expect(
      projection.items[0]!.latencyMs.queueToConfirmedDelivery,
    ).not.toBeNull();
  });
  it("never retries a terminal recipient failure", async () => {
    const { row } = await queued();
    const a = await ledger.claimIncident(row.id);
    await ledger.complete(a!.id, {
      success: false,
      provider: "Email",
      failureCategory: "INVALID_RECIPIENT",
      retryable: true,
    });
    expect((await get(row.id)).status).toBe("FAILED");
    expect(await ledger.claimIncident(row.id)).toBeNull();
  });
  it("bounds repeated failures to five attempts", async () => {
    const { row } = await queued();
    for (let n = 1; n <= 5; n++) {
      await prismaTest.incidentNotification.update({
        where: { id: row.id },
        data: { nextAttemptAt: new Date(0) },
      });
      const a = await ledger.claimIncident(row.id);
      expect(a!.number).toBe(n);
      await ledger.complete(a!.id, {
        success: false,
        provider: "Email",
        failureCategory: "RATE_LIMITED",
        retryable: true,
      });
    }
    expect((await get(row.id)).status).toBe("FAILED");
    expect(await ledger.claimIncident(row.id)).toBeNull();
  });
  it("atomically protects institutional outboxes and serializes concurrent claims to one audited provider send", async () => {
    const { row, user, facility } = await queued();
    await prismaTest.user.update({
      where: { id: user.id },
      data: { facilityId: facility.id, role: "FACILITY_ADMIN" },
    });
    await prismaTest.identityAccessGrant.createMany({
      data: ["WRITE", "DELIVERY"].map((permission) => ({
        tenantId: facility.id,
        actorUserId: user.id,
        permission: permission as "WRITE",
        expiresAt: new Date(Date.now() + 60000),
        approvedByReference: randomUUID(),
      })),
    });
    const previous = process.env.PII_DELIVERY_ACTORS_JSON;
    process.env.PII_DELIVERY_ACTORS_JSON = JSON.stringify({
      [facility.id]: user.id,
    });
    try {
      const crypto = new LocalIdentityCrypto(
        new Map([["test", Buffer.alloc(32, 7)]]),
        "test",
        Buffer.alloc(32, 8),
        "test",
      );
      const snapshots = new ProtectedSnapshotsService(
        prismaTest as never,
        new ProtectedIdentityService(prismaTest as never, crypto),
      );
      const provider = {
        send: jest.fn().mockImplementation(async () => {
          expect(
            await prismaTest.identityResolutionAudit.count({
              where: { purpose: "DELIVERY" },
            }),
          ).toBe(1);
          return { success: true, provider: "Email", messageId: "only-send" };
        }),
      };
      const service = new NotificationService(
        prismaTest as never,
        provider as never,
        provider as never,
        provider as never,
        provider as never,
        provider as never,
        snapshots,
        ledger,
      );
      const id = randomUUID();
      await prismaTest.$transaction((tx) =>
        service.queueMany(tx, {
          data: {
            id,
            incidentId: row.incidentId,
            contactName: row.contactName,
            contactType: row.contactType,
            recipient: row.recipient,
            channel: row.channel,
            status: "QUEUED",
            payload: row.payload as never,
          },
        }),
      );
      const stored = await get(id);
      expect(stored.recipient).toBe("[protected]");
      expect(stored.contactName).toBe("[protected]");
      expect(stored.payload).toBeNull();
      expect(stored.protectedSnapshotId).not.toBeNull();
      await Promise.all([
        service.dispatchNotification(id),
        service.dispatchNotification(id),
      ]);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect((await get(id)).attemptCount).toBe(1);
      expect((await get(id)).deliveryStatus).toBe("PROVIDER_ACCEPTED");
      const page = await new DeliveryReadService(
        prismaTest as never,
      ).forActorIncident(user.id, row.incidentId);
      expect(
        page.items.find((item) => item.id === id)?.recipient.maskedIdentity,
      ).toBe("••••");
      expect(JSON.stringify(page)).not.toContain(row.recipient);
      expect(JSON.stringify(page)).not.toContain("only-send");
    } finally {
      if (previous === undefined) delete process.env.PII_DELIVERY_ACTORS_JSON;
      else process.env.PII_DELIVERY_ACTORS_JSON = previous;
    }
  });
  it("duplicate/concurrent callbacks append one receipt event and never regress delivery", async () => {
    const { row } = await queued();
    const a = await ledger.claimIncident(row.id);
    await ledger.complete(a!.id, {
      success: true,
      provider: "Email",
      messageId: "email-1",
    });
    const delivered = await receipt("email-1", "DELIVERED");
    await Promise.all(
      Array.from({ length: 8 }, () => ledger.applyReceipt(delivered.id)),
    );
    expect(
      await prismaTest.deliveryStatusEvent.count({
        where: { receiptId: delivered.id },
      }),
    ).toBe(1);
    const failed = await receipt("email-1", "FAILED");
    const accepted = await receipt("email-1", "PROVIDER_ACCEPTED");
    await Promise.all([
      ledger.applyReceipt(failed.id),
      ledger.applyReceipt(accepted.id),
    ]);
    expect((await get(row.id)).deliveryStatus).toBe("DELIVERED");
  });
  it("a late delivery strengthens failed; stale acceptance does not erase failed", async () => {
    const { row } = await queued();
    const a = await ledger.claimIncident(row.id);
    await ledger.complete(a!.id, {
      success: true,
      provider: "Email",
      messageId: "email-1",
    });
    for (const status of ["FAILED", "PROVIDER_ACCEPTED"] as const) {
      const r = await receipt("email-1", status);
      await ledger.applyReceipt(r.id);
      expect((await get(row.id)).deliveryStatus).toBe("FAILED");
    }
    const delivered = await receipt("email-1", "DELIVERED");
    await ledger.applyReceipt(delivered.id);
    expect((await get(row.id)).deliveryStatus).toBe("DELIVERED");
  });
  it("an older attempt callback cannot overwrite a newer attempt; delivered still strengthens", async () => {
    const { row } = await queued();
    const first = await ledger.claimIncident(row.id);
    await ledger.complete(first!.id, {
      success: false,
      provider: "Email",
      messageId: "old",
      failureCategory: "RATE_LIMITED",
      retryable: true,
    });
    await prismaTest.incidentNotification.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const second = await ledger.claimIncident(row.id);
    await ledger.complete(second!.id, {
      success: true,
      provider: "Email",
      messageId: "new",
    });
    const failed = await receipt("old", "FAILED");
    await ledger.applyReceipt(failed.id);
    expect((await get(row.id)).deliveryStatus).toBe("PROVIDER_ACCEPTED");
    const delivered = await receipt("old", "DELIVERED");
    await ledger.applyReceipt(delivered.id);
    expect((await get(row.id)).deliveryStatus).toBe("DELIVERED");
    expect(
      (
        await prismaTest.deliveryAttempt.findUniqueOrThrow({
          where: { id: second!.id },
        })
      ).status,
    ).toBe("PROVIDER_ACCEPTED");
  });
  it("retains unknown-reference receipts and correlates after response persistence", async () => {
    const { row } = await queued();
    const a = await ledger.claimIncident(row.id);
    const r = await receipt("early", "DELIVERED");
    await ledger.applyReceipt(r.id);
    expect(
      (
        await prismaTest.providerDeliveryReceipt.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).processedAt,
    ).toBeNull();
    await ledger.complete(a!.id, {
      success: true,
      provider: "Email",
      messageId: "early",
    });
    await ledger.applyReceipt(r.id);
    expect((await get(row.id)).deliveryStatus).toBe("DELIVERED");
  });
  it("recovers abandoned attempts as unknown, with no duplicate resend", async () => {
    const { row } = await queued();
    const a = await ledger.claimIncident(row.id);
    await prismaTest.deliveryAttempt.update({
      where: { id: a!.id },
      data: { startedAt: new Date(0) },
    });
    await ledger.recoverStale();
    expect((await get(row.id)).deliveryStatus).toBe("UNKNOWN");
    expect(await ledger.claimIncident(row.id)).toBeNull();
    await ledger.complete(a!.id, {
      success: false,
      provider: "Email",
      uncertain: true,
      failureCategory: "TIMEOUT",
      retryable: false,
    });
    await ledger.complete(a!.id, {
      success: true,
      provider: "Email",
      messageId: "late-response",
    });
    expect((await get(row.id)).deliveryStatus).toBe("PROVIDER_ACCEPTED");
  });
  it("does not attribute a different provider/account receipt to a message", async () => {
    const { row } = await queued("SMS");
    const a = await ledger.claimIncident(row.id);
    await ledger.complete(a!.id, {
      success: true,
      provider: "SMS",
      messageId: "shared-id",
    });
    const r = await receipt("shared-id", "DELIVERED");
    await ledger.applyReceipt(r.id);
    expect((await get(row.id)).deliveryStatus).toBe("PROVIDER_ACCEPTED");
  });
  it("verifies signed ingestion and persists duplicate/replay only once", async () => {
    const { row } = await queued();
    const attempt = await ledger.claimIncident(row.id);
    await ledger.complete(attempt!.id, {
      success: true,
      provider: "Email",
      messageId: "signed",
    });
    process.env.RESEND_WEBHOOK_SECRET = secret;
    try {
      const controller = new DeliveryReceiptController(
        prismaTest as never,
        new ResendReceiptVerifier(),
      );
      const rawBody = Buffer.from(
        JSON.stringify({
          type: "email.delivered",
          created_at: new Date().toISOString(),
          data: { email_id: "signed", to: ["private@example.test"] },
        }),
      );
      const id = "signed-event";
      const timestamp = Math.floor(Date.now() / 1000);
      const headers = {
        "svix-id": id,
        "svix-timestamp": String(timestamp),
        "svix-signature": new Webhook(secret).sign(
          id,
          new Date(timestamp * 1000),
          rawBody.toString(),
        ),
      };
      await Promise.all([
        controller.resend({ rawBody, headers } as never),
        controller.resend({ rawBody, headers } as never),
      ]);
      expect(await prismaTest.providerDeliveryReceipt.count()).toBe(1);
      await ledger.reconcileReceipts();
      expect((await get(row.id)).deliveryStatus).toBe("DELIVERED");
      await expect(
        controller.resend({ rawBody: Buffer.from("{}"), headers } as never),
      ).rejects.toThrow();
      expect(await prismaTest.providerDeliveryReceipt.count()).toBe(1);
    } finally {
      delete process.env.RESEND_WEBHOOK_SECRET;
    }
  });
  it("denies cross-facility incident access using the existing server-side guard", async () => {
    const { incident } = await queued();
    const other = await prismaTest.facility.create({
      data: { name: "Other", type: "OTHER" },
    });
    const operator = await prismaTest.user.create({
      data: {
        email: "operator@example.test",
        phoneNumber: "operator",
        firstName: "Op",
        lastName: "Test",
        role: "FACILITY_OPERATOR",
        facilityId: other.id,
      },
    });
    const guard = new IncidentAccessGuard(prismaTest as never);
    const request = {
      user: { sub: operator.id, role: "ADMIN" },
      params: { incidentId: incident.id },
      body: { facilityId: incident.facilityId },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    await expect(guard.canActivate(context as never)).rejects.toThrow(
      "Incident not found.",
    );
  });
  it("keeps audit events immutable and refuses orphan delivery attempts", async () => {
    const { row } = await queued();
    const event = await prismaTest.deliveryStatusEvent.findFirstOrThrow({
      where: { incidentNotificationId: row.id },
    });
    await expect(
      prismaTest.deliveryStatusEvent.update({
        where: { id: event.id },
        data: { reason: "REWRITTEN" },
      }),
    ).rejects.toThrow();
    await expect(
      prismaTest.deliveryAttempt.create({
        data: {
          number: 1,
          channel: "SMS",
          provider: "AFRICASTALKING",
          accountScope: "primary",
          status: "ATTEMPTING",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("Production receipt and tenant boundaries", () => {
  it("rejects every SMS callback without persisting or changing delivery truth", async () => {
    const { row } = await queued("SMS");
    const a = await ledger.claimIncident(row.id);
    await ledger.complete(a!.id, {
      success: true,
      provider: "SMS",
      messageId: "sms-known",
    });
    const controller = new DeliveryReceiptController(
      prismaTest as never,
      new ResendReceiptVerifier(),
    );
    for (let i = 0; i < 3; i++) {
      expect(() => controller.africastalking()).toThrow(
        "SMS receipt authentication unavailable",
      );
    }
    expect(await prismaTest.providerDeliveryReceipt.count()).toBe(0);
    // Even an internal normalized import cannot upgrade unsupported evidence.
    const receipt = await prismaTest.providerDeliveryReceipt.create({
      data: {
        provider: "AFRICASTALKING",
        accountScope: "primary",
        eventId: "forged",
        messageId: "sms-known",
        status: "DELIVERED",
        eventType: "Success",
        occurredAt: new Date(),
      },
    });
    await ledger.applyReceipt(receipt.id);
    await ledger.applyReceipt(receipt.id);
    expect((await get(row.id)).deliveryStatus).toBe("PROVIDER_ACCEPTED");
    expect((await get(row.id)).confirmedDeliveredAt).toBeNull();
    expect(
      await prismaTest.deliveryStatusEvent.count({
        where: { receiptId: receipt.id },
      }),
    ).toBe(0);
  });
  it("enforces A active-account rules and incident relationships at the read service", async () => {
    const first = await queued();
    const other = await queued();
    const read = new DeliveryReadService(prismaTest as never);
    await expect(
      read.forActorIncident(first.user.id, other.incident.id, other.row.id),
    ).rejects.toThrow("Incident not found");
    expect(
      (await read.forActorIncident(first.user.id, first.incident.id)).items[0]!
        .id,
    ).toBe(first.row.id);
    await prismaTest.user.update({
      where: { id: first.user.id },
      data: { isActive: false },
    });
    await expect(
      read.forActorIncident(first.user.id, first.incident.id),
    ).rejects.toThrow("Incident not found");
    await prismaTest.user.update({
      where: { id: first.user.id },
      data: { isActive: true, accountStatus: "PENDING_ACTIVATION" },
    });
    await expect(
      read.forActorIncident(first.user.id, first.incident.id),
    ).rejects.toThrow("Incident not found");
    await prismaTest.user.update({
      where: { id: first.user.id },
      data: {
        accountStatus: "ACTIVE",
        role: "FACILITY_OPERATOR",
        facilityId: other.facility.id,
      },
    });
    expect(
      (await read.forActorIncident(first.user.id, other.incident.id)).items[0]!
        .id,
    ).toBe(other.row.id);
    await prismaTest.user.update({
      where: { id: first.user.id },
      data: { facilityId: first.facility.id },
    });
    await expect(
      read.forActorIncident(first.user.id, other.incident.id),
    ).rejects.toThrow("Incident not found");
  });
});
