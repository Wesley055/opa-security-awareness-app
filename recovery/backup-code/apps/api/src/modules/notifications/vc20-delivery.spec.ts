import { outboundDenial } from "./outbound-environment";
import { Logger } from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { DeliveryLedgerService } from "./delivery-ledger.service";
import { DELIVERY_WORKER_ID, deliveryDiagnostic, markDeliveryFailure, safeDiagnostic } from "./delivery-diagnostics";
import { deliveryChannelEnabled } from "./delivery-capabilities";

describe("VC20 delivery rollover and safe evidence", () => {
  const payload = { version: 1, channel: "SMS", recipient: "+2348012345678", message: "private message", subject: "Alert" };
  const row = { id: "notification", channel: "SMS", protectedSnapshotId: "snapshot", payload: null, incident: { facilityId: "tenant" } };
  function fixture() {
    let claimed = false;
    const prisma = { incidentNotification: { findUnique: jest.fn().mockResolvedValue(row) } };
    const provider = { send: jest.fn().mockResolvedValue({ success: true, provider: "SMS" }) };
    const ledger = { claimIncident: jest.fn(async () => { if (claimed) return null; claimed = true; return {id: "attempt", provider: "SMS"}; }), complete: jest.fn() };
    const make = (resolve: () => Promise<unknown>) => new NotificationService(prisma as never, provider as never, provider as never, provider as never, provider as never, provider as never, { notificationPayload: jest.fn(resolve) } as never, ledger as never);
    return { ledger, provider, make };
  }
  it.each(["DELIVERY_ACTOR_UNAVAILABLE", "DELIVERY_AUTHORIZATION_DENIED", "CRYPTO_DECRYPTION_FAILED", "AUDIT_PERSISTENCE_FAILED", "SNAPSHOT_RESOLUTION_FAILED", "PAYLOAD_VALIDATION_FAILED"] as const)("defers %s before claim; ready workers send exactly once", async code => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const f = fixture();
      const oldWorker = f.make(async () => { throw markDeliveryFailure(new Error("recipient-secret stack credential"), code); });
      expect(await oldWorker.dispatchNotification(row.id)).toBeNull();
      expect(f.ledger.claimIncident).not.toHaveBeenCalled();
      expect(f.ledger.complete).not.toHaveBeenCalled();
      expect(f.provider.send).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(code));
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/recipient-secret|stack|credential|private message/);
      const ready = f.make(async () => payload);
      await Promise.all([ready.dispatchNotification(row.id), ready.dispatchNotification(row.id)]);
      expect(f.provider.send).toHaveBeenCalledTimes(1);
      expect(f.ledger.complete).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
  it("distinguishes outbound policy denial from a provider response", async () => {
    const env = {...process.env};
    try {
      process.env.OPA_ENVIRONMENT = "staging";
      delete process.env.OPA_NOTIFICATION_MODE;
      const result = await outboundDenial("SMS", "+2348012345678", jest.fn(), () => {throw new Error("secret policy details");});
      expect(result).toMatchObject({stage:"PRE_PROVIDER",diagnostic:"ENVIRONMENT_POLICY_DENIED",success:false});
      expect(JSON.stringify(result)).not.toMatch(/secret policy|2348012345678/);
    } finally {process.env = env;}
  });
  it("rejects arbitrary diagnostics rather than persisting exception data", () => {
    expect(deliveryDiagnostic({ diagnostic: "secret" }, "SNAPSHOT_RESOLUTION_FAILED")).toBe("SNAPSHOT_RESOLUTION_FAILED");
    expect(safeDiagnostic("private recipient")).toBeUndefined();
  });
  it("uses existing settings for real email and refuses stub transports", () => {
    expect(deliveryChannelEnabled("EMAIL", {})).toBe(false);
    expect(deliveryChannelEnabled("EMAIL", { RESEND_API_KEY: "fixture", RESEND_FROM_ADDRESS: "fixture@example.test" })).toBe(true);
    for (const channel of ["WHATSAPP", "PUSH", "VOICE"]) expect(deliveryChannelEnabled(channel, {})).toBe(false);
    expect(deliveryChannelEnabled("SMS", {})).toBe(true);
  });
  it.each(["PRE_PROVIDER", "PROVIDER_REQUEST", "PROVIDER_RESPONSE"] as const)("persists truthful %s semantics and only bounded diagnostic", async stage => {
    const attempt = { id: "attempt", incidentNotificationId: "notification", number: 1, status: "ATTEMPTING", provider: "SMS" };
    const tx = { $queryRaw: jest.fn(), incidentNotification: { findUnique: jest.fn().mockResolvedValue({ attemptCount: 1, deliveryStatus: "ATTEMPTING" }), update: jest.fn() }, deliveryAttempt: { findUniqueOrThrow: jest.fn().mockResolvedValue(attempt), update: jest.fn() }, deliveryStatusEvent: { create: jest.fn() } };
    const db = { deliveryAttempt: tx.deliveryAttempt, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
    await new DeliveryLedgerService(db as never).complete("attempt", { success: false, provider: "SMS", stage, diagnostic: "PROVIDER_INVOCATION_FAILED", failureCategory: "NETWORK", error: "secret raw provider error" });
    expect(tx.deliveryStatusEvent.create).toHaveBeenCalledWith({data: expect.objectContaining({source: stage, reason: "PROVIDER_INVOCATION_FAILED"})});
    expect(JSON.stringify(tx.deliveryStatusEvent.create.mock.calls)).not.toContain("secret raw");
  });
  it("binds opaque process provenance to the atomic claim", async () => {
    const tx = { $queryRaw: jest.fn(), incidentNotification: { findUnique: jest.fn().mockResolvedValue({ status: "QUEUED", nextAttemptAt: new Date(0), attemptCount: 0, channel: "SMS", deliveryStatus: "QUEUED" }), update: jest.fn() }, deliveryAttempt: { create: jest.fn().mockResolvedValue({ id: "attempt", provider: "SMS" }) }, deliveryStatusEvent: { create: jest.fn() } };
    const ledger = new DeliveryLedgerService({} as never);
    await ledger.claim(tx as never, {kind: "incident", id: "notification"});
    expect(tx.deliveryStatusEvent.create).toHaveBeenCalledWith({data: expect.objectContaining({attemptId: "attempt", source: "WORKER", reason: "PROCESS_"+DELIVERY_WORKER_ID})});
    expect(DELIVERY_WORKER_ID).toMatch(/^[0-9a-f-]{36}$/);
  });
});
