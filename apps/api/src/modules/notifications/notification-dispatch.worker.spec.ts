import { NotificationDispatchWorker } from "./notification-dispatch.worker";

describe("NotificationDispatchWorker", () => {
  const prisma = { incidentNotification: { findFirst: jest.fn() } };
  const service = { dispatchNotification: jest.fn() };
  const ledger = { recoverStale: jest.fn(), reconcileReceipts: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
  });
  const worker = () =>
    new NotificationDispatchWorker(
      prisma as never,
      service as never,
      ledger as never,
    );
  it("recovers uncertain attempts before dispatch", async () => {
    prisma.incidentNotification.findFirst.mockResolvedValue(null);
    await worker().tick();
    expect(ledger.recoverStale).toHaveBeenCalledTimes(1);
    expect(service.dispatchNotification).not.toHaveBeenCalled();
  });
  it("dispatches only bounded, due, retry-eligible candidates", async () => {
    prisma.incidentNotification.findFirst.mockResolvedValue({ id: "id" });
    await worker().tick();
    expect(service.dispatchNotification).toHaveBeenCalledTimes(25);
    expect(prisma.incidentNotification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "QUEUED",
          id: { notIn: expect.any(Array) },
          nextAttemptAt: { lte: expect.any(Date) },
          attemptCount: { lt: 5 },
        },
      }),
    );
  });
  it("visits a deferred row only once per tick and continues to other work", async () => {
    const rows = [{id:"unready"},{id:"ready"}];
    prisma.incidentNotification.findFirst.mockImplementation(async ({where}) => rows.find(r => !where.id.notIn.includes(r.id)) ?? null);
    service.dispatchNotification.mockResolvedValue(null);
    await worker().tick();
    expect(service.dispatchNotification.mock.calls.map(call => call[0])).toEqual(["unready","ready"]);
  });
  it("prevents process-local overlapping ticks", async () => {
    let release!: () => void;
    ledger.recoverStale.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const w = worker();
    const first = w.tick();
    await w.tick();
    expect(ledger.recoverStale).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
