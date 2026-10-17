import { ConfigService } from "@nestjs/config";
import { ConflictException, ForbiddenException, HttpException, NotFoundException } from "@nestjs/common";
import { EstateService, maskPhone, startOfWatDay } from "./estate.service";
import { normalizeVisitorCode, protectVisitor, revealVisitor, visitorCodeDigest } from "./estate-crypto";

const KEY = "ab".repeat(32);
const config = new ConfigService({ ENROLLMENT_ENCRYPTION_KEY: KEY });
const ESTATE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const resident = { id: "res", role: "USER", isActive: true, accountStatus: "ACTIVE", membershipState: "ACTIVE", facilityId: ESTATE };

function pass(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "33333333-3333-4333-8333-333333333333",
    facilityId: ESTATE,
    hostUserId: "res",
    visitorCiphertext: protectVisitor(KEY, { name: "Chidi Okafor", phone: "+2348012345678" }),
    destination: "Block C, House 12",
    codeDigest: visitorCodeDigest(KEY, ESTATE, "482913"),
    validFrom: new Date(now - 60_000),
    validUntil: new Date(now + 3_600_000),
    expectedMinutes: 240,
    status: "ISSUED",
    checkedInAt: null,
    checkedOutAt: null,
    overstayAlertedAt: null,
    ...over,
  };
}

function setup(over: { user?: unknown; failures?: number; found?: unknown } = {}) {
  const created: unknown[] = [];
  const events: { type: string; note?: string }[] = [];
  const tx = {
    $queryRaw: jest.fn(),
    visitorPass: { findUnique: jest.fn().mockResolvedValue(over.found ?? pass()), update: jest.fn(async ({ data }) => ({ ...pass(), ...data })) },
    gateEvent: { create: jest.fn(async ({ data }) => { events.push(data); return data; }) },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue("user" in over ? over.user : resident) },
    facility: { findUniqueOrThrow: jest.fn().mockResolvedValue({ visitorDefaultMinutes: 240, isActive: true }) },
    visitorPass: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }) => { created.push(data); return { ...pass(), ...data, id: "new" }; }),
      findFirst: jest.fn().mockResolvedValue("found" in over ? over.found : pass()),
      updateMany: jest.fn(),
    },
    gateEvent: {
      count: jest.fn().mockResolvedValue(over.failures ?? 0),
      create: jest.fn(async ({ data }) => { events.push(data); return data; }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { service: new EstateService(prisma as never, config), prisma, tx, created, events };
}

describe("EstateFlow codes", () => {
  it("are six digits, forgiving spaces and dashes", () => {
    expect(normalizeVisitorCode(" 482-913 ")).toBe("482913");
    expect(normalizeVisitorCode("48291")).toBeNull();
    expect(normalizeVisitorCode("48291a")).toBeNull();
  });
  it("are scoped to the estate", () => {
    expect(visitorCodeDigest(KEY, ESTATE, "482913")).not.toBe(visitorCodeDigest(KEY, OTHER, "482913"));
  });
  it("keep the visitor's identity encrypted at rest", () => {
    const c = protectVisitor(KEY, { name: "Chidi Okafor" });
    expect(c).not.toContain("Chidi");
    expect(revealVisitor(KEY, c).name).toBe("Chidi Okafor");
  });
  it("mask the visitor's phone for the guard", () => {
    expect(maskPhone("+2348012345678")).toBe("•••• 5678");
  });
  it("count 'today' in Nigerian time", () => {
    expect(startOfWatDay(new Date("2026-10-17T23:30:00Z")).toISOString()).toBe("2026-10-17T23:00:00.000Z");
    expect(startOfWatDay(new Date("2026-10-17T22:30:00Z")).toISOString()).toBe("2026-10-16T23:00:00.000Z");
  });
});

describe("resident passes", () => {
  it("are only for active estate residents", async () => {
    for (const user of [null, { ...resident, role: "FACILITY_OPERATOR" }, { ...resident, facilityId: null }, { ...resident, isActive: false }]) {
      const { service } = setup({ user });
      await expect(service.myPasses("res")).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
  it("return a six-digit code once and store only its digest and an encrypted name", async () => {
    const { service, created } = setup();
    const result = await service.createPass("res", { visitorName: "Chidi Okafor", destination: "Block C, House 12" });
    expect(result.code).toMatch(/^\d{6}$/);
    const row = created[0] as { codeDigest: string; visitorCiphertext: string; expectedMinutes: number; facilityId: string };
    expect(row.codeDigest).toBe(visitorCodeDigest(KEY, ESTATE, result.code));
    expect(row.visitorCiphertext).not.toContain("Chidi");
    expect(row.expectedMinutes).toBe(240);
    expect(row.facilityId).toBe(ESTATE);
  });
});

describe("gate verification", () => {
  it("finds the live pass and shows the guard what to do next", async () => {
    const { service, prisma, events } = setup();
    const { pass: view } = await service.verify("guard", ESTATE, "482 913");
    expect(prisma.visitorPass.findFirst).toHaveBeenCalledWith({
      where: { facilityId: ESTATE, codeDigest: visitorCodeDigest(KEY, ESTATE, "482913"), status: { in: ["ISSUED", "CHECKED_IN"] } },
    });
    expect(view).toMatchObject({ action: "ADMIT", visitorName: "Chidi Okafor", visitorPhone: "•••• 5678", destination: "Block C, House 12" });
    expect(events.map((e) => e.type)).toEqual(["VERIFIED"]);
  });
  it("records a failure for an unknown code", async () => {
    const { service, events } = setup({ found: null });
    await expect(service.verify("guard", ESTATE, "000000")).rejects.toBeInstanceOf(NotFoundException);
    expect(events.map((e) => e.type)).toEqual(["VERIFY_FAILED"]);
  });
  it("stops guessing after repeated wrong codes", async () => {
    const { service, prisma } = setup({ failures: 10 });
    const attempt = service.verify("guard", ESTATE, "482913");
    await expect(attempt).rejects.toBeInstanceOf(HttpException);
    await attempt.catch((e: HttpException) => expect(e.getStatus()).toBe(429));
    expect(prisma.visitorPass.findFirst).not.toHaveBeenCalled();
  });
  it("offers exit for a visitor already inside", async () => {
    const { service } = setup({ found: pass({ status: "CHECKED_IN", checkedInAt: new Date() }) });
    expect((await service.verify("guard", ESTATE, "482913")).pass.action).toBe("EXIT");
  });
});

describe("gate decisions", () => {
  it("admit an issued pass and log the entry", async () => {
    const { service, events } = setup();
    const { pass: view } = await service.admit("guard", ESTATE, pass().id);
    expect(view.status).toBe("CHECKED_IN");
    expect(events.map((e) => e.type)).toEqual(["ENTRY"]);
  });
  it("never act on another estate's pass", async () => {
    const { service } = setup({ found: pass({ facilityId: OTHER }) });
    await expect(service.admit("guard", ESTATE, pass().id)).rejects.toBeInstanceOf(NotFoundException);
  });
  it("refuse to admit twice or to exit someone not inside", async () => {
    const inside = setup({ found: pass({ status: "CHECKED_IN", checkedInAt: new Date() }) });
    await expect(inside.service.admit("guard", ESTATE, pass().id)).rejects.toBeInstanceOf(ConflictException);
    const issued = setup();
    await expect(issued.service.exit("guard", ESTATE, pass().id)).rejects.toBeInstanceOf(ConflictException);
  });
  it("refuse an expired pass at the gate", async () => {
    const { service } = setup({ found: pass({ validUntil: new Date(Date.now() - 1000) }) });
    await expect(service.admit("guard", ESTATE, pass().id)).rejects.toBeInstanceOf(ConflictException);
  });
});
