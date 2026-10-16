import { ForbiddenException } from "@nestjs/common";
import { InsightService } from "./insight.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { Source } from "./insight.projection";

const WINDOW = { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" };
const at = (minutes: number) =>
  new Date(Date.parse("2026-01-10T00:00:00Z") + minutes * 60000);

function incident(id: string, facilityId: string, ackMinutes?: number): Source {
  return {
    id,
    facilityId,
    trigger: "SOS_BUTTON",
    status: "RESOLVED",
    createdAt: at(0),
    updatedAt: at(10),
    resolvedAt: at(10),
    latitude: null,
    longitude: null,
    journeySession: null,
    evidence: [],
    notifications: [],
    timelineEvents:
      ackMinutes === undefined
        ? []
        : [
            {
              id: id + "-ack",
              sequence: 1,
              type: "OPERATOR_ACKNOWLEDGED",
              source: "COMMAND_CENTER",
              actorUserId: "operator-user-7",
              payload: {},
              occurredAt: at(ackMinutes),
              recordedAt: at(ackMinutes),
            },
          ],
  };
}

function setup(actor: Record<string, unknown> | null) {
  const facilities = [
    { id: "lagos-1", name: "Ikeja", region: "Lagos" },
    { id: "abuja-1", name: "Wuse", region: "FCT" },
  ];
  const incidents: Source[] = [
    incident("i1", "lagos-1", 2),
    incident("i2", "lagos-1"),
    incident("i3", "abuja-1", 6),
  ];
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue(actor) },
    facility: {
      findMany: jest
        .fn()
        .mockImplementation(async (args: { distinct?: string[]; where: { region?: string } }) =>
          args.distinct
            ? facilities.map((f) => ({ region: f.region }))
            : facilities.filter((f) => !args.where.region || f.region === args.where.region),
        ),
    },
    incident: {
      findMany: jest
        .fn()
        .mockImplementation(async (args: { where: { facilityId: string }; select: unknown }) =>
          incidents.filter((i) => i.facilityId === args.where.facilityId),
        ),
      count: jest.fn().mockResolvedValue(1),
    },
    incidentTimelineEvent: { count: jest.fn().mockResolvedValue(0) },
    incidentNotification: { count: jest.fn().mockResolvedValue(0) },
    evidence: { count: jest.fn().mockResolvedValue(0) },
    deliveryAttempt: { count: jest.fn().mockResolvedValue(0) },
    correctiveAction: { findMany: jest.fn().mockResolvedValue([]) },
    administrativeAuditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaService;
  return { service: new InsightService(prisma), tx };
}

const headOffice = {
  role: "ORGANIZATION_ADMIN",
  isActive: true,
  accountStatus: "ACTIVE",
  membershipState: "ACTIVE",
  facilityId: null,
  organizationId: "bank",
  organization: { id: "bank", name: "Demo Bank" },
};

describe("Head Office Insight", () => {
  it.each([
    ["a facility admin", { ...headOffice, role: "FACILITY_ADMIN" }],
    ["OPA super admin", { ...headOffice, role: "ADMIN" }],
    ["a suspended head office user", { ...headOffice, isActive: false }],
    ["a head office user without an organization", { ...headOffice, organizationId: null, organization: null }],
    ["a head office user attached to a facility", { ...headOffice, facilityId: "lagos-1" }],
    ["an unknown actor", null],
  ])("rejects %s", async (_label, actor) => {
    const { service, tx } = setup(actor);
    await expect(service.organizationOverview("actor", WINDOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.facility.findMany).not.toHaveBeenCalled();
    expect(tx.administrativeAuditEvent.create).not.toHaveBeenCalled();
  });

  it("scopes branches to the actor's own organization only", async () => {
    const { service, tx } = setup(headOffice);
    await service.organizationOverview("actor", WINDOW);
    for (const [args] of tx.facility.findMany.mock.calls)
      expect((args as { where: { organizationId: string } }).where.organizationId).toBe("bank");
  });

  it("returns per-branch rows, totals and weighted response times", async () => {
    const { service } = setup(headOffice);
    const result = await service.organizationOverview("actor", WINDOW);
    expect(result.organization).toEqual({ id: "bank", name: "Demo Bank" });
    expect(result.regions).toEqual(["FCT", "Lagos"]);
    expect(result.branches.map((b) => b.name)).toEqual(["Ikeja", "Wuse"]);
    const ikeja = result.branches[0]!;
    expect(ikeja.incidentCount).toBe(2);
    expect(ikeja.acknowledgementLatency).toEqual({ meanMs: 120000, known: 1, unknown: 1 });
    expect(result.totals.branches).toBe(2);
    expect(result.totals.incidentCount).toBe(3);
    expect(result.totals.openNow).toBe(2);
    // (2 min * 1 + 6 min * 1) / 2 known
    expect(result.totals.acknowledgementLatency).toEqual({ meanMs: 240000, known: 2, unknown: 1 });
  });

  it("filters by region", async () => {
    const { service } = setup(headOffice);
    const result = await service.organizationOverview("actor", { ...WINDOW, region: "Lagos" });
    expect(result.region).toBe("Lagos");
    expect(result.branches.map((b) => b.facilityId)).toEqual(["lagos-1"]);
    expect(result.regions).toEqual(["FCT", "Lagos"]);
  });

  it("returns aggregates only and audits the read", async () => {
    const { service, tx } = setup(headOffice);
    const result = await service.organizationOverview("actor", WINDOW);
    const text = JSON.stringify(result);
    for (const forbidden of ["\"i1\"", "\"i2\"", "\"i3\"", "operator-user-7", "latitude", "evidence\":["])
      expect(text).not.toContain(forbidden);
    expect(tx.administrativeAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "actor",
        actorRole: "ORGANIZATION_ADMIN",
        action: "EVIDENCE_ORGANIZATION_INSIGHT_READ",
        resourceId: "bank",
      }),
    });
  });

  it("rejects an invalid or over-long window before reading anything", async () => {
    const { service, tx } = setup(headOffice);
    expect(() =>
      service.organizationOverview("actor", { from: "2026-01-01", to: "2027-06-01" }),
    ).toThrow("366 days");
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
});
