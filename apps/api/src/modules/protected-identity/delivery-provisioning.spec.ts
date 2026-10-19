import { ProtectedSnapshotsService } from "./protected-snapshots.service";

const TENANT = "73541e9b-6d62-4910-b50a-3b1e6fd28848";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INCIDENT = { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", facilityId: TENANT };
const payload = { version: 1, channel: "SMS", recipient: "+2348000000000", subject: "OPA ALERT", message: "x" };

function txWith(grants: Array<{ permission: string; actorUserId: string }>, admin: { id: string } | null) {
  const created: unknown[] = [];
  const audits: unknown[] = [];
  const tx = {
    incident: { findUniqueOrThrow: jest.fn().mockResolvedValue(INCIDENT) },
    identityAccessGrant: {
      findFirst: jest.fn(async ({ where }: { where: { permission: string; actorUserId?: string } }) =>
        grants.find((g) => g.permission === where.permission && (!where.actorUserId || g.actorUserId === where.actorUserId)) ?? null),
      create: jest.fn(async ({ data }: { data: { permission: string; actorUserId: string } }) => { grants.push(data); created.push(data); return data; }),
    },
    user: { findFirst: jest.fn().mockResolvedValue(admin) },
    administrativeAuditEvent: { create: jest.fn(async ({ data }: { data: unknown }) => { audits.push(data); return data; }) },
  };
  return { tx, created, audits };
}
const identities = () => ({
  authorize: jest.fn().mockResolvedValue({}),
  protectInTransaction: jest.fn().mockResolvedValue({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
});
const row = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", incidentId: "e", contactName: "Ada", recipient: "+2348000000000", payload } as never;

describe("facility delivery identity", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.PII_DELIVERY_ACTORS_JSON = JSON.stringify({ "a0ede9e9-9771-477a-a36e-777454f6e31e": "e1c927b1-0cff-43c0-ac88-141d7b8a9e1a" });
    delete process.env.PII_DELIVERY_ACTOR_USER_ID;
  });
  afterAll(() => { process.env = env; });

  it("a new facility without a mapping gets its Facility Admin provisioned once, audited", async () => {
    const { tx, created, audits } = txWith([], { id: ADMIN });
    const ids = identities();
    const out = await new ProtectedSnapshotsService({} as never, ids as never).notificationData(tx as never, row);
    expect(created).toEqual([
      expect.objectContaining({ tenantId: TENANT, actorUserId: ADMIN, permission: "DELIVERY" }),
      expect.objectContaining({ tenantId: TENANT, actorUserId: ADMIN, permission: "WRITE" }),
    ]);
    expect(audits).toEqual([expect.objectContaining({ action: "PROTECTED_DELIVERY_PROVISIONED", facilityId: TENANT })]);
    expect(ids.authorize).toHaveBeenCalledWith(tx, TENANT, ADMIN, "DELIVERY");
    expect(out).toMatchObject({ recipient: "[protected]", contactName: "[protected]" });
  });

  it("an existing grant is reused, nothing new is created", async () => {
    const { tx, created } = txWith([{ permission: "DELIVERY", actorUserId: ADMIN }, { permission: "WRITE", actorUserId: ADMIN }], { id: ADMIN });
    const ids = identities();
    await new ProtectedSnapshotsService({} as never, ids as never).notificationData(tx as never, row);
    expect(created).toEqual([]);
    expect(ids.authorize).toHaveBeenCalledWith(tx, TENANT, ADMIN, "DELIVERY");
  });

  it("the configured mapping still wins for its facility", async () => {
    const { tx, created } = txWith([], { id: ADMIN });
    (tx.incident.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...INCIDENT, facilityId: "a0ede9e9-9771-477a-a36e-777454f6e31e" });
    const ids = identities();
    await new ProtectedSnapshotsService({} as never, ids as never).notificationData(tx as never, row);
    expect(ids.authorize).toHaveBeenCalledWith(tx, "a0ede9e9-9771-477a-a36e-777454f6e31e", "e1c927b1-0cff-43c0-ac88-141d7b8a9e1a", "DELIVERY");
    expect(created).toEqual([]);
  });

  it("no Facility Admin: fails clearly (and the SOS layer records the alert as FAILED)", async () => {
    const { tx } = txWith([], null);
    await expect(new ProtectedSnapshotsService({} as never, identities() as never).notificationData(tx as never, row)).rejects.toThrow("Protected snapshot unavailable.");
  });
});
