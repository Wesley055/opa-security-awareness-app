import { InsightService } from "./insight.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { Source } from "./insight.projection";
describe("automatic AIR evidence snapshots", () => {
  function setup() {
    let clock = new Date("2026-01-01T00:02:00Z");
    const at = new Date("2026-01-01T00:01:00Z"),
      event = {
        id: "resolution",
        type: "INCIDENT_RESOLVED",
        source: "COMMAND_CENTER",
        actorUserId: "manager",
        sequence: 1,
        occurredAt: at,
        recordedAt: at,
        payload: { newStatus: "RESOLVED", reason: "private note" },
      };
    const source: Source = {
      id: "incident",
      facilityId: "facility",
      trigger: "SOS_BUTTON",
      status: "RESOLVED",
      createdAt: new Date("2026-01-01"),
      updatedAt: at,
      resolvedAt: at,
      latitude: null,
      longitude: null,
      journeySession: null,
      evidence: [],
      notifications: [],
      timelineEvents: [event],
    };
    type Row = {
      id: string;
      requestKey: string;
      version: number;
      sourceDigest: string;
      generatorVersion: string;
      document: unknown;
    };
    const reports: Row[] = [];
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockImplementation(async () => [{ at: clock }]),
      incident: {
        findUnique: jest.fn().mockImplementation(async () => source),
        findFirst: jest.fn().mockImplementation(async () => source),
      },
      facility: { findFirst: jest.fn().mockResolvedValue({ id: "facility" }) },
      incidentTimelineEvent: {
        findFirst: jest.fn().mockResolvedValue(event),
        count: jest.fn().mockResolvedValue(1),
      },
      incidentNotification: { count: jest.fn().mockResolvedValue(0) },
      evidence: { count: jest.fn().mockResolvedValue(0) },
      deliveryAttempt: { count: jest.fn().mockResolvedValue(0) },
      facilityResponsePolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      administrativeAuditEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "audit" }),
      },
      reportingProjection: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      afterIncidentReport: {
        findFirst: jest
          .fn()
          .mockImplementation(async () => reports[reports.length - 1] ?? null),
        findUnique: jest
          .fn()
          .mockImplementation(
            async ({
              where,
            }: {
              where: {
                facilityId_incidentId_requestKey: { requestKey: string };
              };
            }) =>
              reports.find(
                (r) =>
                  r.requestKey ===
                  where.facilityId_incidentId_requestKey.requestKey,
              ) ?? null,
          ),
        create: jest
          .fn()
          .mockImplementation(async ({ data }: { data: Omit<Row, "id"> }) => {
            const row = { ...data, id: `air-${reports.length + 1}` };
            reports.push(row);
            return row;
          }),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (run: (client: typeof tx) => unknown) =>
          run(tx),
        ),
    };
    return {
      tx,
      source,
      reports,
      service: () => new InsightService(prisma as unknown as PrismaService),
      advance: () => {
        clock = new Date(+clock + 1000);
      },
    };
  }
  it("deduplicates retries and restarts despite advancing cutoffs, then supersedes on new evidence", async () => {
    const { service, advance, reports, source } = setup();
    const first = await service().automatic("incident");
    advance();
    expect((await service().automatic("incident"))?.reportId).toBe(
      first?.reportId,
    );
    expect(reports).toHaveLength(1);
    const original = JSON.stringify(reports[0]?.document);
    source.evidence.push({
      id: "evidence",
      type: "DOCUMENT",
      status: "STORED",
      createdAt: new Date("2026-01-01T00:01:30Z"),
      uploadedAt: null,
    });
    const second = await service().automatic("incident");
    expect(second?.version).toBe(2);
    expect(second?.supersedesId).toBe(first?.reportId);
    expect(JSON.stringify(reports[0]?.document)).toBe(original);
    expect(JSON.stringify(second)).not.toContain("private note");
    expect(second?.document).toMatchObject({
      narrative: { status: "UNAVAILABLE", aiGenerated: false },
      compliance: { complianceClaim: null, regulatoryMappings: [] },
    });
  });
  it("does not generate for cancelled, unattributed, or private SafeWalk incidents", async () => {
    const { service, source, tx, reports } = setup();
    source.status = "CANCELLED";
    expect(await service().automatic("incident")).toBeNull();
    source.status = "RESOLVED";
    source.journeySession = {
      purpose: "SAFEWALK",
      safeWalkEmergencyAt: null,
      safeWalkEmergencyIncidentId: null,
      redactedAt: null,
    };
    expect(await service().automatic("incident")).toBeNull();
    source.journeySession = null;
    tx.incidentTimelineEvent.findFirst.mockResolvedValue(null);
    expect(await service().automatic("incident")).toBeNull();
    expect(reports).toHaveLength(0);
  });
  it("fails oversized evidence before persisting a report", async () => {
    const { tx, service, reports } = setup();
    tx.evidence.count.mockResolvedValue(10001);
    await expect(service().automatic("incident")).rejects.toThrow("budget");
    expect(reports).toHaveLength(0);
  });
});
