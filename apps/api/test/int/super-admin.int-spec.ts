import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import request from "supertest";
import { prismaTest } from "./prisma-test-client";
import { PrismaService } from "../../src/prisma/prisma.service";
import { JwtStrategy } from "../../src/modules/auth/jwt.strategy";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import { AdminProvisioningController } from "../../src/modules/admin-provisioning/admin-provisioning.controller";
import { AdminProvisioningService } from "../../src/modules/admin-provisioning/admin-provisioning.service";
import { PlatformAdminService } from "../../src/modules/admin-provisioning/platform-admin.service";
import { InvitationDeliveryWorker } from "../../src/modules/admin-provisioning/invitation-delivery.worker";

const secret = "super-admin-integration-only-secret";
const values: Record<string, string | number> = { JWT_ACCESS_SECRET: secret, ENROLLMENT_ENCRYPTION_KEY: 'ab'.repeat(32), BCRYPT_ROUNDS: 4 };
const config = { get: (key: string) => values[key], getOrThrow: (key: string) => { if(values[key] === undefined) throw new Error('Missing test configuration'); return values[key]; } } as unknown as ConfigService;
const jwt = new JwtService({ secret });
const identity = () => ({
  firstName: "Staff",
  lastName: "Private",
  email: randomUUID() + "@example.test",
  phoneNumber: "+23480" + String(Math.random()).slice(2, 10).padEnd(8, "0"),
});
describe("production Super Admin / PostgreSQL", () => {
  let app: INestApplication,
    platform: PlatformAdminService,
    enrollment: EnrollmentService,
    worker: InvitationDeliveryWorker;
  let facility: string, other: string, admin: string, operator: string;
  const messages: Array<{ recipient: string; message: string }> = [];
  const provider = {
    send: jest.fn(async (value: { recipient: string; message: string }) => {
      messages.push(value);
      return { success: true, provider: "test-local", messageId: randomUUID() };
    }),
  };
  const token = (id: string) =>
    jwt.sign({
      sub: id,
      email: "ignored",
      role: "ADMIN",
      credentialVersion: 0,
    });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: "jwt" })],
      controllers: [AdminProvisioningController],
      providers: [
        PlatformAdminService,
        AdminProvisioningService,
        EnrollmentService,
        JwtStrategy,
        { provide: PrismaService, useValue: prismaTest },
        { provide: ConfigService, useValue: config },
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
    platform = module.get(PlatformAdminService);
    enrollment = module.get(EnrollmentService);
    worker = new InvitationDeliveryWorker(
      prismaTest as never,
      provider as never,
      provider as never,
      config,
      {} as never,
    );
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    messages.length = 0;
    provider.send.mockClear();
    facility = (
      await prismaTest.facility.create({
        data: { name: "Facility A", type: "OTHER" },
      })
    ).id;
    other = (
      await prismaTest.facility.create({
        data: { name: "Facility B", type: "OTHER" },
      })
    ).id;
    admin = (
      await prismaTest.user.create({ data: { ...identity(), role: "ADMIN" } })
    ).id;
    operator = (
      await prismaTest.user.create({
        data: {
          ...identity(),
          role: "FACILITY_OPERATOR",
          facilityId: facility,
        },
      })
    ).id;
  });
  async function provision(
    role: "FACILITY_OPERATOR" | "FACILITY_ADMIN" = "FACILITY_OPERATOR",
  ) {
    const person = identity();
    const receipt = await platform.invite(
      admin,
      { ...person, facilityId: facility },
      randomUUID(),
      role,
    );
    return { person, receipt };
  }
  async function verify(requestId: string) {
    await worker.tick();
    const related = messages.filter((m) => m.message.includes(requestId));
    const emailCode = related
      .find((m) => m.message.includes("Email code:"))!
      .message.match(/Email code: (\S+)/)![1]!;
    const phoneCode = related
      .find((m) => m.message.includes("Phone code:"))!
      .message.match(/Phone code: (\S+)/)![1]!;
    return enrollment.verify({
      requestId,
      emailCode,
      phoneCode,
      password: "TestPassword123!",
      accept: true,
    });
  }
  it("allows platform facility creation and listing, denies both to tenant operators", async () => {
    await request(app.getHttpServer())
      .post("/admin/facilities")
      .set("Authorization", "Bearer " + token(operator))
      .send({ name: "Denied", type: "OTHER" })
      .expect(403);
    await request(app.getHttpServer())
      .get("/admin/facilities")
      .set("Authorization", "Bearer " + token(operator))
      .expect(403);
    const result = await request(app.getHttpServer())
      .post("/admin/facilities")
      .set("Authorization", "Bearer " + token(admin))
      .send({ name: "New facility", type: "OTHER" })
      .expect(201);
    expect(
      await prismaTest.administrativeAuditEvent.count({
        where: { resourceId: result.body.id, action: "FACILITY_CREATED" },
      }),
    ).toBe(1);
    const list = await request(app.getHttpServer())
      .get("/admin/facilities")
      .set("Authorization", "Bearer " + token(admin))
      .expect(200);
    expect(list.body.facilities).toHaveLength(3);
  });
  it.each(["FACILITY_OPERATOR", "FACILITY_ADMIN"] as const)(
    "delivers both proofs before activating %s membership",
    async (role) => {
      const { person, receipt } = await provision(role);
      expect(JSON.stringify(receipt)).not.toMatch(
        /activationToken|activationPath|password|email/,
      );
      expect(
        await prismaTest.user.count({ where: { email: person.email } }),
      ).toBe(0);
      expect(
        await prismaTest.accountInvitationDelivery.count({
          where: { enrollmentId: receipt.requestId, status: "QUEUED" },
        }),
      ).toBe(2);
      const result = await verify(receipt.requestId);
      expect(result.status).toBe("ACCEPTED");
      const user = await prismaTest.user.findUniqueOrThrow({
        where: { email: person.email },
      });
      expect(user.role).toBe(role);
      expect(user.facilityId).toBe(facility);
      expect(user.accountStatus).toBe("ACTIVE");
      expect(
        await prismaTest.identityResolutionAudit.count({
          where: { identifierId: receipt.requestId },
        }),
      ).toBeGreaterThanOrEqual(3);
    },
  );
  it("serializes concurrent idempotent provisioning and creates no duplicate seat", async () => {
    const dto = { ...identity(), facilityId: facility };
    const results = await Promise.all([
      platform.invite(admin, dto, "same", "FACILITY_OPERATOR"),
      platform.invite(admin, dto, "same", "FACILITY_OPERATOR"),
    ]);
    expect(results[0]!.requestId).toBe(results[1]!.requestId);
    expect(await prismaTest.enrollmentRequest.count()).toBe(1);
    expect(await prismaTest.accountInvitationDelivery.count()).toBe(2);
  });
  it("denies stale proofs after revocation and records provenance", async () => {
    const { receipt } = await provision();
    await worker.tick();
    await platform.invitationAction(
      admin,
      facility,
      receipt.requestId,
      "revoke",
      "Seat cancelled",
    );
    await expect(verify(receipt.requestId)).rejects.toThrow(
      "Enrollment could not be completed.",
    );
    expect(
      await prismaTest.administrativeAuditEvent.count({
        where: {
          resourceId: receipt.requestId,
          action: "INVITATION_REVOKED",
          reason: "Seat cancelled",
        },
      }),
    ).toBe(1);
  });
  it("honors resend cooldown and serializes concurrent resends", async () => {
    const { receipt } = await provision();
    await worker.tick();
    await expect(
      platform.invitationAction(
        admin,
        facility,
        receipt.requestId,
        "resend",
        "Retry",
      ),
    ).rejects.toThrow("Wait five minutes");
    const old = new Date(Date.now() - 600000);
    await prismaTest.enrollmentRequest.update({
      where: { id: receipt.requestId },
      data: { createdAt: old },
    });
    await prismaTest.accountInvitationDelivery.updateMany({
      where: { enrollmentId: receipt.requestId },
      data: { lastAttemptAt: old },
    });
    const results = await Promise.allSettled([
      platform.invitationAction(
        admin,
        facility,
        receipt.requestId,
        "resend",
        "Retry",
      ),
      platform.invitationAction(
        admin,
        facility,
        receipt.requestId,
        "resend",
        "Retry",
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prismaTest.accountInvitationDelivery.count({
        where: { enrollmentId: receipt.requestId },
      }),
    ).toBe(2);
  });
  it("masks memberships and denies stale cross-facility mutations", async () => {
    const result = await platform.members(admin, facility);
    expect(result.members[0]!.email).toBe("[protected]");
    expect(result.members[0]!.firstName).toBe("[protected]");
    await expect(
      platform.membershipAction(
        admin,
        other,
        operator,
        "revoke",
        "Wrong scope",
      ),
    ).rejects.toThrow("Membership not found.");
    expect(
      (await prismaTest.user.findUniqueOrThrow({ where: { id: operator } }))
        .facilityId,
    ).toBe(facility);
  });
  it("invalidates signed sessions on suspension and audits revocation", async () => {
    const oldToken = token(operator);
    await platform.membershipAction(
      admin,
      facility,
      operator,
      "suspend",
      "Access review",
    );
    await request(app.getHttpServer())
      .get("/admin/facilities")
      .set("Authorization", "Bearer " + oldToken)
      .expect(401);
    await platform.membershipAction(
      admin,
      facility,
      operator,
      "reactivate",
      "Review complete",
    );
    await platform.membershipAction(
      admin,
      facility,
      operator,
      "revoke",
      "Contract ended",
    );
    const user = await prismaTest.user.findUniqueOrThrow({
      where: { id: operator },
    });
    expect(user.facilityId).toBeNull();
    expect(user.isActive).toBe(false);
    expect(
      await prismaTest.administrativeAuditEvent.count({
        where: { resourceId: operator },
      }),
    ).toBe(3);
  });
  it("requires current account authentication before an existing resident accepts staff membership", async () => {
    const person = identity();
    const user = await prismaTest.user.create({
      data: { ...person, role: "USER" },
    });
    const receipt = await platform.invite(
      admin,
      { ...person, facilityId: facility },
      "existing",
      "FACILITY_OPERATOR",
    );
    const result = await verify(receipt.requestId);
    expect(result.status).toBe("AUTHENTICATION_REQUIRED");
    expect(
      (await prismaTest.user.findUniqueOrThrow({ where: { id: user.id } }))
        .facilityId,
    ).toBeNull();
    if (result.status !== "AUTHENTICATION_REQUIRED")
      throw new Error("Expected acceptance");
    await enrollment.accept(user.id, {
      requestId: receipt.requestId,
      acceptanceToken: result.acceptanceToken,
    });
    expect(
      (await prismaTest.user.findUniqueOrThrow({ where: { id: user.id } }))
        .role,
    ).toBe("FACILITY_OPERATOR");
  });
});
