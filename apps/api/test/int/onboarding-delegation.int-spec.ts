import { InvitationDeliveryWorker } from "../../src/modules/admin-provisioning/invitation-delivery.worker";
import { onboardingAuthority } from "../../src/modules/onboarding/onboarding-authority";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, randomUUID } from "crypto";
import request from "supertest";
import { prismaTest } from "./prisma-test-client";
import { PrismaService } from "../../src/prisma/prisma.service";
import { JwtStrategy } from "../../src/modules/auth/jwt.strategy";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import { AdminProvisioningController } from "../../src/modules/admin-provisioning/admin-provisioning.controller";
import { AdminProvisioningService } from "../../src/modules/admin-provisioning/admin-provisioning.service";
import { PlatformAdminService } from "../../src/modules/admin-provisioning/platform-admin.service";
import { OnboardingService } from "../../src/modules/onboarding/onboarding.service";
import {
  OnboardingController,
  OnboardingGrantsController,
} from "../../src/modules/onboarding/onboarding.controller";

const secret = randomBytes(32).toString("hex");
const jwt = new JwtService({ secret });
const values: Record<string, unknown> = {
  JWT_ACCESS_SECRET: secret,
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  BCRYPT_ROUNDS: 4,
};
const identity = () => ({
  firstName: "Private",
  lastName: "Staff",
  email: randomUUID() + "@example.test",
  phoneNumber: "+23480" + String(Math.random()).slice(2, 10).padEnd(8, "0"),
});
describe("bounded onboarding / PostgreSQL", () => {
  let app: INestApplication, service: OnboardingService;
  let admin: string, employee: string, facility: string, other: string;
  // Deliberately stale role: authority must come from PostgreSQL.
  const token = (id: string) =>
    jwt.sign({
      sub: id,
      role: "ADMIN",
      email: "ignored",
      credentialVersion: 0,
    });
  const post = (actor: string, path: string, data: object = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set("Authorization", "Bearer " + token(actor))
      .set("Idempotency-Key", randomUUID())
      .send(data);
  const get = (actor: string, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set("Authorization", "Bearer " + token(actor));
  const grant = (id = facility) =>
    service.grant(
      admin,
      employee,
      id,
      new Date(Date.now() + 3600000).toISOString(),
      "Approved support assignment",
    );
  const invite = (role = "operators", id = facility) =>
    post(employee, "/onboarding/" + role, { ...identity(), facilityId: id });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: "jwt" })],
      controllers: [
        OnboardingController,
        OnboardingGrantsController,
        AdminProvisioningController,
      ],
      providers: [
        OnboardingService,
        EnrollmentService,
        PlatformAdminService,
        AdminProvisioningService,
        JwtStrategy,
        { provide: PrismaService, useValue: prismaTest },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => values[key],
            getOrThrow: (key: string) => values[key],
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    service = module.get(OnboardingService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    admin = (
      await prismaTest.user.create({ data: { ...identity(), role: "ADMIN" } })
    ).id;
    employee = (await prismaTest.user.create({ data: identity() })).id;
    facility = (
      await prismaTest.facility.create({
        data: { name: "Authorized", type: "OTHER" },
      })
    ).id;
    other = (
      await prismaTest.facility.create({
        data: { name: "Other", type: "OTHER" },
      })
    ).id;
  });
  it("ADMIN grants scoped authority with expiry and audit", async () => {
    const result = await post(
      admin,
      `/admin/onboarding/employees/${employee}/grants`,
      {
        facilityId: facility,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        reason: "Support assignment",
      },
    );
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      actorUserId: employee,
      facilityId: facility,
      approvedByUserId: admin,
      permission: "STAFF_ONBOARDING",
    });
    expect(
      await prismaTest.administrativeAuditEvent.findFirst({
        where: { resourceId: result.body.id },
      }),
    ).toMatchObject({
      actorUserId: admin,
      actorRole: "ADMIN",
      action: "ONBOARDING_AUTHORITY_GRANTED",
    });
  });
  it("non-ADMIN including delegated support cannot grant", async () => {
    await grant();
    expect(
      (
        await post(employee, `/admin/onboarding/employees/${employee}/grants`, {
          facilityId: other,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          reason: "Attempt",
        })
      ).status,
    ).toBe(403);
    await expect(
      service.grant(
        employee,
        admin,
        other,
        new Date(Date.now() + 3600000).toISOString(),
        "Attempt",
      ),
    ).rejects.toThrow("Platform authority");
  });
  it.each(["operators", "facility-admins"])(
    "support can invite %s with truthful audit and no identity output",
    async (role) => {
      const g = await grant();
      const result = await invite(role);
      expect(result.status).toBe(201);
      expect(Object.keys(result.body).sort()).toEqual(["requestId", "status"]);
      const audit = await prismaTest.administrativeAuditEvent.findFirst({
        where: { resourceId: result.body.requestId },
      });
      expect(audit).toMatchObject({
        actorUserId: employee,
        actorRole: "USER",
        afterState: {
          authority: "DELEGATED_ONBOARDING",
          grantId: g.id,
          approvedByUserId: admin,
        },
      });
      expect(JSON.stringify(audit)).not.toContain("@example.test");
    },
  );
  it("cannot invite residents or inject a role", async () => {
    await grant();
    expect((await invite("residents")).status).toBe(404);
    expect(
      (
        await post(employee, "/onboarding/operators", {
          ...identity(),
          facilityId: facility,
          requestedRole: "ADMIN",
        })
      ).status,
    ).toBe(400);
  });
  it("cannot use another facility or enumerate the platform directory", async () => {
    await grant();
    expect((await invite("operators", other)).status).toBe(403);
    expect(
      (await get(employee, "/onboarding/facilities")).body.facilities,
    ).toEqual([{ id: facility, name: "Authorized" }]);
    expect((await get(employee, "/admin/facilities")).status).toBe(403);
  });
  it.each([
    "missing",
    "expired",
    "revoked",
    "suspended",
    "pending",
    "inactive-facility",
  ])("fails closed for %s", async (state) => {
    if (state !== "missing") {
      const g = await grant();
      if (state === "expired")
        await prismaTest.onboardingAuthorityGrant.update({
          where: { id: g.id },
          data: {
            createdAt: new Date(Date.now() - 7200000),
            expiresAt: new Date(Date.now() - 1000),
          },
        });
      if (state === "revoked")
        await service.revoke(admin, employee, "Offboarding", g.id);
      if (state === "suspended")
        await prismaTest.user.update({
          where: { id: employee },
          data: { isActive: false },
        });
      if (state === "pending")
        await prismaTest.user.update({
          where: { id: employee },
          data: { accountStatus: "PENDING_ACTIVATION" },
        });
      if (state === "inactive-facility")
        await prismaTest.facility.update({
          where: { id: facility },
          data: { isActive: false },
        });
    }
    expect([401, 403]).toContain((await invite()).status);
    expect(await prismaTest.enrollmentRequest.count()).toBe(0);
  });
  it("ADMIN retains direct onboarding without grants", async () => {
    expect(
      (
        await post(admin, "/onboarding/facility-admins", {
          ...identity(),
          facilityId: facility,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(admin, "/admin/operators", {
          ...identity(),
          facilityId: facility,
        })
      ).status,
    ).toBe(201);
    expect(await prismaTest.onboardingAuthorityGrant.count()).toBe(0);
  });
  it("cannot create facilities or manage accepted memberships", async () => {
    await grant();
    expect(
      (
        await post(employee, "/admin/facilities", {
          name: "Forbidden",
          type: "OTHER",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          employee,
          `/admin/facilities/${facility}/members/${admin}/access`,
          { action: "suspend", reason: "Attempt" },
        )
      ).status,
    ).toBe(403);
  });
  it.each([
    "incidents",
    "evidence",
    "safewalk",
    "protected-identities",
    "sso",
    "reports",
    "members",
    "grants",
  ])("exposes no %s capability on the support boundary", async (path) => {
    await grant();
    expect((await get(employee, "/onboarding/" + path)).status).toBe(404);
    expect((await post(employee, "/onboarding/" + path)).status).toBe(404);
  });
  it("revoke-all invalidates all grants, preserving facilities, memberships and invitation history", async () => {
    await grant();
    await grant(other);
    const member = await prismaTest.user.create({
      data: { ...identity(), facilityId: facility, role: "FACILITY_ADMIN" },
    });
    const receipt = await invite();
    const facilitiesBefore = await prismaTest.facility.findMany({
      orderBy: { id: "asc" },
    });
    expect(
      (
        await post(
          admin,
          `/admin/onboarding/employees/${employee}/revoke-all`,
          { reason: "Employee offboarding" },
        )
      ).body.revokedCount,
    ).toBe(2);
    expect((await invite()).status).toBe(403);
    expect((await invite("operators", other)).status).toBe(403);
    expect(
      await prismaTest.user.findUnique({ where: { id: member.id } }),
    ).toEqual(member);
    expect(
      await prismaTest.facility.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(facilitiesBefore);
    expect(
      await prismaTest.enrollmentRequest.findUnique({
        where: { id: receipt.body.requestId },
      }),
    ).not.toBeNull();
    expect(await prismaTest.onboardingAuthorityGrant.count()).toBe(2);
  });
  it("idempotent retries revalidate delegation and retain a single dual-channel outbox", async () => {
    await grant();
    const dto = { ...identity(), facilityId: facility },
      key = randomUUID();
    const first = await service.invite(employee, dto, key, "FACILITY_OPERATOR");
    expect(
      await service.invite(employee, dto, key, "FACILITY_OPERATOR"),
    ).toEqual(first);
    expect(await prismaTest.accountInvitationDelivery.count()).toBe(2);
    await service.revoke(admin, employee, "Offboarding");
    await expect(
      service.invite(employee, dto, key, "FACILITY_OPERATOR"),
    ).rejects.toThrow("Onboarding authority");
  });
  it("bounded status and lifecycle exclude resident, accepted and cross-facility requests", async () => {
    await grant();
    const resident = await post(admin, "/admin/residents", {
      ...identity(),
      facilityId: facility,
    });
    const staff = await invite();
    const rows = (
      await get(employee, `/onboarding/facilities/${facility}/invitations`)
    ).body.invitations;
    expect(rows.map((r: { id: string }) => r.id)).toEqual([
      staff.body.requestId,
    ]);
    expect(JSON.stringify(rows)).not.toMatch(
      /identityCiphertext|TokenHash|recipient|@example/,
    );
    const action = (id: string, f = facility) =>
      post(employee, `/onboarding/facilities/${f}/invitations/${id}/revoke`, {
        reason: "Customer request",
      });
    expect((await action(resident.body.requestId)).status).toBe(404);
    expect((await action(staff.body.requestId, other)).status).toBe(403);
    await prismaTest.enrollmentRequest.update({
      where: { id: staff.body.requestId },
      data: {
        acceptedAt: new Date(),
        verifiedAt: new Date(),
        acceptedUserId: employee,
      },
    });
    expect((await action(staff.body.requestId)).status).toBe(409);
  });
  it("reuses cooldown, resend and revoke outbox behavior", async () => {
    const g = await grant(),
      receipt = await invite(),
      id = receipt.body.requestId;
    const action = (name: string) =>
      post(
        employee,
        `/onboarding/facilities/${facility}/invitations/${id}/${name}`,
        { reason: "Customer request" },
      );
    expect((await action("resend")).status).toBe(409);
    await prismaTest.enrollmentRequest.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 600000) },
    });
    await prismaTest.accountInvitationDelivery.updateMany({
      where: { enrollmentId: id },
      data: { status: "FAILED" },
    });
    expect((await action("resend")).status).toBe(201);
    expect((await action("revoke")).status).toBe(201);
    expect(
      await prismaTest.accountInvitationDelivery.count({
        where: { enrollmentId: id, status: "CANCELLED" },
      }),
    ).toBe(2);
    expect(
      await prismaTest.administrativeAuditEvent.findFirst({
        where: { resourceId: id, action: "INVITATION_REVOKED" },
      }),
    ).toMatchObject({
      actorRole: "USER",
      afterState: { grantId: g.id, authority: "DELEGATED_ONBOARDING" },
    });
  });
  it("rejects invalid expiry and retains active ADMIN checks with stale JWT", async () => {
    await expect(
      service.grant(
        admin,
        employee,
        facility,
        new Date(0).toISOString(),
        "Test",
      ),
    ).rejects.toThrow("future expiration");
    await prismaTest.user.update({
      where: { id: admin },
      data: { role: "USER" },
    });
    expect((await get(admin, "/admin/onboarding/employees")).status).toBe(403);
  });
  it("database constraints reject self grants and invalid duration", async () => {
    await expect(
      prismaTest.onboardingAuthorityGrant.create({
        data: {
          actorUserId: admin,
          approvedByUserId: admin,
          facilityId: facility,
          expiresAt: new Date(Date.now() + 3600000),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prismaTest.onboardingAuthorityGrant.create({
        data: {
          actorUserId: employee,
          approvedByUserId: admin,
          facilityId: facility,
          expiresAt: new Date(0),
        },
      }),
    ).rejects.toThrow();
  });

  async function proofs(requestId: string) {
    const messages: string[] = [];
    const provider = {
      send: jest.fn(async (value: { message: string }) => {
        messages.push(value.message);
        return {
          success: true,
          provider: "test-local",
          messageId: randomUUID(),
        };
      }),
    };
    const worker = new InvitationDeliveryWorker(
      prismaTest as never,
      provider as never,
      provider as never,
      new ConfigService(values),
      {} as never,
    );
    await worker.tick();
    return {
      requestId,
      emailCode: messages
        .find((m) => m.includes(requestId) && m.includes("Email code:"))!
        .match(/Email code: (\S+)/)![1]!,
      phoneCode: messages
        .find((m) => m.includes(requestId) && m.includes("Phone code:"))!
        .match(/Phone code: (\S+)/)![1]!,
      password: randomBytes(24).toString("base64url") + "aA1!",
      accept: true as const,
    };
  }
  it.each(["FACILITY_OPERATOR", "FACILITY_ADMIN"] as const)(
    "retains dual-proof activation for delegated %s invitations",
    async (role) => {
      await grant();
      const person = identity();
      const receipt = await service.invite(
        employee,
        { ...person, facilityId: facility },
        randomUUID(),
        role,
      );
      const dto = await proofs(receipt.requestId);
      const enrollment = app.get(EnrollmentService);
      await expect(
        enrollment.verify({ ...dto, phoneCode: "wrong-code" }),
      ).rejects.toThrow();
      await enrollment.verify(dto);
      expect(
        await prismaTest.user.findUnique({ where: { email: person.email } }),
      ).toMatchObject({ role, facilityId: facility, accountStatus: "ACTIVE" });
    },
  );
  it("revocation blocks pending activation without changing accepted customer accounts", async () => {
    await grant();
    const person = identity();
    const receipt = await service.invite(
      employee,
      { ...person, facilityId: facility },
      randomUUID(),
      "FACILITY_OPERATOR",
    );
    const dto = await proofs(receipt.requestId);
    await service.revoke(admin, employee, "Offboarding");
    await expect(app.get(EnrollmentService).verify(dto)).rejects.toThrow();
    expect(
      await prismaTest.user.findUnique({ where: { email: person.email } }),
    ).toBeNull();
  });
  it("offboarding serializes with an in-flight authorized transaction", async () => {
    await grant();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const inFlight = prismaTest.$transaction(
      async (tx) => {
        await onboardingAuthority(tx, employee, facility);
        entered();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    let completed = false;
    const revoke = service
      .revoke(admin, employee, "Offboarding")
      .then((value) => {
        completed = true;
        return value;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(completed).toBe(false);
    } finally {
      release();
    }
    await inFlight;
    await revoke;
    expect((await invite()).status).toBe(403);
  });

  it("does not deliver queued proofs after delegation is revoked", async () => {
    await grant();
    await invite();
    await service.revoke(admin, employee, "Offboarding");
    const provider = { send: jest.fn() };
    const worker = new InvitationDeliveryWorker(
      prismaTest as never,
      provider as never,
      provider as never,
      new ConfigService(values),
      {} as never,
    );
    await worker.tick();
    expect(provider.send).not.toHaveBeenCalled();
    expect(
      await prismaTest.accountInvitationDelivery.count({
        where: { status: "SENT" },
      }),
    ).toBe(0);
  });
  it("rejects duplicate active assignments and permits replacement after individual revocation", async () => {
    const first = await grant();
    await expect(grant()).rejects.toThrow("active grant already exists");
    await service.revoke(admin, employee, "Assignment replacement", first.id);
    const second = await grant();
    expect(second.id).not.toBe(first.id);
    expect((await invite()).status).toBe(201);
  });

  it("prevents a support employee from self-provisioning facility authority", async () => {
    await grant();
    const actor = await prismaTest.user.findUniqueOrThrow({
      where: { id: employee },
    });
    const response = await post(employee, "/onboarding/facility-admins", {
      firstName: actor.firstName,
      lastName: actor.lastName,
      email: actor.email,
      phoneNumber: actor.phoneNumber,
      facilityId: facility,
    });
    expect(response.status).toBe(403);
    expect(await prismaTest.enrollmentRequest.count()).toBe(0);
    expect(
      await prismaTest.user.findUnique({ where: { id: employee } }),
    ).toEqual(actor);
  });

  it("rejects a historical self-invitation at acceptance even after both proofs", async () => {
    await grant();
    const actor = await prismaTest.user.findUniqueOrThrow({
      where: { id: employee },
    });
    const enrollment = app.get(EnrollmentService);
    const receipt = await enrollment.request(
      {
        firstName: actor.firstName,
        lastName: actor.lastName,
        email: actor.email,
        phoneNumber: actor.phoneNumber,
      },
      randomUUID(),
      facility,
      admin,
      "FACILITY_ADMIN",
    );
    // Simulate a pending self-invitation issued before the self-provisioning check.
    await prismaTest.enrollmentRequest.update({
      where: { id: receipt.requestId },
      data: { invitedByUserId: employee },
    });
    const outcome = await enrollment.verify(await proofs(receipt.requestId));
    if (outcome.status !== "AUTHENTICATION_REQUIRED")
      throw new Error("Expected existing-account proof flow");
    await expect(
      enrollment.accept(employee, {
        requestId: receipt.requestId,
        acceptanceToken: outcome.acceptanceToken,
      }),
    ).rejects.toThrow("cannot accept their own");
    expect(
      await prismaTest.user.findUnique({ where: { id: employee } }),
    ).toEqual(actor);
  });
});
