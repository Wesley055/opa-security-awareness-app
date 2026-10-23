import { randomBytes, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { prismaTest as db } from "./prisma-test-client";
import { PrismaService } from "../../src/prisma/prisma.service";
import { JwtStrategy } from "../../src/modules/auth/jwt.strategy";
import { InstitutionalService } from "../../src/modules/onboarding/institutional.service";
import { InstitutionalController } from "../../src/modules/onboarding/institutional.controller";
import { CanonicalOrganizationService } from "../../src/modules/onboarding/canonical-organization.service";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import { hashActivationCredential } from "../../src/shared/security/activation-code";
import type { UserRole } from "@prisma/client";
const secret = randomBytes(32).toString("hex"),
  jwt = new JwtService({ secret });
const configValues: Record<string, unknown> = {
  JWT_ACCESS_SECRET: secret,
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  BCRYPT_ROUNDS: 4,
};
const identity = () => ({
  firstName: "Synthetic",
  lastName: "Commissioning",
  email: randomUUID() + "@example.test",
  phoneNumber: "+23480" + String(Math.random()).slice(2, 10).padEnd(8, "0"),
});
const context = () => ({
  reason: "Reviewed automated commissioning",
  correlationId: randomUUID(),
  caseReference: randomUUID(),
});
describe("first Facility Administrator commissioning / PostgreSQL", () => {
  let app: INestApplication,
    service: InstitutionalService,
    enrollment: EnrollmentService,
    canonical: CanonicalOrganizationService;
  let admin: string, support: string, facility: string, other: string;
  const keys = [
    "AFRICASTALKING_API_KEY",
    "AFRICASTALKING_USERNAME",
    "RESEND_API_KEY",
    "RESEND_FROM_ADDRESS",
  ];
  let saved: Array<string | undefined>;
  const person = async (role: UserRole, facilityId?: string) =>
    (await db.user.create({ data: { ...identity(), role, facilityId } })).id;
  const post = async (
    body: object = { ...identity(), ...context() },
    actor = support,
    target = facility,
  ) => {
    const current = await db.user.findUniqueOrThrow({
      where: { id: actor },
      select: { credentialVersion: true },
    });
    return request(app.getHttpServer())
      .post("/institutional/facilities/" + target + "/first-facility-admin")
      .set(
        "Authorization",
        "Bearer " +
          jwt.sign({
            sub: actor,
            credentialVersion: current.credentialVersion,
          }),
      )
      .set("Idempotency-Key", randomUUID())
      .send(body);
  };
  const proof = async (requestId: string) => {
    const emailCode = randomBytes(20).toString("hex"),
      phoneCode = randomBytes(20).toString("hex");
    await db.enrollmentRequest.update({
      where: { id: requestId },
      data: {
        emailTokenHash: hashActivationCredential(emailCode),
        phoneTokenHash: hashActivationCredential(phoneCode),
      },
    });
    return {
      requestId,
      emailCode,
      phoneCode,
      password: randomBytes(24).toString("hex") + "aA1!",
      accept: true,
    };
  };
  beforeAll(async () => {
    saved = keys.map((k) => process.env[k]);
    process.env.AFRICASTALKING_API_KEY = randomBytes(32).toString("hex");
    process.env.AFRICASTALKING_USERNAME = "sandbox";
    process.env.RESEND_API_KEY = randomBytes(32).toString("hex");
    process.env.RESEND_FROM_ADDRESS = "synthetic@example.test";
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: "jwt" })],
      controllers: [InstitutionalController],
      providers: [
        InstitutionalService,
        EnrollmentService,
        JwtStrategy,
        { provide: PrismaService, useValue: db },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => configValues[k],
            getOrThrow: (k: string) => configValues[k],
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
    service = module.get(InstitutionalService);
    enrollment = module.get(EnrollmentService);
    canonical = new CanonicalOrganizationService(
      db as unknown as PrismaService,
    );
  });
  afterAll(async () => {
    await app?.close();
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  });
  beforeEach(async () => {
    admin = await person("ADMIN");
    support = await person("TECHNICAL_SUPPORT");
    facility = (
      await db.facility.create({
        data: {
          name: "Synthetic commissioning",
          type: "OTHER",
          operationalState: "COMMISSIONING",
        },
      })
    ).id;
    other = (
      await db.facility.create({
        data: {
          name: "Synthetic foreign",
          type: "OTHER",
          operationalState: "COMMISSIONING",
        },
      })
    ).id;
    await service.employment(admin, support, "ACTIVE", context());
    await canonical.assign(admin, facility, support, context());
    await canonical.profile(admin, support, facility, context());
  });
  it("fixed-role HTTP action needs no case/elevation, queues dual proofs and audits current assignment/permission", async () => {
    const body = {
      ...identity(),
      reason: "Reviewed first administrator",
      correlationId: randomUUID(),
    };
    const response = await post(body);
    expect(response.status).toBe(201);
    const row = await db.enrollmentRequest.findUniqueOrThrow({
      where: { id: response.body.requestId },
    });
    expect(row).toMatchObject({
      requestedRole: "FACILITY_ADMIN",
      facilityId: facility,
      invitedByUserId: support,
      verifiedAt: null,
      acceptedAt: null,
    });
    const deliveries = await db.accountInvitationDelivery.findMany({
      where: { enrollmentId: row.id },
    });
    expect(deliveries.map((d) => d.channel).sort()).toEqual(["EMAIL", "SMS"]);
    expect(
      deliveries.every(
        (d) => d.status === "QUEUED" && d.providerAcceptedAt === null,
      ),
    ).toBe(true);
    const audit = await db.administrativeAuditEvent.findFirstOrThrow({
      where: { resourceId: row.id, action: "ENROLLMENT_REQUESTED" },
    });
    expect(audit).toMatchObject({
      actorUserId: support,
      actorRole: "TECHNICAL_SUPPORT",
      facilityId: facility,
      caseReference: null,
      reason: body.reason,
      correlationId: body.correlationId,
    });
    expect(audit.afterState).toMatchObject({
      provisioningMode: "FIRST_FACILITY_ADMIN",
      assignmentId: expect.any(String),
      grantId: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|token|ciphertext|emailCode|phoneCode/i,
    );
    expect(await db.user.count({ where: { email: body.email } })).toBe(0);
  });
  it("canonical dual-proof verification creates ACTIVE first administrator and closes ordinary provisioning", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    const dto = await proof(response.body.requestId);
    await expect(
      enrollment.verify({ ...dto, emailCode: randomUUID() }),
    ).rejects.toThrow();
    const accepted = await enrollment.verify(dto);
    expect(accepted.status).toBe("ACCEPTED");
    expect(
      await db.user.findFirst({
        where: { facilityId: facility, role: "FACILITY_ADMIN" },
      }),
    ).toMatchObject({
      accountStatus: "ACTIVE",
      membershipState: "ACTIVE",
      isActive: true,
    });
    expect((await post()).status).toBe(403);
  });
  it("competing canonical verification transactions create only one first administrator", async () => {
    const a = await post(),
      b = await post();
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const pa = await proof(a.body.requestId),
      pb = await proof(b.body.requestId);
    const results = await Promise.allSettled([
      enrollment.verify(pa),
      enrollment.verify(pb),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.user.count({
        where: {
          facilityId: facility,
          role: "FACILITY_ADMIN",
          accountStatus: "ACTIVE",
          membershipState: "ACTIVE",
        },
      }),
    ).toBe(1);
  });
  it.each([
    "FACILITY_OPERATOR",
    "USER",
    "FACILITY_ADMIN",
    "ADMIN",
    "TECHNICAL_SUPPORT",
  ])("rejects client role injection %s", async (role) => {
    expect((await post({ ...identity(), ...context(), role })).status).toBe(
      400,
    );
  });
  it.each(["SUSPENDED", "ENDED"] as const)(
    "denies %s employment with otherwise valid permissions",
    async (state) => {
      await service.employment(admin, support, state, context());
      expect((await post()).status).toBe(403);
    },
  );
  it.each(["CREATED", "OPERATIONAL", "SUSPENDED", "DECOMMISSIONED"] as const)(
    "denies lifecycle %s",
    async (state) => {
      await db.facility.update({
        where: { id: facility },
        data: { operationalState: state },
      });
      expect((await post()).status).toBe(403);
    },
  );
  it("denies a foreign facility", async () => {
    expect((await post(undefined, support, other)).status).toBe(403);
  });
  it("denies revoked assignment at mutation after successful eligibility", async () => {
    expect(
      (await service.firstFacilityAdminEligibility(support, facility)).eligible,
    ).toBe(true);
    await db.facilitySupportAssignment.updateMany({
      where: { facilityId: facility, actorUserId: support },
      data: { revokedAt: new Date() },
    });
    expect((await post()).status).toBe(403);
  });
  it("denies absent Standard Facility Support provisioning permission", async () => {
    await db.supportCapabilityGrant.updateMany({
      where: {
        actorUserId: support,
        facilityId: facility,
        capability: "STAFF_PROVISION",
      },
      data: { revokedAt: new Date() },
    });
    expect((await post()).status).toBe(403);
  });
  it("denies expired permission", async () => {
    await db.supportCapabilityGrant.updateMany({
      where: {
        actorUserId: support,
        facilityId: facility,
        capability: "STAFF_PROVISION",
      },
      data: { createdAt: new Date(Date.now() - 3600000), expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await post()).status).toBe(403);
  });
  it("denies an additional administrator without creating another enrollment", async () => {
    await person("FACILITY_ADMIN", facility);
    expect(
      (await service.firstFacilityAdminEligibility(support, facility)).eligible,
    ).toBe(false);
    expect((await post()).status).toBe(403);
    expect(
      await db.enrollmentRequest.count({ where: { facilityId: facility } }),
    ).toBe(0);
  });
  it("denies self-enrollment", async () => {
    const actor = await db.user.findUniqueOrThrow({ where: { id: support } });
    expect(
      (await post({ ...identity(), email: actor.email, ...context() })).status,
    ).toBe(403);
  });
  it("rechecks assignment at verification after invitation was issued", async () => {
    const response = await post();
    const dto = await proof(response.body.requestId);
    await db.facilitySupportAssignment.updateMany({
      where: { facilityId: facility },
      data: { revokedAt: new Date() },
    });
    await expect(enrollment.verify(dto)).rejects.toThrow();
    expect(
      await db.user.count({
        where: { facilityId: facility, role: "FACILITY_ADMIN" },
      }),
    ).toBe(0);
  });
  it.each(["USER", "FACILITY_OPERATOR"] as const)(
    "ordinary enrollment writer denies %s without exceptional authority",
    async (role) => {
      await expect(
        enrollment.request(identity(), randomUUID(), facility, support, role),
      ).rejects.toThrow("Support Case");
    },
  );
  it("dedicated action denies platform actor and retains ordinary ADMIN invitation authority", async () => {
    expect((await post(undefined, admin)).status).toBe(403);
    await expect(
      enrollment.request(
        identity(),
        randomUUID(),
        facility,
        admin,
        "FACILITY_ADMIN",
      ),
    ).resolves.toHaveProperty("requestId");
  });
  it("missing reason is rejected", async () => {
    expect(
      (await post({ ...identity(), correlationId: randomUUID() })).status,
    ).toBe(400);
  });
});
