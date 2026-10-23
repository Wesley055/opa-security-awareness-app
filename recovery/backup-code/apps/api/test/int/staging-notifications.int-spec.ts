import { prismaTest } from "./prisma-test-client";
import { reserveBudget } from "../../src/modules/notifications/outbound-environment";
import { DeliveryLedgerService } from "../../src/modules/notifications/delivery-ledger.service";
import { EmailProvider } from "../../src/modules/notifications/providers/email.provider";
import { randomUUID } from "node:crypto";
describe("durable staging notification limits and truth", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = {
      ...original,
      OPA_ENVIRONMENT: "staging",
      OPA_ACCEPTANCE_RUN_ID: "fixture-run",
      OPA_NOTIFICATION_MAX_PER_HOUR: "3",
      OPA_NOTIFICATION_MAX_PER_RUN: "2",
    };
  });
  afterEach(() => {
    process.env = original;
  });
  it("concurrent reservations enforce run limit, then hourly limit across runs", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => reserveBudget(prismaTest)),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(2);
    process.env.OPA_ACCEPTANCE_RUN_ID = "next-fixture-run";
    expect(await reserveBudget(prismaTest)).toBe(true);
    expect(await reserveBudget(prismaTest)).toBe(false);
    expect(
      (await prismaTest.stagingNotificationBudget.findMany())
        .map((r) => r.count)
        .sort(),
    ).toEqual([1, 2, 3]);
  });
  it("blocked provider send persists FAILED without accepted or delivered evidence", async () => {
    const user = await prismaTest.user.create({
      data: {
        email: randomUUID() + "@example.test",
        phoneNumber: randomUUID(),
        firstName: "Synthetic",
        lastName: "Test",
        passwordHash: null,
      },
    });
    const incident = await prismaTest.incident.create({
      data: { userId: user.id, trigger: "SOS_BUTTON" },
    });
    const row = await prismaTest.incidentNotification.create({
      data: {
        incidentId: incident.id,
        channel: "EMAIL",
        status: "QUEUED",
        recipient: "fixture@example.test",
        contactName: "Synthetic",
        contactType: "Test",
      },
    });
    const ledger = new DeliveryLedgerService(prismaTest as never);
    const attempt = await ledger.claimIncident(row.id);
    expect(attempt).not.toBeNull();
    const response = await new EmailProvider().send({
      recipient: row.recipient,
      message: "synthetic fixture",
    });
    await ledger.complete(attempt!.id, response);
    const saved = await prismaTest.incidentNotification.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(saved.deliveryStatus).toBe("FAILED");
    expect(saved.providerAcceptedAt).toBeNull();
    expect(saved.confirmedDeliveredAt).toBeNull();
    const events = await prismaTest.deliveryStatusEvent.findMany({
      where: { attemptId: attempt!.id },
    });
    expect(events.some((e) => e.reason === "ENVIRONMENT_POLICY_DENIED")).toBe(
      true,
    );
    expect(
      events.some(
        (e) =>
          e.newStatus === "DELIVERED" || e.newStatus === "PROVIDER_ACCEPTED",
      ),
    ).toBe(false);
  });
});
