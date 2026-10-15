import { InsightReportWorker } from "./insight-report.worker";
import type { InsightService } from "./insight.service";
import type { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@prisma/client";
describe("automatic AIR recovery worker", () => {
  function setup() {
    const failures: { createdAt: Date }[] = [];
    const db = {
      incidentTimelineEvent: {
        findMany: jest.fn().mockResolvedValue([{ incidentId: "incident" }]),
      },
      incident: {
        findMany: jest.fn().mockResolvedValue([{ id: "incident" }]),
        findUnique: jest
          .fn()
          .mockResolvedValue({
            facilityId: "facility",
            timelineEvents: [{ actorUserId: "actor", id: "event" }],
          }),
      },
      afterIncidentReport: { findFirst: jest.fn().mockResolvedValue(null) },
      administrativeAuditEvent: {
        findMany: jest
          .fn()
          .mockImplementation(async () => [...failures].reverse().slice(0, 3)),
        create: jest.fn().mockImplementation(async () => {
          failures.push({ createdAt: new Date() });
          return {};
        }),
      },
    };
    const service = {
      automatic: jest.fn().mockResolvedValue({ reportId: "report" }),
    };
    const worker = () =>
      new InsightReportWorker(
        db as unknown as PrismaService,
        service as unknown as InsightService,
      );
    return { db, service, worker, failures };
  }
  afterEach(() => jest.useRealTimers());
  it("deduplicates the fresh and recovery lanes and bounds each query", async () => {
    const { db, service, worker } = setup();
    await worker().tick();
    expect(service.automatic).toHaveBeenCalledTimes(1);
    expect(
      db.incident.findMany.mock.calls.every(([query]) => query.take === 5),
    ).toBe(true);
    expect(db.incidentTimelineEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      }),
    );
  });
  it("persists backoff and a three-attempt ceiling across worker restarts", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01"));
    const { service, worker, failures } = setup();
    service.automatic.mockRejectedValue(
      Error("provider or database unavailable"),
    );
    await worker().tick();
    await worker().tick();
    expect(service.automatic).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(6000);
    await worker().tick();
    jest.advanceTimersByTime(6000);
    await worker().tick();
    jest.advanceTimersByTime(6000);
    await worker().tick();
    expect(failures).toHaveLength(3);
    expect(service.automatic).toHaveBeenCalledTimes(3);
  });
  it("prevents overlapping scans within a process and recovers after completion", async () => {
    const { service, worker } = setup();
    let release!: () => void;
    service.automatic.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ reportId: "report" });
        }),
    );
    const instance = worker(),
      pending = instance.tick();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await instance.tick();
    expect(service.automatic).toHaveBeenCalledTimes(1);
    release();
    await pending;
    await instance.tick();
    expect(service.automatic).toHaveBeenCalledTimes(2);
  });
  it("reconciles serialization races on the next tick without exhausting the failure budget", async () => {
    const { service, worker, failures } = setup();
    service.automatic.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("race", {
        code: "P2034",
        clientVersion: "test",
      }),
    );
    const instance = worker();
    await instance.tick();
    await instance.tick();
    expect(service.automatic).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(0);
  });
});
