import { Prisma } from "@prisma/client";
import { SmsInboundService } from "./sms-inbound.service";
import { deriveDeviceKey, encodeOfflineSos } from "./sms-codec";

jest.mock("./sms-reply", () => ({ sendReceipt: jest.fn(async () => "SENT") }));
import { sendReceipt } from "./sms-reply";

const SECRET = Buffer.alloc(32, 9);
const USER = { id: "11111111-1111-4111-8111-111111111111", role: "USER", isActive: true, accountStatus: "ACTIVE", credentialVersion: 3 };
const NOW = new Date("2026-10-24T03:00:00Z");
const PHONE = "+2348031234567";

function setup(user: Record<string, unknown> | null = USER, key: Record<string, unknown> | null = { keyId: "ABCDEFGH", userId: USER.id, revokedAt: null }) {
  const prisma = {
    inboundMessage: { create: jest.fn(async () => ({ id: "in-1" })), update: jest.fn(async () => ({})), count: jest.fn(async () => 1) },
    user: { findUnique: jest.fn(async () => user) },
    deviceSmsKey: { findUnique: jest.fn(async () => key) },
  };
  const orchestrator = { createCoordinatedIncident: jest.fn(async (..._args: unknown[]) => ({ status: "INCIDENT_ACTIVATED", incident: { id: "incident-1" } })) };
  const config = { getOrThrow: () => "lookup-key" };
  const service = new SmsInboundService(prisma as never, config as never, orchestrator as never);
  return { service, prisma, orchestrator };
}

function signed(overrides: Partial<{ pressedAt: Date; credentialVersion: number }> = {}) {
  const key = deriveDeviceKey(SECRET, "ABCDEFGH", USER.id, overrides.credentialVersion ?? USER.credentialVersion);
  return encodeOfflineSos(
    { activationId: "7a0f9a54-3b8e-4c47-9a39-2f8a6f1c2d11", latitude: 6.48566, longitude: 3.36307, accuracy: 12, pressedAt: overrides.pressedAt ?? new Date(NOW.getTime() - 60_000), silent: true, keyId: "ABCDEFGH" },
    key,
  );
}

beforeEach(() => {
  process.env.SMS_FALLBACK_ENABLED = "true";
  process.env.SMS_SIGNING_SECRET = SECRET.toString("base64");
  jest.clearAllMocks();
});
afterAll(() => {
  delete process.env.SMS_FALLBACK_ENABLED;
  delete process.env.SMS_SIGNING_SECRET;
});

describe("offline SOS by SMS", () => {
  it("does nothing at all while switched off", async () => {
    delete process.env.SMS_FALLBACK_ENABLED;
    const { service, prisma } = setup();
    await expect(service.handle({ id: "m1", from: PHONE, text: signed() }, NOW)).resolves.toBe("DISABLED");
    expect(prisma.inboundMessage.create).not.toHaveBeenCalled();
  });

  it("creates a verified SMS alert with the same activation id, exact GPS and press time, then replies", async () => {
    const { service, orchestrator } = setup();
    await expect(service.handle({ id: "m1", from: PHONE, text: signed() }, NOW)).resolves.toBe("SMS_SIGNED");
    expect(orchestrator.createCoordinatedIncident).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({ activationId: "7a0f9a54-3b8e-4c47-9a39-2f8a6f1c2d11", latitude: 6.48566, longitude: 3.36307, activationMode: "SILENT", pressedAt: "2026-10-24T02:59:00.000Z" }),
      { channel: "SMS", verification: "SMS_SIGNED" },
    );
    expect(sendReceipt).toHaveBeenCalledWith(PHONE, NOW, undefined);
  });

  it("never creates an alert for an unknown, staff or inactive number, and does not reply", async () => {
    for (const user of [null, { ...USER, role: "FACILITY_OPERATOR" }, { ...USER, isActive: false }]) {
      const { service, orchestrator } = setup(user);
      await expect(service.handle({ id: "m1", from: PHONE, text: signed() }, NOW)).resolves.toBe("UNKNOWN_SENDER");
      expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
    }
    expect(sendReceipt).not.toHaveBeenCalled();
  });

  it("downgrades to number-only when the signature does not verify (old password, revoked or other key)", async () => {
    for (const [text, key] of [
      [signed({ credentialVersion: 2 }), { keyId: "ABCDEFGH", userId: USER.id, revokedAt: null }],
      [signed(), { keyId: "ABCDEFGH", userId: USER.id, revokedAt: new Date() }],
      [signed(), { keyId: "ABCDEFGH", userId: "someone-else", revokedAt: null }],
    ] as const) {
      const { service, orchestrator } = setup(USER, key as never);
      await expect(service.handle({ id: "m1", from: PHONE, text }, NOW)).resolves.toBe("SMS_NUMBER_ONLY");
      const dto = orchestrator.createCoordinatedIncident.mock.calls[0]![1] as Record<string, unknown>;
      expect(dto.activationId).toBeUndefined();
      expect(orchestrator.createCoordinatedIncident.mock.calls[0]![2]).toEqual({ channel: "SMS", verification: "SMS_NUMBER_ONLY" });
    }
  });

  it("refuses a signed press older than a day (replay)", async () => {
    const { service, orchestrator } = setup();
    await expect(service.handle({ id: "m1", from: PHONE, text: signed({ pressedAt: new Date(NOW.getTime() - 25 * 3600_000) }) }, NOW)).resolves.toBe("STALE");
    expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
  });

  it("processes each provider message once", async () => {
    const { service, prisma, orchestrator } = setup();
    prisma.inboundMessage.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }));
    await expect(service.handle({ id: "m1", from: PHONE, text: signed() }, NOW)).resolves.toBe("DUPLICATE");
    expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
  });

  it("rate-limits a flood from one number", async () => {
    const { service, prisma, orchestrator } = setup();
    prisma.inboundMessage.count.mockResolvedValueOnce(11);
    await expect(service.handle({ id: "m1", from: PHONE, text: "SOS" }, NOW)).resolves.toBe("RATE_LIMITED");
    expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
  });

  it("accepts a hand-typed SOS from the registered number, without location", async () => {
    const { service, orchestrator } = setup();
    await expect(service.handle({ id: "m1", from: "08031234567", text: "SOS" }, NOW)).resolves.toBe("SMS_NUMBER_ONLY");
    expect(orchestrator.createCoordinatedIncident.mock.calls[0]![1]).not.toHaveProperty("latitude");
  });

  it("ignores ordinary text", async () => {
    const { service, orchestrator } = setup();
    await expect(service.handle({ id: "m1", from: PHONE, text: "hello there" }, NOW)).resolves.toBe("UNRECOGNISED");
    expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
  });
});
