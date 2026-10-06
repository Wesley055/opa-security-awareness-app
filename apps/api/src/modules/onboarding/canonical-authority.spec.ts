import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { supportAuthority, enrollmentAuthority } from "./support-authority";
import { onboardingAuthority } from "./onboarding-authority";
import {
  commissioningReadiness,
  COMMISSIONING_GATES,
} from "./commissioning-policy";
function fixture() {
  const state = {
    role: "TECHNICAL_SUPPORT",
    active: true,
    employed: "ACTIVE",
    assignment: true,
    grant: true,
    elevation: true,
    case: true,
    facility: true,
  };
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    user: {
      findUnique: jest.fn(async () => ({
        id: "actor",
        role: state.role,
        isActive: state.active,
        accountStatus: "ACTIVE",
        facilityId: null,
      })),
      count: jest.fn(async () => 0),
    },
    facility: {
      findUniqueOrThrow: jest.fn(async () => ({ operationalState: "COMMISSIONING" })),
      findUnique: jest.fn(async () => ({
        isActive: state.facility,
        operationalState: "COMMISSIONING",
      })),
    },
    supportEmployment: {
      findUnique: jest.fn(async () => ({ state: state.employed })),
    },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "FacilitySupportAssignment"'))
        return state.assignment ? [{ id: "assignment" }] : [];
      if (sql.includes('FROM "SupportCapabilityGrant"'))
        return state.grant ? [{ id: "permission" }] : [];
      if (sql.includes('FROM "SupportCase"'))
        return state.case ? [{ id: "case" }] : [];
      if (sql.includes('FROM "TemporaryElevation"'))
        return state.elevation ? [{ id: "elevation" }] : [];
      if (sql.includes('FROM "OnboardingAuthorityGrant"'))
        throw Error("Legacy authority must never be queried");
      return [];
    }),
  };
  return { state, mock: tx, tx: tx as unknown as Prisma.TransactionClient };
}
describe("canonical Support authority", () => {
  it("requires employment, assignment and permission and returns their provenance", async () => {
    const f = fixture();
    expect(
      await supportAuthority(f.tx, "actor", "STAFF_READ", "facility-a"),
    ).toMatchObject({
      actorRole: "TECHNICAL_SUPPORT",
      grantId: "permission",
      assignmentId: "assignment",
    });
  });
  it.each(["SUSPENDED", "ENDED"])(
    "denies %s employment despite assignment and permission",
    async (employed) => {
      const f = fixture();
      f.state.employed = employed;
      await expect(
        supportAuthority(f.tx, "actor", "STAFF_READ", "facility-a"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it.each(["assignment", "grant", "active", "facility"] as const)(
    "denies missing %s",
    async (key) => {
      const f = fixture();
      f.state[key] = false;
      await expect(
        supportAuthority(f.tx, "actor", "STAFF_READ", "facility-a"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it("ADMIN remains grant free", async () => {
    const f = fixture();
    f.state.role = "ADMIN";
    f.state.assignment = false;
    f.state.grant = false;
    expect(
      await supportAuthority(f.tx, "actor", "STAFF_READ", "facility-a"),
    ).toEqual({
      actorRole: "ADMIN",
      authority: "PLATFORM_ADMIN",
      grantId: null,
    });
  });
  it("denies incident intervention without a Support Case", async () => {
    const f = fixture();
    await expect(
      supportAuthority(f.tx, "actor", "INCIDENT_RESOLVE", "facility-a"),
    ).rejects.toThrow("Support Case");
  });
  it("denies expired or revoked elevation", async () => {
    const f = fixture();
    f.state.elevation = false;
    await expect(
      supportAuthority(f.tx, "actor", "INCIDENT_RESOLVE", "facility-a", "case"),
    ).rejects.toThrow("Temporary Elevation");
  });
  it("returns current case and elevation provenance", async () => {
    const f = fixture();
    expect(
      await supportAuthority(
        f.tx,
        "actor",
        "INCIDENT_RESOLVE",
        "facility-a",
        "case",
      ),
    ).toMatchObject({
      supportCaseId: "case",
      elevationId: "elevation",
      assignmentId: "assignment",
    });
  });
  it("does not query old unexpired grants for legacy runtime authority", async () => {
    const f = fixture();
    await expect(
      onboardingAuthority(f.tx, "actor", "facility-a"),
    ).rejects.toThrow("retired");
  });
  it("does not fall back to legacy authority for ordinary users", async () => {
    const f = fixture();
    f.state.role = "USER";
    await expect(
      enrollmentAuthority(f.tx, "actor", "facility-a", "FACILITY_OPERATOR"),
    ).rejects.toThrow("Institutional enrollment");
  });
  it("allows assigned Support to provision the first Facility Admin without a case or elevation", async () => {
    const f = fixture();
    f.state.case = false;
    f.state.elevation = false;
    expect(
      await enrollmentAuthority(
        f.tx,
        "actor",
        "facility-a",
        "FACILITY_ADMIN",
      ),
    ).toMatchObject({ assignmentId: "assignment", provisioningMode: "FIRST_FACILITY_ADMIN" });
  });
  it("requires elevation when Support substitutes for customer operator provisioning", async () => {
    const f = fixture();
    f.state.elevation = false;
    await expect(
      enrollmentAuthority(
        f.tx,
        "actor",
        "facility-a",
        "FACILITY_OPERATOR",
        "case",
      ),
    ).rejects.toThrow("Routine staffing");
  });
});
describe("commissioning policy", () => {
  it("does not mistake last-admin existence for operational readiness", () =>
    expect(
      commissioningReadiness([], { organization: true, activeAdmin: true })
        .ready,
    ).toBe(false));
  it("requires all observed gates and institutional prerequisites", () =>
    expect(
      commissioningReadiness(
        COMMISSIONING_GATES.map((gate) => ({ gate, passed: true })),
        { organization: true, activeAdmin: true },
      ).ready,
    ).toBe(true));
  it("a failed recheck supersedes a historical pass", () =>
    expect(
      commissioningReadiness(
        [
          { gate: "SMS", passed: false },
          ...COMMISSIONING_GATES.map((gate) => ({ gate, passed: true })),
        ],
        { organization: true, activeAdmin: true },
      ).missing,
    ).toContain("SMS"));
  it("does not declare an unassociated facility operational", () =>
    expect(
      commissioningReadiness(
        COMMISSIONING_GATES.map((gate) => ({ gate, passed: true })),
        { organization: false, activeAdmin: true },
      ).ready,
    ).toBe(false));
});
