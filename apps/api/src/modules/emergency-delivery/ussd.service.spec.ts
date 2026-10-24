import { UssdService, sessionActivationId } from "./ussd.service";

const USER = { id: "11111111-1111-4111-8111-111111111111", role: "USER", isActive: true, accountStatus: "ACTIVE", preferredLanguage: null };
const NOW = new Date("2026-10-24T03:00:00Z");

function setup(user: Record<string, unknown> | null = USER, existingIncident: string | null = null) {
  const session = { id: "s-1", msisdnHash: "", incidentId: existingIncident };
  const prisma = {
    user: { findUnique: jest.fn(async () => user), update: jest.fn(async () => ({})) },
    ussdSession: {
      upsert: jest.fn(async ({ create }: { create: { msisdnHash: string } }) => ({ ...session, msisdnHash: create.msisdnHash })),
      update: jest.fn(async () => ({})),
      count: jest.fn(async () => 0),
    },
    savedPlace: { findMany: jest.fn(async () => [{ label: "Home", description: "Bk 30", latitude: null, longitude: null }, { label: "Farm", description: null, latitude: null, longitude: null }]) },
    journeyLocationFix: { findFirst: jest.fn(async () => null) },
  };
  const orchestrator = { createCoordinatedIncident: jest.fn(async () => ({ incident: { id: "incident-1" } })) };
  const timeline = { recordEvent: jest.fn(async () => ({})) };
  const service = new UssdService(prisma as never, { getOrThrow: () => "lookup-key" } as never, orchestrator as never, timeline as never);
  const say = (text: string) => service.handle({ sessionId: "AT-1", phoneNumber: "+2348031234567", text }, NOW);
  return { service, prisma, orchestrator, timeline, say };
}

beforeEach(() => {
  process.env.USSD_ENABLED = "true";
  delete process.env.USSD_LANGUAGES;
});
afterAll(() => delete process.env.USSD_ENABLED);

describe("USSD SOS", () => {
  it("is unavailable while switched off", async () => {
    delete process.env.USSD_ENABLED;
    const { say, orchestrator } = setup();
    await expect(say("1*1")).resolves.toMatch(/^END .*not available/);
    expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
  });

  it("shows English only until Hausa is reviewed and switched on", async () => {
    const { say } = setup();
    await expect(say("")).resolves.toBe("CON OPA\n1 Send SOS");
    process.env.USSD_LANGUAGES = "en,ha";
    await expect(setup().say("")).resolves.toBe("CON OPA\n1 Send SOS\n2 Language");
  });

  it("asks for confirmation, and cancel sends nothing", async () => {
    const { say, orchestrator } = setup();
    await expect(say("1")).resolves.toBe("CON Send SOS now?\n1 Yes, send\n2 Cancel");
    await expect(say("1*2")).resolves.toMatch(/^END Cancelled/);
    expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
  });

  it("creates the alert at 'Yes, send' with a stable activation id, then asks where", async () => {
    const { say, orchestrator } = setup();
    await expect(say("1*1")).resolves.toBe("CON SOS sent. Where are you?\n1 Home\n2 Farm\n9 Somewhere else\n0 Skip");
    expect(orchestrator.createCoordinatedIncident).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({ activationId: sessionActivationId("AT-1"), activationSource: "USSD" }),
      { channel: "USSD", verification: "USSD_NUMBER" },
    );
  });

  it("does not create a second alert on later steps of the same session", async () => {
    const { say, orchestrator, timeline } = setup(USER, "incident-1");
    await expect(say("1*1*1")).resolves.toBe("CON Can security call you?\n1 Yes\n2 No, I can't talk");
    expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
    expect(timeline.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ incidentId: "incident-1", type: "USSD_LOCATION", payload: expect.objectContaining({ source: "SAVED_PLACE", label: "Home", verified: false }) }));
  });

  it("records a typed landmark as unverified and the can't-talk choice", async () => {
    const { say, timeline } = setup(USER, "incident-1");
    await expect(say("1*1*9")).resolves.toMatch(/^CON Type a landmark/);
    await expect(say("1*1*9*near Kofar Mata mosque")).resolves.toMatch(/^CON Can security call you/);
    await expect(say("1*1*9*near Kofar Mata mosque*2")).resolves.toMatch(/^END .*will not call you/);
    expect(timeline.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "USSD_LOCATION", payload: { source: "TYPED_LANDMARK", landmark: "near Kofar Mata mosque", verified: false } }));
    expect(timeline.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "USSD_CALLBACK_PREFERENCE", payload: { canCall: false } }));
  });

  it("never creates an alert for unregistered numbers or staff", async () => {
    for (const user of [null, { ...USER, role: "ADMIN" }, { ...USER, accountStatus: "PENDING_ACTIVATION" }]) {
      const { say, orchestrator } = setup(user);
      await expect(say("1*1")).resolves.toMatch(/^END This number is not registered/);
      expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
    }
  });

  it("limits repeated SOS sessions from one number", async () => {
    const { say, prisma, orchestrator } = setup();
    prisma.ussdSession.count.mockResolvedValueOnce(3);
    await expect(say("1*1")).resolves.toMatch(/^END Your alert is already active/);
    expect(orchestrator.createCoordinatedIncident).not.toHaveBeenCalled();
  });

  it("derives a valid, stable UUID v4 per session", () => {
    expect(sessionActivationId("AT-1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sessionActivationId("AT-1")).toBe(sessionActivationId("AT-1"));
    expect(sessionActivationId("AT-2")).not.toBe(sessionActivationId("AT-1"));
  });
});
