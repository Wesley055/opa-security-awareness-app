import { IncidentStatus, UserRole } from "@prisma/client";
import { facilityResponder, IDENTITY_VIEWED, recordIdentityViews, responderPerson } from "./responder-identity";

const person = { firstName: "Ada", lastName: "Obi", email: "a@example.test", phoneNumber: "+2348000000000" };
const responder = { id: "op", role: UserRole.FACILITY_OPERATOR, facilityId: "fac" };

function db(viewer: object | null, seen: string[] = []) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(viewer) },
    administrativeAuditEvent: {
      findMany: jest.fn().mockResolvedValue(seen.map(resourceId => ({ resourceId }))),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
}

describe("responder name visibility", () => {
  it("shows the name to a facility responder on an active incident, masking contact details", () => {
    expect(responderPerson(person, IncidentStatus.OPEN, responder)).toEqual({ firstName: "Ada", lastName: "Obi", email: "[protected]", phoneNumber: "[protected]" });
  });
  it("masks the name on closed incidents and for non-responders", () => {
    expect(responderPerson(person, IncidentStatus.RESOLVED, responder).firstName).toBe("[protected]");
    expect(responderPerson(person, IncidentStatus.OPEN, null).firstName).toBe("[protected]");
  });
  it.each([
    [{ id: "x", role: UserRole.FACILITY_ADMIN, facilityId: "fac", isActive: true, membershipState: "ACTIVE" }, true],
    [{ id: "x", role: UserRole.FACILITY_OPERATOR, facilityId: "other", isActive: true, membershipState: "ACTIVE" }, false],
    [{ id: "x", role: UserRole.ADMIN, facilityId: "fac", isActive: true, membershipState: "ACTIVE" }, false],
    [{ id: "x", role: UserRole.ORGANIZATION_ADMIN, facilityId: "fac", isActive: true, membershipState: "ACTIVE" }, false],
    [{ id: "x", role: UserRole.TECHNICAL_SUPPORT, facilityId: "fac", isActive: true, membershipState: "ACTIVE" }, false],
    [{ id: "x", role: UserRole.FACILITY_OPERATOR, facilityId: "fac", isActive: false, membershipState: "ACTIVE" }, false],
    [{ id: "x", role: UserRole.FACILITY_OPERATOR, facilityId: "fac", isActive: true, membershipState: "SUSPENDED" }, false],
  ])("responder check %#", async (viewer, expected) => {
    expect(Boolean(await facilityResponder(db(viewer), "x", "fac"))).toBe(expected);
  });
  it("audits only the first view per incident, without the name", async () => {
    const d = db(null, ["i1"]);
    await recordIdentityViews(d, responder, ["i1", "i2"]);
    const rows = d.administrativeAuditEvent.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: IDENTITY_VIEWED, resourceId: "i2", actorUserId: "op" });
    expect(JSON.stringify(rows)).not.toContain("Ada");
  });
});
