import { PasswordResetService } from "../../src/modules/auth/password-reset.service";
import { createHash } from "node:crypto";
import { OperationalOversightService } from "../../src/modules/onboarding/operational-oversight.service";
import { IncidentTimelineService } from "../../src/modules/incident-timeline/incident-timeline.service";
import { randomUUID, randomBytes } from "node:crypto";
import { prismaTest as db } from "./prisma-test-client";
import { CanonicalOrganizationService } from "../../src/modules/onboarding/canonical-organization.service";
import { InstitutionalService } from "../../src/modules/onboarding/institutional.service";
import {
  supportAuthority,
  enrollmentAuthority,
} from "../../src/modules/onboarding/support-authority";
import { onboardingAuthority } from "../../src/modules/onboarding/onboarding-authority";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import type { PrismaService } from "../../src/prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import type { UserRole } from "@prisma/client";
const config = new ConfigService({
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  BCRYPT_ROUNDS: 4,
});
const canonical = new CanonicalOrganizationService(
  db as unknown as PrismaService,
);
const institutional = new InstitutionalService(
  db as unknown as PrismaService,
  new EnrollmentService(db as unknown as PrismaService, config),
);
const context = () => ({
  reason: "Synthetic commissioning review",
  caseReference: randomUUID(),
  correlationId: randomUUID(),
});
describe("canonical organization / PostgreSQL", () => {
  let admin: string,
    support: string,
    replacement: string,
    a: string,
    b: string,
    caseId: string;
  const person = async (role: UserRole) =>
    (
      await db.user.create({
        data: {
          email: randomUUID() + "@example.test",
          phoneNumber:
            "+234" +
            String(BigInt("0x" + randomBytes(5).toString("hex"))).padStart(
              12,
              "0",
            ),
          firstName: "Synthetic",
          lastName: "Review",
          role,
        },
      })
    ).id;
  const allowed = (
    capability: "STAFF_READ" | "INCIDENT_RESOLVE" = "STAFF_READ",
    facility = a,
  ) =>
    db.$transaction((tx) =>
      supportAuthority(
        tx,
        support,
        capability,
        facility,
        capability === "INCIDENT_RESOLVE" ? caseId : undefined,
      ),
    );
  beforeEach(async () => {
    admin = await person("ADMIN");
    support = await person("TECHNICAL_SUPPORT");
    replacement = await person("TECHNICAL_SUPPORT");
    a = (
      await db.facility.create({ data: { name: "Synthetic A", type: "OTHER" } })
    ).id;
    b = (
      await db.facility.create({ data: { name: "Synthetic B", type: "OTHER" } })
    ).id;
    for (const id of [support, replacement])
      await institutional.employment(admin, id, "ACTIVE", context());
    await canonical.assign(admin, a, support, context());
    await canonical.profile(admin, support, a, context());
    caseId = (
      await canonical.createCase(
        support,
        a,
        {
          category: "Commissioning",
          summary: "Synthetic acceptance",
          priority: "NORMAL",
        },
        context(),
      )
    ).id;
  });
  it("credential recovery preserves assignments, employment, permissions, case, elevation, PII and commissioning", async () => {
    await institutional.grant(
      admin,
      support,
      "INCIDENT_RESOLVE",
      a,
      new Date(Date.now() + 3600000).toISOString(),
      context(),
    );
    await canonical.elevate(
      admin,
      support,
      a,
      "INCIDENT_RESOLVE",
      new Date(),
      new Date(Date.now() + 3600000),
      { ...context(), caseReference: caseId },
    );
    await db.identityAccessGrant.create({
      data: {
        tenantId: a,
        actorUserId: support,
        permission: "RESOLVE",
        expiresAt: new Date(Date.now() + 3600000),
        approvedByReference: admin,
      },
    });
    const snapshot = async () => ({
      users: (await db.user.findMany({ orderBy: { id: "asc" } })).map((user) =>
        Object.fromEntries(
          Object.entries(user).filter(
            ([key]) =>
              !["passwordHash", "credentialVersion", "updatedAt"].includes(key),
          ),
        ),
      ),
      facilities: await db.facility.findMany({ orderBy: { id: "asc" } }),
      organizations: await db.organization.findMany({ orderBy: { id: "asc" } }),
      employment: await db.supportEmployment.findMany({
        orderBy: { userId: "asc" },
      }),
      assignments: await db.facilitySupportAssignment.findMany({
        orderBy: { id: "asc" },
      }),
      permissions: await db.supportCapabilityGrant.findMany({
        orderBy: { id: "asc" },
      }),
      cases: await db.supportCase.findMany({ orderBy: { id: "asc" } }),
      elevations: await db.temporaryElevation.findMany({
        orderBy: { id: "asc" },
      }),
      pii: await db.identityAccessGrant.findMany({ orderBy: { id: "asc" } }),
    });
    const before = await snapshot();
    const authorization = await allowed("INCIDENT_RESOLVE");
    const raw = randomBytes(32).toString("hex");
    await db.passwordResetToken.create({
      data: {
        userId: support,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const resetConfig = { getOrThrow: () => 4 } as unknown as ConfigService;
    await new PasswordResetService(
      db as unknown as PrismaService,
      resetConfig,
    ).confirmReset({ token: raw, password: randomBytes(24).toString("hex") });
    expect(await snapshot()).toEqual(before);
    expect(await allowed("INCIDENT_RESOLVE")).toEqual(authorization);
  });
  it("assigned A allowed, unassigned B denied", async () => {
    expect((await allowed()).assignmentId).toBeTruthy();
    await expect(allowed("STAFF_READ", b)).rejects.toThrow("Assignment");
  });
  it("enumeration exposes only assigned A", async () => {
    expect((await institutional.directory(support)).map((f) => f.id)).toEqual([
      a,
    ]);
    expect(
      (await institutional.context(support)).facilities.map((f) => f.id),
    ).toEqual([a]);
  });
  it("legacy unexpired authority remains historical and cannot authorize", async () => {
    await db.onboardingAuthorityGrant.create({
      data: {
        actorUserId: support,
        facilityId: b,
        approvedByUserId: admin,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await expect(
      db.$transaction((tx) => onboardingAuthority(tx, support, b)),
    ).rejects.toThrow("retired");
    await expect(allowed("STAFF_READ", b)).rejects.toThrow();
    expect(await db.onboardingAuthorityGrant.count()).toBe(1);
  });
  it("support cannot create an organization", async () => {
    await expect(
      canonical.createOrganization(support, "Unauthorized", context()),
    ).rejects.toThrow("Platform");
  });
  it("support cannot self-assign", async () => {
    await expect(
      canonical.assign(support, b, support, context()),
    ).rejects.toThrow("Platform");
  });
  it("support cannot approve its own elevation", async () => {
    await expect(
      canonical.elevate(
        support,
        support,
        a,
        "INCIDENT_RESOLVE",
        new Date(),
        new Date(Date.now() + 3600000),
        { ...context(), caseReference: caseId },
      ),
    ).rejects.toThrow("Platform");
  });
  it("assignment revocation denies a still-valid actor and retains audit", async () => {
    const before = await db.administrativeAuditEvent.count();
    await canonical.assign(admin, a, null, context());
    await expect(allowed()).rejects.toThrow("Assignment");
    expect(await db.administrativeAuditEvent.count()).toBeGreaterThan(before);
    expect(await db.facilitySupportAssignment.count()).toBe(1);
  });
  it("reassignment immediately denies the previous owner", async () => {
    await canonical.assign(admin, a, replacement, context());
    await expect(allowed()).rejects.toThrow("Assignment");
    expect(
      (await db.supportCase.findUniqueOrThrow({ where: { id: caseId } }))
        .assignedToUserId,
    ).toBe(replacement);
  });
  it("concurrent assignment changes preserve exactly one current owner", async () => {
    await Promise.all([
      canonical.assign(admin, a, replacement, context()),
      canonical.assign(admin, a, support, context()),
    ]);
    expect(
      await db.facilitySupportAssignment.count({
        where: { facilityId: a, revokedAt: null },
      }),
    ).toBe(1);
  });
  it.each(["SUSPENDED", "ENDED"] as const)(
    "%s employment invalidates assignments and elevations",
    async (state) => {
      await institutional.employment(admin, support, state, context());
      await expect(allowed()).rejects.toThrow();
      expect(
        await db.facilitySupportAssignment.count({
          where: { actorUserId: support, revokedAt: null },
        }),
      ).toBe(0);
      expect(await db.user.count({ where: { id: support } })).toBe(1);
    },
  );
  it("human-safe recovery discovery is ADMIN-only and never returns contact or full names", async () => {
    await expect(institutional.recoveryAccounts(support)).rejects.toThrow();
    const result = await institutional.recoveryAccounts(admin);
    const row = result.accounts.find((x) => x.id === support)!;
    expect(row.displayIdentity).toMatch(/^S••• R••• · Account /);
    expect(row).not.toHaveProperty("firstName");
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("phoneNumber");
    expect(row.supportEmployment?.state).toBe("ACTIVE");
    expect(result.accounts.some((x) => x.id === admin)).toBe(false);
  });
  it("member identity is masked and facility scoped", async () => {
    const fa = await person("FACILITY_ADMIN");
    const operator = await person("FACILITY_OPERATOR");
    await db.user.updateMany({
      where: { id: { in: [fa, operator] } },
      data: { facilityId: a },
    });
    const rows = await institutional.members(fa, a);
    expect(rows.find((x) => x.id === operator)?.displayIdentity).toMatch(
      /Account /,
    );
    expect(JSON.stringify(rows)).not.toContain("Synthetic");
    expect(JSON.stringify(rows)).not.toContain("example.test");
    await expect(institutional.members(fa, b)).rejects.toThrow();
  });
  it("Support role choices require exact case, assignment, permission and exceptional elevation", async () => {
    expect(
      (await institutional.invitationRoles(support, a, caseId)).roles,
    ).toEqual([]);
    expect(
      (await institutional.invitationRoles(support, b, caseId)).roles,
    ).toEqual([]);
    expect((await institutional.invitationRoles(support, a)).roles).toEqual([]);
    const elevation = await canonical.elevate(
      admin,
      support,
      a,
      "STAFF_PROVISION",
      new Date(),
      new Date(Date.now() + 3600000),
      { ...context(), caseReference: caseId },
    );
    expect(
      (await institutional.invitationRoles(support, a, caseId)).roles,
    ).toEqual(["FACILITY_ADMIN", "FACILITY_OPERATOR"]);
    await canonical.revokeElevation(admin, elevation.id, context());
    expect(
      (await institutional.invitationRoles(support, a, caseId)).roles,
    ).toEqual([]);
    await institutional.grant(
      admin,
      support,
      "RESIDENT_SUPPORT_OVERRIDE",
      a,
      new Date(Date.now() + 3600000).toISOString(),
      context(),
    );
    expect(
      (await institutional.invitationRoles(support, a, caseId)).roles,
    ).not.toContain("USER");
    await canonical.elevate(
      admin,
      support,
      a,
      "RESIDENT_SUPPORT_OVERRIDE",
      new Date(),
      new Date(Date.now() + 3600000),
      { ...context(), caseReference: caseId },
    );
    expect(
      (await institutional.invitationRoles(support, a, caseId)).roles,
    ).toContain("USER");
    await institutional.employment(admin, support, "SUSPENDED", context());
    expect(
      (await institutional.invitationRoles(support, a, caseId)).roles,
    ).toEqual([]);
  });
  it("permission revocation denies despite retained assignment", async () => {
    await institutional.revokeSupportGrants(admin, support, context());
    await expect(allowed()).rejects.toThrow("capability");
  });
  it("elevation is additional to permission and case", async () => {
    await institutional.grant(
      admin,
      support,
      "INCIDENT_RESOLVE",
      a,
      new Date(Date.now() + 3600000).toISOString(),
      context(),
    );
    await expect(allowed("INCIDENT_RESOLVE")).rejects.toThrow("Elevation");
    const row = await canonical.elevate(
      admin,
      support,
      a,
      "INCIDENT_RESOLVE",
      new Date(),
      new Date(Date.now() + 3600000),
      { ...context(), caseReference: caseId },
    );
    expect((await allowed("INCIDENT_RESOLVE")).elevationId).toBe(row.id);
    await canonical.revokeElevation(admin, row.id, context());
    await expect(allowed("INCIDENT_RESOLVE")).rejects.toThrow("Elevation");
  });
  it("expired elevation cannot authorize", async () => {
    await institutional.grant(
      admin,
      support,
      "INCIDENT_RESOLVE",
      a,
      new Date(Date.now() + 3600000).toISOString(),
      context(),
    );
    await db.temporaryElevation.create({
      data: {
        actorUserId: support,
        facilityId: a,
        supportCaseId: caseId,
        capability: "INCIDENT_RESOLVE",
        approvedByUserId: admin,
        reason: "Synthetic historical elevation",
        createdAt: new Date(Date.now() - 120000),
        startsAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000),
      },
    });
    await expect(allowed("INCIDENT_RESOLVE")).rejects.toThrow("Elevation");
  });
  it("operational lifecycle cannot bypass missing commissioning gates", async () => {
    await expect(
      canonical.lifecycle(admin, a, "OPERATIONAL", context()),
    ).rejects.toThrow("commissioning");
  });
  it("commissioning evidence is append only", async () => {
    await canonical.responsePolicy(
      admin,
      a,
      {
        acknowledgementSeconds: 60,
        dispatchSeconds: 120,
        progressSeconds: 180,
        unattendedSeconds: 300,
        closureSeconds: 3600,
      },
      context(),
    );
    const row = await canonical.recordEvidence(
      support,
      a,
      {
        gate: "CONFIGURATION",
        passed: true,
        evidence: "Synthetic nonproduction configuration inspection",
      },
      { ...context(), caseReference: caseId },
    );
    await expect(
      db.commissioningEvidence.delete({ where: { id: row.id } }),
    ).rejects.toThrow();
    expect(await db.commissioningEvidence.count()).toBe(1);
  });
  it("same operation identity replays and changed payload conflicts", async () => {
    const ctx = context();
    const row = await canonical.createOrganization(
      admin,
      "Synthetic organization",
      ctx,
    );
    expect(
      (await canonical.createOrganization(admin, "Synthetic organization", ctx))
        .id,
    ).toBe(row.id);
    await expect(
      canonical.createOrganization(admin, "Changed", ctx),
    ).rejects.toThrow("identity");
    expect(await db.organization.count()).toBe(1);
  });
  it("foreign facility Support Case cannot authorize evidence", async () => {
    await expect(
      canonical.recordEvidence(
        support,
        b,
        { gate: "CONFIGURATION", passed: true, evidence: "Foreign" },
        { ...context(), caseReference: caseId },
      ),
    ).rejects.toThrow();
  });
  it("policy requires assignment and configuration evidence requires a recorded policy", async () => {
    const intervals = {
      acknowledgementSeconds: 60,
      dispatchSeconds: 120,
      progressSeconds: 180,
      unattendedSeconds: 300,
      closureSeconds: 3600,
    };
    await expect(
      canonical.recordEvidence(
        support,
        a,
        { gate: "CONFIGURATION", passed: true, evidence: "Observed" },
        { ...context(), caseReference: caseId },
      ),
    ).rejects.toThrow();
    await expect(
      canonical.responsePolicy(support, b, intervals, {
        ...context(),
        caseReference: caseId,
      }),
    ).rejects.toThrow();
    await canonical.responsePolicy(support, a, intervals, {
      ...context(),
      caseReference: caseId,
    });
    expect(
      (
        await db.facilityResponsePolicy.findUniqueOrThrow({
          where: { facilityId: a },
        })
      ).version,
    ).toBe(1);
  });
  it("concurrent policy revisions retain consecutive audit provenance", async () => {
    const intervals = {
      acknowledgementSeconds: 60,
      dispatchSeconds: 120,
      progressSeconds: 180,
      unattendedSeconds: 300,
      closureSeconds: 3600,
    };
    await Promise.all([
      canonical.responsePolicy(admin, a, intervals, context()),
      canonical.responsePolicy(
        admin,
        a,
        { ...intervals, dispatchSeconds: 150 },
        context(),
      ),
    ]);
    expect(
      (
        await db.facilityResponsePolicy.findUniqueOrThrow({
          where: { facilityId: a },
        })
      ).version,
    ).toBe(2);
    const rows = await db.administrativeAuditEvent.findMany({
      where: { action: "FACILITY_RESPONSE_POLICY_CHANGED", facilityId: a },
    });
    expect(
      rows.map((r) => (r.beforeState as { version: number | null }).version),
    ).toEqual(expect.arrayContaining([null, 1]));
  });
  it("operational exceptions append once under concurrency and never close the incident", async () => {
    await canonical.responsePolicy(
      admin,
      a,
      {
        acknowledgementSeconds: 1,
        dispatchSeconds: 2,
        progressSeconds: 3,
        unattendedSeconds: 4,
        closureSeconds: 5,
      },
      context(),
    );
    const owner = await person("USER");
    await db.user.update({ where: { id: owner }, data: { facilityId: a } });
    const incident = await db.incident.create({
      data: {
        userId: owner,
        facilityId: a,
        trigger: "SOS_BUTTON",
        createdAt: new Date(Date.now() - 10000),
      },
    });
    const timeline = new IncidentTimelineService(
      db as unknown as PrismaService,
    );
    const service = new OperationalOversightService(
      db as unknown as PrismaService,
      timeline,
    );
    await Promise.all([
      service.evaluate(incident.id),
      service.evaluate(incident.id),
    ]);
    const events = await db.incidentTimelineEvent.findMany({
      where: { incidentId: incident.id },
      orderBy: { sequence: "asc" },
    });
    expect(
      events.filter((e) => e.type === "OPERATIONAL_EXCEPTION"),
    ).toHaveLength(3);
    expect(
      events.filter((e) => e.type === "OPERATIONAL_ESCALATION"),
    ).toHaveLength(3);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      (await db.incident.findUniqueOrThrow({ where: { id: incident.id } }))
        .status,
    ).toBe("OPEN");
    expect(events.every((e) => e.actorUserId === null)).toBe(true);
    expect(
      (events[1]!.payload as { externalDelivery: string }).externalDelivery,
    ).toBe("NOT_ATTEMPTED");
  });
  it("suspension through existing platform endpoint revokes assignment permanently", async () => {
    await institutional.facilityState(admin, a, "suspend", context());
    expect(
      await db.facilitySupportAssignment.count({
        where: { facilityId: a, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      (await db.facility.findUniqueOrThrow({ where: { id: a } }))
        .operationalState,
    ).toBe("SUSPENDED");
    await expect(allowed()).rejects.toThrow();
  });
  it("operator incident reads deny suspended facility", async () => {
    const operator = await person("FACILITY_OPERATOR");
    await db.user.update({ where: { id: operator }, data: { facilityId: a } });
    await institutional.facilityState(admin, a, "suspend", context());
    expect((await institutional.context(operator)).facilities).toEqual([]);
    await expect(institutional.incidents(operator, a)).rejects.toThrow(
      "facility",
    );
  });
  it("concurrent first-admin commissioning cannot become routine second-admin provisioning", async () => {
    await db.facility.update({ where: { id: a }, data: { operationalState: "COMMISSIONING" } });
    const provision = () =>
      db.$transaction(async (tx) => {
        await enrollmentAuthority(tx, support, a, "FACILITY_ADMIN");
        return tx.user.create({
          data: {
            email: randomUUID() + "@example.test",
            phoneNumber:
              "+234" +
              String(BigInt("0x" + randomBytes(5).toString("hex"))).padStart(
                12,
                "0",
              ),
            firstName: "Synthetic",
            lastName: "Admin",
            role: "FACILITY_ADMIN",
            facilityId: a,
          },
        });
      });
    const results = await Promise.allSettled([provision(), provision()]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await db.user.count({
        where: {
          facilityId: a,
          role: "FACILITY_ADMIN",
          membershipState: "ACTIVE",
        },
      }),
    ).toBe(1);
  });
});
