import { applyConsentReply, consentWord, contactPhoneHash, inviteText, replyHint } from "./safewalk-consent";
import { stateOf, SafeWalkContactsService } from "./safewalk-contacts.service";
import { generateShortCode, normalizeGuardianCode, SHORT_CODE_ALPHABET } from "./safewalk-guardian.service";
import { toResults, SafeWalkPlacesService } from "./safewalk-places.service";
import { contactOverdueText, SafeWalkContactNoticeWorker } from "./safewalk-contact-notice.worker";
import { createSafeWalkPlan } from "./safewalk-plan";

const KEY = Buffer.alloc(32, 7).toString("base64");
process.env.PII_LOOKUP_KEY = KEY;
beforeEach(() => {
  process.env.PII_LOOKUP_KEY = KEY;
  delete process.env.AFRICASTALKING_SMS_KEYWORD;
});

describe("consent replies", () => {
  it("only YES and STOP (and close variants) count", () => {
    expect(consentWord("yes")).toBe("YES");
    expect(consentWord(" Y. ")).toBe("YES");
    expect(consentWord("STOP")).toBe("STOP");
    expect(consentWord("no")).toBe("STOP");
    expect(consentWord("SOS")).toBeNull();
    expect(consentWord("yes please help")).toBeNull();
  });

  it("tells the contact the keyword on a shared short code", () => {
    process.env.AFRICASTALKING_SMS_KEYWORD = "opa";
    expect(replyHint("YES")).toBe("OPA YES");
    expect(inviteText("Emma")).toContain("Reply OPA YES to agree or OPA STOP to refuse");
  });

  it("YES answers only a recent invitation, or a contact who changed their mind", async () => {
    const db = { safeWalkContactConsent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const now = new Date("2026-10-25T12:00:00Z");
    await expect(applyConsentReply(db as never, "h", "YES", now)).resolves.toBe("CONSENTED");
    const where = db.safeWalkContactConsent.updateMany.mock.calls[0][0].where;
    expect(where.OR[0].status).toBe("PENDING");
    expect(where.OR[0].invitedAt.gt.getTime()).toBe(now.getTime() - 7 * 24 * 3600_000);
    expect(where.OR[1].status).toBe("DECLINED");
    db.safeWalkContactConsent.updateMany.mockResolvedValue({ count: 0 });
    await expect(applyConsentReply(db as never, "h", "YES", now)).resolves.toBeNull();
  });

  it("STOP withdraws every consent for that number and cancels unsent texts", async () => {
    const db = {
      safeWalkContactConsent: { findMany: jest.fn().mockResolvedValue([{ id: "c1" }, { id: "c2" }]), updateMany: jest.fn() },
      safeWalkContactNotice: { updateMany: jest.fn() },
    };
    await expect(applyConsentReply(db as never, "h", "STOP", new Date())).resolves.toBe("DECLINED");
    expect(db.safeWalkContactNotice.updateMany.mock.calls[0][0]).toMatchObject({ where: { consentId: { in: ["c1", "c2"] }, status: { in: ["SELECTED", "QUEUED"] } }, data: { status: "CANCELLED" } });
  });

  it("a number with no invitation is not a consent reply", async () => {
    const db = { safeWalkContactConsent: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(applyConsentReply(db as never, "h", "STOP", new Date())).resolves.toBeNull();
  });
});

describe("contact state", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const hash = contactPhoneHash("08031234567")!;
  it("hashes Nigerian numbers the same however they are typed", () => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contactPhoneHash("+2348031234567")).toBe(hash);
    expect(contactPhoneHash("not a number")).toBeNull();
  });
  it("is READY only after YES from the current number", () => {
    expect(stateOf(null, hash, now)).toBe("NOT_ASKED");
    expect(stateOf({ status: "CONSENTED", phoneHash: hash, invitedAt: new Date(now) }, hash, now)).toBe("READY");
    expect(stateOf({ status: "CONSENTED", phoneHash: "x".repeat(64), invitedAt: new Date(now) }, hash, now)).toBe("NUMBER_CHANGED");
    expect(stateOf({ status: "PENDING", phoneHash: hash, invitedAt: new Date(now - 3600_000) }, hash, now)).toBe("WAITING");
    expect(stateOf({ status: "PENDING", phoneHash: hash, invitedAt: new Date(now - 8 * 86400_000) }, hash, now)).toBe("NOT_ASKED");
    expect(stateOf({ status: "DECLINED", phoneHash: hash, invitedAt: new Date(now) }, hash, now)).toBe("DECLINED");
  });

  it("does not re-invite a contact who said STOP, and limits invitations", async () => {
    process.env.NODE_ENV = "test";
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "u", role: "USER", isActive: true, accountStatus: "ACTIVE", facilityId: null, facility: null, firstName: "Emma" }) },
      emergencyContact: { findFirst: jest.fn() },
      safeWalkContactConsent: { count: jest.fn().mockResolvedValue(0), upsert: jest.fn() },
    };
    const service = new SafeWalkContactsService(prisma as never);
    prisma.emergencyContact.findFirst.mockResolvedValue({ id: "c", phoneNumber: "08031234567", safeWalkConsent: { status: "DECLINED", phoneHash: hash, invitedAt: new Date(), inviteCount: 1 } });
    await expect(service.invite("u", "c")).rejects.toThrow("replied STOP");
    prisma.emergencyContact.findFirst.mockResolvedValue({ id: "c", phoneNumber: "08031234567", safeWalkConsent: { status: "PENDING", phoneHash: hash, invitedAt: new Date(), inviteCount: 3 } });
    await expect(service.invite("u", "c")).rejects.toThrow("3 times today");
    prisma.emergencyContact.findFirst.mockResolvedValue({ id: "c", phoneNumber: "08031234567", safeWalkConsent: null });
    prisma.safeWalkContactConsent.count.mockResolvedValue(10);
    await expect(service.invite("u", "c")).rejects.toThrow("most invitations");
    expect(prisma.safeWalkContactConsent.upsert).not.toHaveBeenCalled();
  });
});

describe("short guardian codes", () => {
  it("are 8 characters from a read-aloud alphabet", () => {
    const code = generateShortCode();
    expect(code).toHaveLength(8);
    expect([...code].every((c) => SHORT_CODE_ALPHABET.includes(c))).toBe(true);
    expect(SHORT_CODE_ALPHABET).not.toMatch(/[ILOU01]/);
  });
  it("accept spaces, dashes, lower case and the old long codes", () => {
    expect(normalizeGuardianCode("abcd efgh")).toBe("ABCDEFGH");
    expect(normalizeGuardianCode("ABCD-EFGH")).toBe("ABCDEFGH");
    expect(normalizeGuardianCode("a".repeat(64))).toBe("a".repeat(64));
    expect(normalizeGuardianCode("ABCD0FGH")).toBeNull();
    expect(normalizeGuardianCode("ABC")).toBeNull();
  });
});

describe("place search", () => {
  it("keeps only complete results and rounds coordinates", () => {
    expect(
      toResults([
        { id: "p1", displayName: { text: "Berger Bus Stop" }, formattedAddress: "Ojodu, Lagos", location: { latitude: 6.6401234567, longitude: 3.3601234567 } },
        { id: "p2", displayName: { text: "No location" } },
      ]),
    ).toEqual([{ placeId: "p1", name: "Berger Bus Stop", address: "Ojodu, Lagos", latitude: 6.640123, longitude: 3.360123 }]);
  });
  it("is unavailable without a key and limits each person's searches", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.GOOGLE_MAPS_API_KEY;
    const service = new SafeWalkPlacesService();
    await expect(service.search("u", "Shoprite Lekki")).rejects.toThrow("isn't available");
    process.env.GOOGLE_MAPS_API_KEY = "k";
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ places: [] }) } as Response);
    for (let i = 0; i < 20; i++) await service.search("u", "place " + i, undefined, 1000);
    await expect(service.search("u", "place 21", undefined, 1000)).rejects.toThrow("Too many searches");
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.regionCode).toBe("NG");
    // A repeated search is answered from the cache, without calling Google.
    await service.search("u", "PLACE 0", undefined, 2000);
    expect(fetchMock).toHaveBeenCalledTimes(20);
    fetchMock.mockRestore();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });
});

describe("overdue text to a contact", () => {
  it("says who, where, when and the last location, and that it is not an emergency alert", () => {
    const text = contactOverdueText({
      ownerFirstName: "Emma",
      destination: "Shoprite Lekki",
      expectedArrivalAt: new Date("2026-10-25T17:30:00Z"),
      lastFix: { latitude: 6.4401234, longitude: 3.4701234, recordedAt: new Date("2026-10-25T17:20:00Z") },
    });
    expect(text).toBe(
      "OPA SafeWalk: Emma has not confirmed arriving safely at Shoprite Lekki (expected 18:30 WAT). Last location at 18:20 WAT: https://maps.google.com/?q=6.44012,3.47012 Please try to call Emma. This is not an emergency alert.",
    );
  });
});

describe("journey plan", () => {
  it("attaches only contacts whose YES came from their current number", async () => {
    const hash = contactPhoneHash("08031234567")!;
    const tx = {
      safeWalkPlan: { create: jest.fn() },
      emergencyContact: {
        findMany: jest.fn().mockResolvedValue([
          { phoneNumber: "08031234567", safeWalkConsent: { id: "ok", phoneHash: hash } },
          { phoneNumber: "08039999999", safeWalkConsent: { id: "changed", phoneHash: hash } },
        ]),
      },
      safeWalkContactNotice: { createMany: jest.fn() },
    };
    const n = await createSafeWalkPlan(tx as never, "u", "s", { destinationKind: "DESCRIPTION", destinationDescription: "Aunty's house", contactIds: ["a", "a", "b"] } as never);
    expect(n).toBe(1);
    expect(tx.safeWalkPlan.create.mock.calls[0][0].data).toMatchObject({ destinationKind: "DESCRIPTION", destinationDescription: "Aunty's house", placeId: null, arrivalRadiusMeters: 100 });
    expect(tx.emergencyContact.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ["a", "b"] }, userId: "u", isActive: true, safeWalkConsent: { status: "CONSENTED" } });
    expect(tx.safeWalkContactNotice.createMany).toHaveBeenCalledWith({ data: [{ sessionId: "s", consentId: "ok" }] });
  });
});

describe("contact notice worker", () => {
  const hash = () => contactPhoneHash("08031234567")!;
  const setup = (session: Record<string, unknown>, consentStatus = "CONSENTED") => {
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ now: new Date("2026-10-25T12:00:00Z") }]),
      safeWalkContactNotice: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ sessionId: "s", plan: { userId: "u" } })
          .mockResolvedValueOnce({ id: "n", sessionId: "s", status: "QUEUED", attemptCount: 0, nextAttemptAt: new Date("2026-10-25T11:59:00Z"), consent: { status: consentStatus, phoneHash: hash(), emergencyContact: { phoneNumber: "08031234567", isActive: true, userId: "u" } } }),
        update: jest.fn(),
      },
      journeySession: { findUnique: jest.fn().mockResolvedValue({ id: "s", userId: "u", purpose: "SAFEWALK", status: "ACTIVE", redactedAt: null, safeWalkEmergencyIncidentId: null, safetyConfirmedAt: null, arrivalConfirmedAt: null, destinationLabel: "Home", expectedArrivalAt: new Date(), ...session }) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "u", role: "USER", isActive: true, accountStatus: "ACTIVE", facilityId: null, facility: null, firstName: "Emma" }) },
      journeyLocationFix: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx), safeWalkContactNotice: { update: jest.fn() }, safeWalkAudit: { create: jest.fn().mockResolvedValue({}) } };
    const sms = { send: jest.fn().mockResolvedValue({ success: true, provider: "SMS", messageId: "m1" }) };
    return { tx, prisma, sms, worker: new SafeWalkContactNoticeWorker(prisma as never, sms as never) };
  };

  it("sends once to an eligible contact", async () => {
    const { worker, sms, prisma } = setup({});
    await expect(worker.dispatch("n")).resolves.toBe("SENT");
    expect(sms.send).toHaveBeenCalledWith(expect.objectContaining({ recipient: "+2348031234567" }));
    expect(prisma.safeWalkContactNotice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
  });

  it.each([
    ["the person confirmed they are safe", { safetyConfirmedAt: new Date() }, "CONSENTED"],
    ["an SOS took over", { safeWalkEmergencyIncidentId: "i" }, "CONSENTED"],
    ["the journey ended", { status: "ENDED" }, "CONSENTED"],
    ["the contact said STOP", {}, "DECLINED"],
  ])("cancels without texting when %s", async (_label, session, consent) => {
    const { worker, sms, tx } = setup(session, consent);
    await expect(worker.dispatch("n")).resolves.toBe("CANCELLED");
    expect(sms.send).not.toHaveBeenCalled();
    expect(tx.safeWalkContactNotice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }));
  });
});

describe("a missed arrival is never an emergency", () => {
  const { readFileSync } = jest.requireActual("node:fs") as typeof import("node:fs");
  it.each(["safewalk-escalation.service.ts", "safewalk-contact-notice.worker.ts", "safewalk-notification.worker.ts", "safewalk-consent.ts", "safewalk-contacts.service.ts", "safewalk-plan.ts"])(
    "%s never creates an incident or reaches facility operators",
    (file) => {
      const source = readFileSync(__dirname + "/" + file, "utf8");
      expect(source).not.toMatch(/incident\.(create|upsert)|IncidentOrchestrator|createCoordinatedIncident|facilityId:\s*\{|FACILITY_OPERATOR/);
    },
  );
});
