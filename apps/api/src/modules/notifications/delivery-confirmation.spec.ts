import { redactSensitivePath } from "../../shared/middleware/request-logging.middleware";
import { maskDeliveryRecipient } from "./delivery-recipient";
import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Webhook } from "standardwebhooks";
import { ResendReceiptVerifier } from "./delivery-receipt.controller";
import {
  DeliveryReadController,
  DeliveryReadService,
  deliveryProjection,
} from "./delivery-read.controller";
import { IncidentAccessGuard } from "../../shared/guards/incident-access.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { httpFailure, receiptStatus, retryDelay } from "./delivery-policy";

const secret = "whsec_" + Buffer.alloc(32, 7).toString("base64");
function signed(
  type = "email.delivered",
  seconds = Math.floor(Date.now() / 1000),
) {
  const raw = Buffer.from(
    JSON.stringify({
      type,
      created_at: new Date().toISOString(),
      data: {
        email_id: "email-1",
        to: ["private@example.test"],
        vendor_secret: "not-for-output",
      },
    }),
  );
  const id = "event-1";
  return {
    raw,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(seconds),
      "svix-signature": new Webhook(secret).sign(
        id,
        new Date(seconds * 1000),
        raw.toString(),
      ),
    },
  };
}

describe("delivery receipt authenticity and semantics", () => {
  const verifier = new ResendReceiptVerifier();
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
  });
  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });
  it("accepts valid provider evidence and strips recipient/vendor payload", () => {
    const s = signed();
    const result = verifier.verify(s.raw, s.headers);
    expect(result?.status).toBe("DELIVERED");
    expect(JSON.stringify(result)).not.toMatch(
      /private@|vendor_secret|not-for-output/,
    );
  });
  it("maps acceptance to PROVIDER_ACCEPTED only", () => {
    const s = signed("email.sent");
    expect(verifier.verify(s.raw, s.headers)?.status).toBe("PROVIDER_ACCEPTED");
  });
  it("does not invent READ from open events", () => {
    const s = signed("email.opened");
    expect(verifier.verify(s.raw, s.headers)).toBeNull();
  });
  it("rejects a tampered raw body", () => {
    const s = signed();
    expect(() =>
      verifier.verify(
        Buffer.from(s.raw.toString().replace("email-1", "email-2")),
        s.headers,
      ),
    ).toThrow("Invalid delivery receipt signature");
  });
  it.each([-600, 600])("rejects replay/future envelope offset %s", (offset) => {
    const s = signed("email.delivered", Math.floor(Date.now() / 1000) + offset);
    expect(() => verifier.verify(s.raw, s.headers)).toThrow(
      "Invalid delivery receipt signature",
    );
  });
  it("rejects missing signature and oversized body", () => {
    expect(() => verifier.verify(Buffer.from("{}"), {})).toThrow();
    expect(() => verifier.verify(Buffer.alloc(65_537), {})).toThrow();
  });
  it("fails closed when verification is unconfigured", () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const s = signed();
    expect(() => verifier.verify(s.raw, s.headers)).toThrow("not configured");
  });
});

describe("delivery projection and policy", () => {
  it.each([
    "QUEUED",
    "ATTEMPTING",
    "PROVIDER_ACCEPTED",
    "FAILED",
    "UNKNOWN",
  ] as const)("never regresses delivered to %s", (incoming) => {
    expect(receiptStatus("DELIVERED", incoming)).toBe("DELIVERED");
  });
  it("late delivered strengthens failed; late acceptance does not erase failed", () => {
    expect(receiptStatus("FAILED", "DELIVERED")).toBe("DELIVERED");
    expect(receiptStatus("FAILED", "PROVIDER_ACCEPTED")).toBe("FAILED");
  });
  it("bounds retries and refuses non-retryable errors", () => {
    expect(retryDelay(1, true)).toBeGreaterThanOrEqual(60_000);
    expect(retryDelay(4, true)).toBeLessThan(3_615_000);
    expect(retryDelay(5, true)).toBeNull();
    expect(retryDelay(1, false)).toBeNull();
    expect(httpFailure(429)).toEqual({
      failureCategory: "RATE_LIMITED",
      retryable: true,
    });
    expect(httpFailure(422).retryable).toBe(false);
    expect(httpFailure(503)).toEqual({
      failureCategory: "PROVIDER_UNAVAILABLE",
      retryable: false,
      uncertain: true,
    });
  });
  it("attaches existing JWT and incident authorization guards", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DeliveryReadController),
    ).toEqual([JwtAuthGuard, IncidentAccessGuard]);
  });
  it("bounds and incident-scopes database reads, without selecting names, payloads or provider diagnostics", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new DeliveryReadService({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          isActive: true,
          accountStatus: "ACTIVE",
          role: "USER",
        }),
      },
      incident: {
        findFirst: jest.fn().mockResolvedValue({ id: "incident-1" }),
      },
      incidentNotification: { findMany },
    } as never).forActorIncident("actor-1", "incident-1", "cursor");
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      incidentId: "incident-1",
      incident: { userId: "actor-1" },
      id: { gt: "cursor" },
    });
    expect(args.take).toBe(51);
    expect(JSON.stringify(args.select)).not.toMatch(
      /contactName|payload|lastError|references/,
    );
  });
  it("exposes unknown/acceptance uncertainty, masked identity and truthful reporting", () => {
    const queuedAt = new Date("2026-09-01T00:00:00Z");
    const firstAttemptAt = new Date(queuedAt.getTime() + 1_000);
    const row = {
      id: "id",
      channel: "SMS",
      deliveryStatus: "PROVIDER_ACCEPTED",
      queuedAt,
      firstAttemptAt,
      lastAttemptAt: firstAttemptAt,
      providerAcceptedAt: new Date(queuedAt.getTime() + 2_000),
      confirmedDeliveredAt: null,
      attemptCount: 1,
      failureCategory: null,
      updatedAt: firstAttemptAt,
      status: "SENT",
      nextAttemptAt: queuedAt,
      recipient: "private@example.test",
      lastError: "secret",
      _count: { deliveryEvents: 1 },
      deliveryAttempts: [
        {
          number: 1,
          status: "PROVIDER_ACCEPTED",
          startedAt: firstAttemptAt,
          completedAt: firstAttemptAt,
          providerAcceptedAt: firstAttemptAt,
          deliveredAt: null,
          failureCategory: null,
          _count: { events: 0 },
        },
      ],
    };
    const result = deliveryProjection(row as never);
    expect(result.deliveredAt).toBeNull();
    expect(result.hasUnconfirmedOutcome).toBe(true);
    expect(result.latencyMs.queueToProviderAcceptance).toBe(2000);
    expect(result.recipient.maskedIdentity).toContain("••••");
    expect(JSON.stringify(result)).not.toMatch(/private@|secret/);
  });
});

describe("recipient masking boundary", () => {
  it("masks phone/email and suppresses opaque push tokens", () => {
    expect(maskDeliveryRecipient("SMS", "+2348012345678")).toBe("••••5678");
    expect(maskDeliveryRecipient("EMAIL", "alice@example.test")).toBe(
      "a••••@••••",
    );
    expect(maskDeliveryRecipient("PUSH", "sensitive-fcm-token")).toBe("••••");
  });
});

describe("receipt log sanitization", () => {
  it("removes callback query PII and credential-bearing suffixes", () => {
    expect(
      redactSensitivePath(
        "/notifications/provider-receipts/africastalking?phone=private&token=secret",
      ),
    ).toBe("/notifications/provider-receipts/<redacted>");
  });
});
