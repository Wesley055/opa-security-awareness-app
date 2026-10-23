/** Historical grants remain data, but no longer provide runtime authority.
 * Positive workflows now live in canonical-organization and institutional-authority suites.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { MODULE_METADATA } from "@nestjs/common/constants";
import type { UserRole } from "@prisma/client";
import { prismaTest as db } from "./prisma-test-client";
import type { PrismaService } from "../../src/prisma/prisma.service";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import { onboardingAuthority } from "../../src/modules/onboarding/onboarding-authority";
import { InstitutionalService } from "../../src/modules/onboarding/institutional.service";
import { AdminProvisioningModule } from "../../src/modules/admin-provisioning/admin-provisioning.module";
import {
  OnboardingController,
  OnboardingGrantsController,
} from "../../src/modules/onboarding/onboarding.controller";
import { OnboardingService } from "../../src/modules/onboarding/onboarding.service";
const config = new ConfigService({
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  BCRYPT_ROUNDS: 4,
});
const enrollment = new EnrollmentService(
  db as unknown as PrismaService,
  config,
);
const institutional = new InstitutionalService(
  db as unknown as PrismaService,
  enrollment,
);
const identity = () => ({
  firstName: "Synthetic",
  lastName: "Historical",
  email: randomUUID() + "@example.test",
  phoneNumber:
    "+1202555" + String(Math.floor(Math.random() * 10000)).padStart(4, "0"),
});
describe("retired bounded onboarding authority / PostgreSQL", () => {
  let admin: string, employee: string, facility: string, other: string;
  const historical = () =>
    db.onboardingAuthorityGrant.create({
      data: {
        actorUserId: employee,
        approvedByUserId: admin,
        facilityId: facility,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  beforeEach(async () => {
    admin = (await db.user.create({ data: { ...identity(), role: "ADMIN" } }))
      .id;
    employee = (await db.user.create({ data: { ...identity(), role: "USER" } }))
      .id;
    facility = (
      await db.facility.create({
        data: { name: "Historical A", type: "OTHER" },
      })
    ).id;
    other = (
      await db.facility.create({
        data: { name: "Unassigned B", type: "OTHER" },
      })
    ).id;
  });
  it("production module registers neither legacy controller nor legacy provider", () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AdminProvisioningModule,
    );
    expect(controllers).not.toContain(OnboardingController);
    expect(controllers).not.toContain(OnboardingGrantsController);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AdminProvisioningModule),
    ).not.toContain(OnboardingService);
  });
  it.each([
    "USER",
    "RESPONDER",
    "FACILITY_OPERATOR",
    "FACILITY_ADMIN",
    "TECHNICAL_SUPPORT",
  ] as UserRole[])(
    "a stored unexpired grant never authorizes %s",
    async (role) => {
      await db.user.update({ where: { id: employee }, data: { role } });
      const row = await historical();
      await expect(
        db.$transaction((tx) => onboardingAuthority(tx, employee, facility)),
      ).rejects.toThrow("retired");
      expect(
        await db.onboardingAuthorityGrant.findUnique({ where: { id: row.id } }),
      ).toEqual(row);
    },
  );
  it("active ADMIN remains grant free", async () => {
    expect(
      await db.$transaction((tx) => onboardingAuthority(tx, admin, facility)),
    ).toMatchObject({
      actorRole: "ADMIN",
      authority: "PLATFORM_ADMIN",
      grantId: null,
    });
    expect(await db.onboardingAuthorityGrant.count()).toBe(0);
  });
  it.each(["inactive", "pending"])(
    "current %s ADMIN is denied despite role",
    async (state) => {
      await db.user.update({
        where: { id: admin },
        data:
          state === "inactive"
            ? { isActive: false }
            : { accountStatus: "PENDING_ACTIVATION" },
      });
      await expect(
        db.$transaction((tx) => onboardingAuthority(tx, admin, facility)),
      ).rejects.toThrow();
    },
  );
  it("inactive facility remains denied to ADMIN", async () => {
    await db.facility.update({
      where: { id: facility },
      data: { isActive: false },
    });
    await expect(
      db.$transaction((tx) => onboardingAuthority(tx, admin, facility)),
    ).rejects.toThrow();
  });
  it.each(["USER", "FACILITY_OPERATOR", "FACILITY_ADMIN"] as const)(
    "legacy grants cannot invoke canonical %s enrollment or create an outbox",
    async (role) => {
      await historical();
      await expect(
        enrollment.request(identity(), randomUUID(), facility, employee, role, {
          reason: "Historical request",
          caseReference: randomUUID(),
          correlationId: randomUUID(),
        }),
      ).rejects.toThrow();
      expect(await db.enrollmentRequest.count()).toBe(0);
      expect(await db.accountInvitationDelivery.count()).toBe(0);
    },
  );
  it("active employment and a global read permission still cannot translate legacy grants into assignments", async () => {
    await db.user.update({
      where: { id: employee },
      data: { role: "TECHNICAL_SUPPORT" },
    });
    await db.supportEmployment.create({
      data: { userId: employee, appointedByUserId: admin },
    });
    await historical();
    await institutional.grant(
      admin,
      employee,
      "FACILITY_READ",
      null,
      undefined,
      {
        reason: "Synthetic read permission",
        caseReference: randomUUID(),
        correlationId: randomUUID(),
      },
    );
    expect(await institutional.directory(employee)).toEqual([]);
    expect((await institutional.context(employee)).facilities).toEqual([]);
    expect(await db.facilitySupportAssignment.count()).toBe(0);
  });
  it("cross-facility legacy grants cannot restore canonical scope", async () => {
    await historical();
    await expect(
      db.$transaction((tx) => onboardingAuthority(tx, employee, other)),
    ).rejects.toThrow("retired");
  });
  it("historical self-approval and invalid-duration constraints remain intact", async () => {
    await expect(
      db.onboardingAuthorityGrant.create({
        data: {
          actorUserId: admin,
          approvedByUserId: admin,
          facilityId: facility,
          expiresAt: new Date(Date.now() + 3600000),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.onboardingAuthorityGrant.create({
        data: {
          actorUserId: employee,
          approvedByUserId: admin,
          facilityId: facility,
          expiresAt: new Date(0),
        },
      }),
    ).rejects.toThrow();
  });
  it("multiple historical rows never combine into authority and revocation retains history", async () => {
    const row = await historical();
    await historical();
    await db.onboardingAuthorityGrant.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    expect(await db.onboardingAuthorityGrant.count()).toBe(2);
    await expect(
      db.$transaction((tx) => onboardingAuthority(tx, employee, facility)),
    ).rejects.toThrow("retired");
  });
});
