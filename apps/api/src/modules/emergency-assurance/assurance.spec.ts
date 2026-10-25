jest.mock("../emergency-delivery/sms-reply", () => ({ sendFromShortcode: jest.fn(async () => "SENT") }));
import { sendFromShortcode } from "../emergency-delivery/sms-reply";
import { ackWord, applyAssuranceReply, askText, reminderText, securityEscalationText, timings } from "./assurance-policy";
import { EmergencyAssuranceWorker } from "./assurance.worker";
import { voiceResponse } from "./voice-callback";
import { contactPhoneHash } from "../journey/safewalk-consent";

process.env.PII_LOOKUP_KEY = Buffer.alloc(32, 7).toString("base64");
const NOW = new Date("2026-10-25T12:00:00Z");
const PHONE = "08031234567";
const hash = () => contactPhoneHash(PHONE)!;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AFRICASTALKING_SMS_KEYWORD;
  for (const k of ["ASSURANCE_REMINDER_MINUTES", "ASSURANCE_VOICE_MINUTES", "SECURITY_ACK_ESCALATION_MINUTES", "ASSURANCE_VOICE_ENABLED", "AFRICASTALKING_VOICE_NUMBER", "AFRICASTALKING_VOICE_CALLBACK_URL"]) delete process.env[k];
  process.env.EMERGENCY_ASSURANCE_ENABLED = "true";
  process.env.SECURITY_ESCALATION_ENABLED = "true";
});

describe("policy", () => {
  it("defaults: reminder at 3 min, call at 5, security escalation at 2; bounded overrides", () => {
    expect(timings()).toEqual({ reminderMs: 180_000, voiceMs: 300_000, securityAckMs: 120_000 });
    process.env.ASSURANCE_REMINDER_MINUTES = "0";
    expect(timings().reminderMs).toBe(180_000);
  });
  it("OK means seen; SOS, YES and STOP do not", () => {
    for (const w of ["ok", "OK.", "Okay", "seen"]) expect(ackWord(w)).toBe(true);
    for (const w of ["SOS", "yes", "stop", "ok help"]) expect(ackWord(w)).toBe(false);
  });
  it("texts carry only a first name and the reply word", () => {
    process.env.AFRICASTALKING_SMS_KEYWORD = "opa";
    expect(askText("Emma")).toBe("OPA: you have just been sent an emergency alert about Emma. Reply OPA OK when you have seen it.");
    expect(reminderText("Emma", "https://opasafety.com/i/abc")).toContain("Live location: https://opasafety.com/i/abc");
    expect(securityEscalationText("Quartz", 2)).toBe("OPA: an SOS at Quartz has not been acknowledged for 2 minutes. Open the Command Center now.");
  });
  it("an OK confirms every recent alert to that number and says whether it already ended", async () => {
    const db = { incidentContactAssurance: { findMany: jest.fn().mockResolvedValue([{ id: "a", confirmedAt: null, closedAt: null }, { id: "b", confirmedAt: new Date(), closedAt: null }]), updateMany: jest.fn() } };
    await expect(applyAssuranceReply(db as never, "h", NOW)).resolves.toEqual({ confirmed: 1, active: true });
    expect(db.incidentContactAssurance.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] }, confirmedAt: null }, data: { confirmedAt: NOW, confirmedVia: "SMS_REPLY" } });
    db.incidentContactAssurance.findMany.mockResolvedValue([]);
    await expect(applyAssuranceReply(db as never, "h", NOW)).resolves.toBeNull();
  });
});

function prismaMock() {
  return {
    incident: { findMany: jest.fn().mockResolvedValue([]) },
    emergencyContact: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ phoneNumber: PHONE }) },
    incidentContactAssurance: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
    incidentSecurityEscalation: { create: jest.fn(), update: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
}
const smsMock = () => ({ send: jest.fn().mockResolvedValue({ success: true, provider: "SMS" }) });

describe("worker", () => {
  it("does nothing at all while switched off", async () => {
    delete process.env.EMERGENCY_ASSURANCE_ENABLED;
    delete process.env.SECURITY_ESCALATION_ENABLED;
    const prisma = prismaMock();
    await new EmergencyAssuranceWorker(prisma as never, smsMock() as never).tick();
    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });

  it("seeds one row per contact who was texted, by relationship and phone hash only", async () => {
    const prisma = prismaMock();
    prisma.incident.findMany.mockResolvedValueOnce([{ id: "i1", notifications: [{ contactId: "c1" }, { contactId: "c1" }] }]);
    prisma.emergencyContact.findMany.mockResolvedValue([{ id: "c1", phoneNumber: PHONE, relationship: "Sister" }]);
    await new EmergencyAssuranceWorker(prisma as never, smsMock() as never).seed(NOW);
    expect(prisma.incidentContactAssurance.createMany).toHaveBeenCalledWith({ data: [{ incidentId: "i1", emergencyContactId: "c1", phoneHash: hash(), relationship: "Sister" }], skipDuplicates: true });
  });

  it("asks each contact once; a second worker that loses the claim sends nothing", async () => {
    const prisma = prismaMock();
    prisma.incidentContactAssurance.findMany.mockResolvedValue([{ id: "r1", emergencyContactId: "c1", phoneHash: hash(), incident: { user: { firstName: "Emma" } } }]);
    const worker = new EmergencyAssuranceWorker(prisma as never, smsMock() as never);
    await worker.ask(NOW);
    expect(sendFromShortcode).toHaveBeenCalledWith("+2348031234567", expect.stringContaining("Emma"));
    prisma.incidentContactAssurance.updateMany.mockResolvedValue({ count: 0 });
    await worker.ask(NOW);
    expect(sendFromShortcode).toHaveBeenCalledTimes(1);
  });

  it("never texts a number that changed after the alert", async () => {
    const prisma = prismaMock();
    prisma.emergencyContact.findUnique.mockResolvedValue({ phoneNumber: "08039999999" });
    prisma.incidentContactAssurance.findMany.mockResolvedValue([{ id: "r1", emergencyContactId: "c1", phoneHash: hash(), incident: { user: { firstName: "Emma" } } }]);
    await new EmergencyAssuranceWorker(prisma as never, smsMock() as never).ask(NOW);
    expect(sendFromShortcode).not.toHaveBeenCalled();
  });

  it("reminds only when nobody has confirmed, and only for open incidents in the window", async () => {
    const prisma = prismaMock();
    await new EmergencyAssuranceWorker(prisma as never, smsMock() as never).remindAndCall(NOW);
    const where = prisma.incident.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["OPEN", "ACKNOWLEDGED"] });
    expect(where.contactAssurances).toEqual({ some: {}, none: { confirmedAt: { not: null } } });
    expect(where.createdAt.lte).toEqual(new Date(NOW.getTime() - 180_000));
  });

  it("sends the reminder with the live link, then calls only when voice is configured", async () => {
    const prisma = prismaMock();
    const incident = (row: object) => [{ id: "i1", createdAt: new Date(NOW.getTime() - 360_000), user: { firstName: "Emma" }, contactAssurances: [{ id: "r1", emergencyContactId: "c1", phoneHash: hash(), ...row }], notifications: [{ contactId: "c1", payload: { trackingUrl: "https://opasafety.com/i/tok" } }] }];
    prisma.incident.findMany.mockResolvedValueOnce(incident({ reminderSentAt: null, voiceCallAt: null }));
    const worker = new EmergencyAssuranceWorker(prisma as never, smsMock() as never);
    await worker.remindAndCall(NOW);
    expect(sendFromShortcode).toHaveBeenCalledWith("+2348031234567", expect.stringContaining("https://opasafety.com/i/tok"));
    prisma.incident.findMany.mockResolvedValueOnce(incident({ reminderSentAt: NOW, voiceCallAt: null }));
    await worker.remindAndCall(NOW);
    expect(prisma.incidentContactAssurance.update).not.toHaveBeenCalled(); // voice not configured: no call
  });

  it("security escalation: Facility Admins once, for an SOS nobody acknowledged", async () => {
    const prisma = prismaMock();
    prisma.incident.findMany.mockResolvedValueOnce([{ id: "i1", createdAt: new Date(NOW.getTime() - 150_000), facilityId: "f1", facility: { name: "Quartz" } }]);
    prisma.user.findMany.mockResolvedValue([{ phoneNumber: "+2348030000001" }, { phoneNumber: "+2348030000002" }]);
    const sms = smsMock();
    await new EmergencyAssuranceWorker(prisma as never, sms as never).escalateUnacknowledged(NOW);
    const where = prisma.incident.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("OPEN");
    expect(where.securityEscalation).toBeNull();
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ facilityId: "f1", role: "FACILITY_ADMIN", membershipState: "ACTIVE" });
    expect(sms.send).toHaveBeenCalledTimes(2);
    expect(sms.send.mock.calls[0][0].message).toBe("OPA: an SOS at Quartz has not been acknowledged for 3 minutes. Open the Command Center now.");
    expect(prisma.incidentSecurityEscalation.update).toHaveBeenCalledWith({ where: { incidentId: "i1" }, data: { sent: 2 } });
  });

  it("security escalation is recorded before sending, so a duplicate worker sends nothing", async () => {
    const { Prisma } = jest.requireActual("@prisma/client");
    const prisma = prismaMock();
    prisma.incident.findMany.mockResolvedValueOnce([{ id: "i1", createdAt: new Date(NOW.getTime() - 150_000), facilityId: "f1", facility: { name: "Quartz" } }]);
    prisma.user.findMany.mockResolvedValue([{ phoneNumber: "+2348030000001" }]);
    prisma.incidentSecurityEscalation.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    const sms = smsMock();
    await new EmergencyAssuranceWorker(prisma as never, sms as never).escalateUnacknowledged(NOW);
    expect(sms.send).not.toHaveBeenCalled();
  });
});

describe("voice callback", () => {
  it("speaks a first name only, and records 1 as confirmation", async () => {
    process.env.AFRICASTALKING_VOICE_CALLBACK_URL = "https://api.example/integrations/africastalking/voice/tok";
    const prisma = { incidentContactAssurance: { findFirst: jest.fn().mockResolvedValue({ incident: { user: { firstName: "Emma" } } }), findMany: jest.fn().mockResolvedValue([{ id: "a", confirmedAt: null, closedAt: null }]), updateMany: jest.fn() } };
    const xml = await voiceResponse(prisma as never, { isActive: "1", destinationNumber: "+2348031234567" }, NOW);
    expect(xml).toContain("Emma may be in danger");
    expect(xml).toContain('callbackUrl="https://api.example/integrations/africastalking/voice/tok"');
    const done = await voiceResponse(prisma as never, { isActive: "1", destinationNumber: "+2348031234567", dtmfDigits: "1" }, NOW);
    expect(done).toContain("Thank you");
    expect(prisma.incidentContactAssurance.updateMany.mock.calls[0][0].data.confirmedVia).toBe("VOICE_KEYPRESS");
  });
  it("says nothing to a number OPA did not call", async () => {
    const prisma = { incidentContactAssurance: { findFirst: jest.fn().mockResolvedValue(null) } };
    expect(await voiceResponse(prisma as never, { isActive: "1", destinationNumber: "+2348031234567" }, NOW)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  });
});
