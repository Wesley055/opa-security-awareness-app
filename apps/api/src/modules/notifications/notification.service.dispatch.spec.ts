import { NotificationService } from "./notification.service";
import { NotificationChannel } from "./dto/send-notification.dto";
import { buildNotificationPayload } from "./notification-payload";

describe("NotificationService audited dispatch", () => {
  const prisma = {
    incidentNotification: { findUnique: jest.fn(), create: jest.fn() },
  };
  const ledger = { claimIncident: jest.fn(), complete: jest.fn() };
  const provider = { send: jest.fn() };
  let service: NotificationService;
  beforeEach(() => {
    jest.resetAllMocks();
    ledger.claimIncident.mockResolvedValue({
      id: "attempt-1",
      provider: "AFRICASTALKING",
    });
    ledger.complete.mockResolvedValue(undefined);
    prisma.incidentNotification.findUnique.mockResolvedValue({
      channel: "SMS",
      recipient: "+2348012345678",
      payload: buildNotificationPayload({
        channel: NotificationChannel.SMS,
        recipient: "+2348012345678",
        personName: "Test",
        location: "Unknown",
        trackingUrl: "https://example.test/i/token",
      }),
    });
    service = new NotificationService(
      prisma as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      undefined,
      ledger as never,
    );
  });
  it("does not send when another worker owns the claim", async () => {
    ledger.claimIncident.mockResolvedValue(null);
    expect(await service.dispatchNotification("id")).toBeNull();
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("dispatches the durable payload and completes the precise attempt", async () => {
    const response = { success: true, provider: "SMS", messageId: "ref" };
    provider.send.mockResolvedValue(response);
    await service.dispatchNotification("id");
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "+2348012345678" }),
    );
    expect(ledger.complete).toHaveBeenCalledWith("attempt-1", response);
  });
  it.each([null, { version: 99 }])(
    "audits invalid payload %s without sending",
    async (payload) => {
      prisma.incidentNotification.findUnique.mockResolvedValue({ payload });
      await service.dispatchNotification("id");
      expect(provider.send).not.toHaveBeenCalled();
      expect(ledger.complete).toHaveBeenCalledWith(
        "attempt-1",
        expect.objectContaining({
          success: false,
          failureCategory: "INTERNAL_ERROR",
          retryable: false,
        }),
      );
    },
  );
  it.each([
    { channel: "EMAIL" },
    { recipient: "+2348000000000" },
    {
      payload: {
        channel: "SMS",
        recipient: "+2348012345678",
        message: " ",
        subject: "Alert",
        version: 1,
      },
    },
  ])(
    "fails inconsistent recipient/channel/payload snapshots before transport: %j",
    async (override) => {
      const row = await prisma.incidentNotification.findUnique();
      prisma.incidentNotification.findUnique.mockResolvedValue({
        ...row,
        ...override,
      });
      await service.dispatchNotification("id");
      expect(provider.send).not.toHaveBeenCalled();
      expect(ledger.complete).toHaveBeenCalledWith(
        "attempt-1",
        expect.objectContaining({
          success: false,
          failureCategory: "INTERNAL_ERROR",
          retryable: false,
        }),
      );
    },
  );

  it("records thrown transport errors as uncertain, without raw error strings", async () => {
    provider.send.mockRejectedValue(new Error("secret recipient"));
    await service.dispatchNotification("id");
    expect(ledger.complete).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({ uncertain: true }),
    );
    expect(JSON.stringify(ledger.complete.mock.calls)).not.toContain(
      "secret recipient",
    );
  });
  it("propagates database completion failure without a second send", async () => {
    provider.send.mockResolvedValue({ success: true, provider: "SMS" });
    ledger.complete.mockRejectedValue(new Error("database unavailable"));
    await expect(service.dispatchNotification("id")).rejects.toThrow(
      "database unavailable",
    );
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it("records an uncertain timeout and bounds worker waiting", async () => {
    jest.useFakeTimers();
    try {
      provider.send.mockReturnValue(new Promise(() => undefined));
      const pending = service.dispatchNotification("id");
      await jest.advanceTimersByTimeAsync(30_001);
      await pending;
      expect(ledger.complete).toHaveBeenCalledWith(
        "attempt-1",
        expect.objectContaining({
          uncertain: true,
          failureCategory: "TIMEOUT",
          retryable: false,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("late provider evidence", () => {
  it("preserves a success that arrives after the worker timeout", async () => {
    const { dispatchWithEvidence } = await import("./delivery-dispatch");
    jest.useFakeTimers();
    try {
      let resolve!: (response: {
        success: boolean;
        provider: string;
        messageId: string;
      }) => void;
      const send = () =>
        new Promise<{ success: boolean; provider: string; messageId: string }>(
          (r) => {
            resolve = r;
          },
        );
      const record = jest.fn().mockResolvedValue(undefined);
      const pending = dispatchWithEvidence("SMS", send, record);
      await jest.advanceTimersByTimeAsync(30_001);
      expect((await pending).uncertain).toBe(true);
      resolve({ success: true, provider: "SMS", messageId: "late" });
      await jest.advanceTimersByTimeAsync(0);
      expect(record).toHaveBeenLastCalledWith({
        success: true,
        provider: "SMS",
        messageId: "late",
      });
      expect(record).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
