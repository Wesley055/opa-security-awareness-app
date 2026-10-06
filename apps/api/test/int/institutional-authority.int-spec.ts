import { CanonicalOrganizationService } from "../../src/modules/onboarding/canonical-organization.service";
import {
  hashActivationCredential,
  normalizeActivationCredential,
} from "../../src/shared/security/activation-code";
import { RefreshTokenService } from "../../src/modules/refresh-token/refresh-token.service";
import { ProtectedIdentityController } from "../../src/modules/protected-identity/protected-identity.controller";
import { ProtectedIdentityService } from "../../src/modules/protected-identity/protected-identity.service";
import {
  IdentityCrypto,
  LocalIdentityCrypto,
} from "../../src/modules/protected-identity/identity-crypto";
import { PlatformAdminService as LegacyPlatformService } from "../../src/modules/admin-provisioning/platform-admin.service";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, randomUUID } from "crypto";
import request from "supertest";
import { prismaTest as db } from "./prisma-test-client";
import { PrismaService } from "../../src/prisma/prisma.service";
import { JwtStrategy } from "../../src/modules/auth/jwt.strategy";
import { InstitutionalService } from "../../src/modules/onboarding/institutional.service";
import {
  InstitutionalController,
  SupportAdministrationController,
} from "../../src/modules/onboarding/institutional.controller";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import { IncidentsController } from "../../src/modules/incidents/incidents.controller";
import { IncidentsService } from "../../src/modules/incidents/incidents.service";
import { IncidentTimelineService } from "../../src/modules/incident-timeline/incident-timeline.service";
import { IncidentAccessTokenService } from "../../src/modules/incident-access/incident-access-token.service";
import { JourneySessionService } from "../../src/modules/journey/journey-session.service";
import { AdminProvisioningController } from "../../src/modules/admin-provisioning/admin-provisioning.controller";
import { AdminProvisioningService } from "../../src/modules/admin-provisioning/admin-provisioning.service";
import { PlatformAdminService } from "../../src/modules/admin-provisioning/platform-admin.service";
import type { SupportCapability, UserRole } from "@prisma/client";
const piiCrypto = new LocalIdentityCrypto(
  new Map([["test", randomBytes(32)]]),
  "test",
  randomBytes(32),
  "test-lookup",
);
const secret = randomBytes(32).toString("hex"),
  jwt = new JwtService({ secret });
const values: Record<string, unknown> = {
  JWT_ACCESS_SECRET: secret,
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  BCRYPT_ROUNDS: 4,
  JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
  JWT_REFRESH_EXPIRES_IN: "1h",
  JWT_ACCESS_EXPIRES_IN: "15m",
};
const identity = () => ({
  email: randomUUID() + "@example.test",
  phoneNumber: "+23480" + String(Math.random()).slice(2, 10).padEnd(8, "0"),
  firstName: "Synthetic",
  lastName: "Acceptance",
});
let currentCaseId: string;
const context = () => ({
  reason: "Synthetic reviewed support case",
  caseReference: currentCaseId ?? randomUUID(),
  correlationId: randomUUID(),
});
describe("institutional authority / PostgreSQL", () => {
  let app: INestApplication, service: InstitutionalService;
  let admin: string,
    support: string,
    fa: string,
    operator: string,
    owner: string,
    a: string,
    b: string,
    incident: string;
  const token = (id: string) =>
    jwt.sign({ sub: id, role: "ADMIN", credentialVersion: 0 });
  const post = (id: string, path: string, data: object = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set("Authorization", "Bearer " + token(id))
      .set("Idempotency-Key", randomUUID())
      .send(data);
  const get = (id: string, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set("Authorization", "Bearer " + token(id));
  const person = async (role: UserRole, facilityId?: string) =>
    (await db.user.create({ data: { ...identity(), role, facilityId } })).id;
  const grant = (
    capability: SupportCapability,
    facilityId: string | null = a,
  ) =>
    service.grant(
      admin,
      support,
      capability,
      facilityId,
      new Date(Date.now() + 3600000).toISOString(),
      context(),
    );
  const deliveryKeys = [
    "AFRICASTALKING_API_KEY",
    "AFRICASTALKING_USERNAME",
    "RESEND_API_KEY",
    "RESEND_FROM_ADDRESS",
  ] as const;
  let priorDelivery: Record<string, string | undefined>;
  const elevate = (capability: SupportCapability) =>
    new CanonicalOrganizationService(db as unknown as PrismaService).elevate(
      admin,
      support,
      a,
      capability,
      new Date(),
      new Date(Date.now() + 3600000),
      context(),
    );
  beforeAll(async () => {
    priorDelivery = Object.fromEntries(
      deliveryKeys.map((key) => [key, process.env[key]]),
    );
    process.env.AFRICASTALKING_API_KEY = randomBytes(32).toString("hex");
    process.env.AFRICASTALKING_USERNAME = "sandbox";
    process.env.RESEND_API_KEY = randomBytes(32).toString("hex");
    process.env.RESEND_FROM_ADDRESS = "synthetic@example.test";
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: "jwt" })],
      controllers: [
        ProtectedIdentityController,
        InstitutionalController,
        SupportAdministrationController,
        IncidentsController,
        AdminProvisioningController,
      ],
      providers: [
        ProtectedIdentityService,
        { provide: IdentityCrypto, useValue: piiCrypto },
        InstitutionalService,
        EnrollmentService,
        IncidentsService,
        IncidentTimelineService,
        IncidentAccessTokenService,
        JourneySessionService,
        AdminProvisioningService,
        PlatformAdminService,
        JwtStrategy,
        { provide: PrismaService, useValue: db },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => values[k],
            getOrThrow: (k: string) => values[k],
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
  });
  afterAll(async () => {
    for (const key of deliveryKeys) {
      if (priorDelivery[key] === undefined) delete process.env[key];
      else process.env[key] = priorDelivery[key];
    }
    await app?.close();
  });
  beforeEach(async () => {
    admin = await person("ADMIN");
    a = (
      await db.facility.create({ data: { name: "Synthetic A", type: "OTHER" } })
    ).id;
    b = (
      await db.facility.create({ data: { name: "Synthetic B", type: "OTHER" } })
    ).id;
    fa = await person("FACILITY_ADMIN", a);
    operator = await person("FACILITY_OPERATOR", a);
    owner = await person("USER", a);
    support = await person("TECHNICAL_SUPPORT");
    await db.supportEmployment.create({
      data: { userId: support, appointedByUserId: admin },
    });
    await db.facilitySupportAssignment.create({
      data: {
        actorUserId: support,
        facilityId: a,
        assignedByUserId: admin,
        reason: "Synthetic canonical assignment",
      },
    });
    currentCaseId = (
      await db.supportCase.create({
        data: {
          facilityId: a,
          reportedByUserId: admin,
          assignedToUserId: support,
          category: "Regression",
          summary: "Synthetic review",
          priority: "NORMAL",
        },
      })
    ).id;
    incident = (
      await db.incident.create({
        data: { userId: owner, facilityId: a, trigger: "SOS_BUTTON" },
      })
    ).id;
  });

  it("administration replay: canonical support invitation and receipt remain unique across concurrent retries", async () => {
    const ctx = context(),
      data = identity(),
      key = randomUUID();
    const [x, y] = await Promise.all([
      service.invite(admin, undefined, "TECHNICAL_SUPPORT", data, key, ctx),
      service.invite(admin, undefined, "TECHNICAL_SUPPORT", data, key, ctx),
    ]);
    expect(x.requestId).toBe(y.requestId);
    expect(
      await db.accountInvitationDelivery.count({
        where: { enrollmentId: x.requestId },
      }),
    ).toBe(2);
    expect(
      await db.administrativeAuditEvent.count({
        where: { correlationId: ctx.correlationId },
      }),
    ).toBe(1);
    await expect(
      service.invite(
        admin,
        undefined,
        "TECHNICAL_SUPPORT",
        { ...data, firstName: "Different" },
        key,
        ctx,
      ),
    ).rejects.toThrow();
    expect(
      (await get(admin, "/admin/support/operations/" + ctx.correlationId)).body,
    ).toMatchObject({
      status: "COMMITTED",
      receipt: { resourceId: x.requestId },
    });
  });
  it("administration replay: concurrent grant creates one grant and one audit receipt", async () => {
    const ctx = context();
    const args = [admin, support, "STAFF_READ", a, undefined, ctx] as const;
    const [x, y] = await Promise.all([
      service.grant(...args),
      service.grant(...args),
    ]);
    expect(x!.id).toBe(y!.id);
    expect(
      await db.supportCapabilityGrant.count({
        where: { actorUserId: support },
      }),
    ).toBe(1);
    expect(
      await db.administrativeAuditEvent.count({
        where: { correlationId: ctx.correlationId },
      }),
    ).toBe(1);
    expect(
      (await get(admin, "/admin/support/operations/" + ctx.correlationId)).body,
    ).toMatchObject({ status: "COMMITTED", receipt: { resourceId: x!.id } });
    expect(
      (await get(support, "/admin/support/operations/" + ctx.correlationId))
        .status,
    ).toBe(403);
    await expect(
      service.grant(admin, support, "STAFF_PROVISION", a, undefined, ctx),
    ).rejects.toThrow();
  });
  it("administration replay: employment replay does not invalidate credentials twice", async () => {
    const ctx = context();
    await service.employment(admin, support, "SUSPENDED", ctx);
    const first = await db.user.findUniqueOrThrow({ where: { id: support } });
    await service.employment(admin, support, "SUSPENDED", ctx);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: support } }))
        .credentialVersion,
    ).toBe(first.credentialVersion);
    expect(
      await db.administrativeAuditEvent.count({
        where: { correlationId: ctx.correlationId },
      }),
    ).toBe(1);
  });
  it("administration replay: revoke-all is atomic, replay safe and retains employment and history", async () => {
    await grant("STAFF_READ");
    await grant("STAFF_PROVISION");
    const ctx = context();
    await post(
      admin,
      "/admin/support/employees/" + support + "/revoke-all",
      ctx,
    ).expect(201);
    await post(
      admin,
      "/admin/support/employees/" + support + "/revoke-all",
      ctx,
    ).expect(201);
    expect(
      await db.supportCapabilityGrant.count({
        where: { actorUserId: support, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await db.supportCapabilityGrant.count({
        where: { actorUserId: support },
      }),
    ).toBe(2);
    expect(
      (
        await db.supportEmployment.findUniqueOrThrow({
          where: { userId: support },
        })
      ).state,
    ).toBe("ACTIVE");
    expect(
      (await get(support, "/institutional/facilities/" + a + "/members"))
        .status,
    ).toBe(403);
    expect(
      await db.administrativeAuditEvent.count({
        where: { correlationId: ctx.correlationId },
      }),
    ).toBe(1);
    await post(
      support,
      "/admin/support/employees/" + support + "/revoke-all",
      context(),
    ).expect(403);
  });
  it("administration replay: unknown receipt is not success and is actor scoped", async () => {
    const id = randomUUID();
    expect(
      (await get(admin, "/admin/support/operations/" + id)).body,
    ).toMatchObject({ status: "NOT_RECORDED", receipt: null });
    const other = await person("ADMIN"),
      ctx = context();
    await service.grant(admin, support, "STAFF_READ", a, undefined, ctx);
    expect(
      (await get(other, "/admin/support/operations/" + ctx.correlationId)).body
        .status,
    ).toBe("NOT_RECORDED");
  });
  it.each(["SUSPENDED", "ENDED"] as const)(
    "support administration %s denies an otherwise valid retained capability",
    async (state) => {
      await grant("STAFF_READ");
      // Simulate retained capability data independently of the lifecycle's revocation side effect.
      await db.supportEmployment.update({
        where: { userId: support },
        data: { state },
      });
      expect(
        (await get(support, "/institutional/facilities/" + a + "/members"))
          .status,
      ).toBe(403);
      expect(
        (
          await post(
            support,
            "/admin/support/employees/" + support + "/employment",
            { ...context(), state: "ACTIVE" },
          )
        ).status,
      ).toBe(403);
    },
  );
  it("support administration directory is ADMIN-only and excludes protected identity", async () => {
    await grant("STAFF_READ");
    const response = await get(admin, "/admin/support/employees");
    expect(response.status).toBe(200);
    expect(response.body.employees[0]).toMatchObject({
      id: support,
      role: "TECHNICAL_SUPPORT",
      facilityId: null,
      supportEmployment: { state: "ACTIVE" },
    });
    expect(response.body.employees[0]).not.toHaveProperty("email");
    expect(response.body.employees[0]).not.toHaveProperty("phoneNumber");
    expect(response.body.employees[0].supportEmployment).not.toHaveProperty(
      "expiresAt",
    );
    expect((await get(support, "/admin/support/employees")).status).toBe(403);
  });
  it.each(["SUSPENDED", "ENDED"] as const)(
    "support administration %s invalidates old tokens, refresh and restored privileged context while preserving history",
    async (state) => {
      const g = await grant("STAFF_READ");
      expect(
        (await get(support, "/institutional/facilities/" + a + "/members"))
          .status,
      ).toBe(200);
      const refreshService = new RefreshTokenService(
        jwt,
        new ConfigService(values),
        db as unknown as PrismaService,
      );
      const refresh = refreshService.createRefreshToken({
        id: support,
        email: randomUUID() + "@example.test",
        credentialVersion: 0,
      });
      const provenance = context();
      expect(
        (
          await post(
            admin,
            "/admin/support/employees/" + support + "/employment",
            { ...provenance, state },
          )
        ).status,
      ).toBe(201);
      expect((await get(support, "/institutional/context")).status).toBe(401);
      await expect(refreshService.rotate(refresh)).rejects.toMatchObject({
        status: 401,
      });
      const fresh = jwt.sign({
        sub: support,
        role: "TECHNICAL_SUPPORT",
        credentialVersion: 1,
      });
      expect(
        (
          await request(app.getHttpServer())
            .get("/institutional/context")
            .set("Authorization", "Bearer " + fresh)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .get("/institutional/facilities/" + a + "/members")
            .set("Authorization", "Bearer " + fresh)
        ).status,
      ).toBe(403);
      expect(
        await db.supportCapabilityGrant.findUnique({ where: { id: g.id } }),
      ).toMatchObject({ revokedAt: expect.any(Date) });
      expect(
        await db.user.findUnique({ where: { id: support } }),
      ).toMatchObject({ role: "TECHNICAL_SUPPORT" });
      expect(
        await db.administrativeAuditEvent.findFirst({
          where: { action: "SUPPORT_CAPABILITY_GRANTED", resourceId: g.id },
        }),
      ).not.toBeNull();
      expect(
        await db.administrativeAuditEvent.findFirst({
          where: { correlationId: provenance.correlationId },
        }),
      ).toMatchObject({
        actorUserId: admin,
        actorRole: "ADMIN",
        resourceId: support,
        reason: provenance.reason,
        caseReference: provenance.caseReference,
        beforeState: { state: "ACTIVE" },
        afterState: { state },
      });
      if (state === "ENDED") {
        expect(
          (
            await post(
              admin,
              "/admin/support/employees/" + support + "/employment",
              { ...context(), state: "ACTIVE" },
            )
          ).status,
        ).toBe(409);
        expect(
          (
            await post(
              admin,
              "/admin/support/employees/" + support + "/employment",
              { ...context(), state: "SUSPENDED" },
            )
          ).status,
        ).toBe(409);
      } else {
        expect(
          (
            await post(
              admin,
              "/admin/support/employees/" + support + "/employment",
              { ...context(), state: "ACTIVE" },
            )
          ).status,
        ).toBe(201);
        expect(
          await db.supportCapabilityGrant.count({
            where: { actorUserId: support, revokedAt: null },
          }),
        ).toBe(0);
      }
    },
  );
  it.each(["ACTIVE", "SUSPENDED", "ENDED"])(
    "support cannot administer its own employment (%s)",
    async (state) => {
      expect(
        (
          await post(
            support,
            "/admin/support/employees/" + support + "/employment",
            { ...context(), state },
          )
        ).status,
      ).toBe(403);
    },
  );
  it("support invitation carries reviewed provenance and does not precreate an account or employment", async () => {
    const details = identity(),
      provenance = context();
    const response = await post(admin, "/admin/support/invitations", {
      ...details,
      ...provenance,
    });
    expect(response.status).toBe(201);
    expect(
      await db.enrollmentRequest.findUnique({
        where: { id: response.body.requestId },
      }),
    ).toMatchObject({
      requestedRole: "TECHNICAL_SUPPORT",
      facilityId: null,
      acceptedAt: null,
    });
    expect(
      await db.user.findUnique({ where: { email: details.email } }),
    ).toBeNull();
    expect(
      await db.administrativeAuditEvent.findFirst({
        where: {
          resourceId: response.body.requestId,
          action: "ENROLLMENT_REQUESTED",
        },
      }),
    ).toMatchObject({
      actorUserId: admin,
      actorRole: "ADMIN",
      reason: provenance.reason,
      caseReference: provenance.caseReference,
      correlationId: provenance.correlationId,
    });
  });

  it("support enrollment acceptance establishes permanent employment without automatic capabilities", async () => {
    const response = await post(admin, "/admin/support/invitations", {
      ...identity(),
      ...context(),
    });
    expect(response.status).toBe(201);
    const emailCode = randomBytes(16).toString("hex"),
      phoneCode = randomBytes(16).toString("hex");
    // Disposable proof fixture: no real message is sent and no proof is exposed.
    await db.enrollmentRequest.update({
      where: { id: response.body.requestId },
      data: {
        emailTokenHash: hashActivationCredential(
          normalizeActivationCredential(emailCode),
        ),
        phoneTokenHash: hashActivationCredential(
          normalizeActivationCredential(phoneCode),
        ),
      },
    });
    const enrollment = app.get(EnrollmentService);
    const result = await enrollment.verify({
      requestId: response.body.requestId,
      emailCode,
      phoneCode,
      password: randomBytes(24).toString("base64url") + "aA1!",
      accept: true,
    });
    expect(result.status).toBe("ACCEPTED");
    const receipt = await db.enrollmentRequest.findUniqueOrThrow({
      where: { id: response.body.requestId },
    });
    const user = await db.user.findUniqueOrThrow({
      where: { id: receipt.acceptedUserId! },
      include: { supportEmployment: true },
    });
    expect(user).toMatchObject({
      role: "TECHNICAL_SUPPORT",
      facilityId: null,
      isActive: true,
      accountStatus: "ACTIVE",
      supportEmployment: { state: "ACTIVE", appointedByUserId: admin },
    });
    expect(user.supportEmployment).not.toHaveProperty("expiresAt");
    expect(
      await db.supportCapabilityGrant.count({
        where: { actorUserId: user.id },
      }),
    ).toBe(0);
    await service.grant(
      admin,
      user.id,
      "STAFF_PROVISION",
      a,
      undefined,
      context(),
    );
    expect(
      await db.supportCapabilityGrant.findFirst({
        where: { actorUserId: user.id },
      }),
    ).toMatchObject({
      capability: "STAFF_PROVISION",
      facilityId: a,
      expiresAt: null,
      approvedByUserId: admin,
    });
  });

  it("support delivery directory exposes durable channel truth without recipient or provider identifiers", async () => {
    const receipt = await post(admin, "/admin/support/invitations", {
      ...identity(),
      ...context(),
    });
    expect(receipt.status).toBe(201);
    await db.accountInvitationDelivery.updateMany({
      where: { enrollmentId: receipt.body.requestId, channel: "EMAIL" },
      data: {
        status: "SENT",
        deliveryStatus: "PROVIDER_ACCEPTED",
        providerAcceptedAt: new Date(),
        attemptCount: 1,
      },
    });
    await db.accountInvitationDelivery.updateMany({
      where: { enrollmentId: receipt.body.requestId, channel: "SMS" },
      data: {
        status: "FAILED",
        deliveryStatus: "UNKNOWN",
        failureCategory: "NETWORK",
        attemptCount: 1,
      },
    });
    const result = await get(admin, "/admin/support/employees");
    expect(result.status).toBe(200);
    const invitation = result.body.invitations.find(
      (i: { id: string }) => i.id === receipt.body.requestId,
    );
    expect(invitation.deliveries).toHaveLength(2);
    expect(invitation.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "EMAIL",
          deliveryStatus: "PROVIDER_ACCEPTED",
          confirmedDeliveredAt: null,
        }),
        expect.objectContaining({
          channel: "SMS",
          deliveryStatus: "UNKNOWN",
          failureCategory: "NETWORK",
        }),
      ]),
    );
    for (const d of invitation.deliveries) {
      expect(d).not.toHaveProperty("recipient");
      expect(d).not.toHaveProperty("providerMessageId");
      expect(d).not.toHaveProperty("requestCiphertext");
    }
    expect(
      await db.accountInvitationDelivery.count({
        where: { enrollmentId: receipt.body.requestId },
      }),
    ).toBe(2);
    expect(
      await db.enrollmentRequest.findUnique({
        where: { id: receipt.body.requestId },
      }),
    ).not.toBeNull();
  });
  it("operator acknowledgement and progress are durable without changing OPEN; retry cannot rewrite", async () => {
    const data = {
      type: "ACKNOWLEDGED",
      note: "Operator received incident",
      correlationId: randomUUID(),
    };
    const response = await post(
      operator,
      "/incidents/" + incident + "/operations",
      data,
    );
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("OPEN");
    expect(
      (await post(operator, "/incidents/" + incident + "/operations", data))
        .body.eventId,
    ).toBe(response.body.eventId);
    expect(
      (
        await post(operator, "/incidents/" + incident + "/operations", {
          ...data,
          note: "Changed",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(operator, "/incidents/" + incident + "/operations", {
          type: "RESPONSE_PROGRESS",
          note: "Response underway",
          correlationId: randomUUID(),
        })
      ).status,
    ).toBe(201);
    expect(
      await db.incidentTimelineEvent.count({ where: { incidentId: incident } }),
    ).toBe(2);
    expect(
      (await db.incident.findUniqueOrThrow({ where: { id: incident } })).status,
    ).toBe("OPEN");
  });
  it.each(["institutional-resolution", "close", "delete"])(
    "operator cannot perform institutional %s",
    async (action) => {
      expect(
        (
          await post(
            operator,
            "/incidents/" + incident + "/" + action,
            context(),
          )
        ).status,
      ).toBeGreaterThanOrEqual(400);
    },
  );
  it.each(["resolve", "cancel"])(
    "operator cannot use owner %s on another person incident",
    async (action) => {
      expect(
        (
          await request(app.getHttpServer())
            .patch("/incidents/" + incident + "/" + action)
            .set("Authorization", "Bearer " + token(operator))
            .send({ reason: "Not owner" })
        ).status,
      ).toBe(404);
    },
  );
  it("operator cannot onboard or deprovision", async () => {
    expect(
      (
        await post(
          operator,
          "/institutional/facilities/" + a + "/invitations",
          { ...identity(), ...context(), role: "USER" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          operator,
          "/institutional/facilities/" + a + "/members/" + owner + "/access",
          { ...context(), action: "revoke" },
        )
      ).status,
    ).toBe(403);
  });
  it.each(["USER", "FACILITY_OPERATOR", "FACILITY_ADMIN"])(
    "Facility Admin can invite own-facility %s",
    async (role) => {
      expect(
        (
          await post(fa, "/institutional/facilities/" + a + "/invitations", {
            ...identity(),
            ...context(),
            role,
          })
        ).status,
      ).toBe(201);
    },
  );
  it("Facility Admin cannot access another facility", async () => {
    expect(
      (await get(fa, "/institutional/facilities/" + b + "/members")).status,
    ).toBe(403);
  });
  it.each(["USER", "FACILITY_OPERATOR"])(
    "deprovisioning %s retains history and rejects stale credentials",
    async (role) => {
      const id = role === "USER" ? owner : operator;
      const refreshService = new RefreshTokenService(
        jwt,
        new ConfigService(values),
        db as unknown as PrismaService,
      );
      const staleRefresh = refreshService.createRefreshToken({
        id,
        email: randomUUID() + "@example.test",
        credentialVersion: 0,
      });
      expect(
        (
          await post(
            fa,
            "/institutional/facilities/" + a + "/members/" + id + "/access",
            { ...context(), action: "revoke" },
          )
        ).status,
      ).toBe(201);
      const user = await db.user.findUniqueOrThrow({ where: { id } });
      expect(user).toMatchObject({
        facilityId: a,
        membershipState: "REVOKED",
        isActive: true,
        credentialVersion: 1,
      });
      expect((await get(id, "/incidents")).status).toBe(401);
      await expect(refreshService.rotate(staleRefresh)).rejects.toMatchObject({
        status: 401,
      });
      expect(await db.incident.count({ where: { id: incident } })).toBe(1);
    },
  );
  it("cannot remove last admin; concurrent removals cannot both succeed", async () => {
    expect(
      (
        await post(
          admin,
          "/institutional/facilities/" + a + "/members/" + fa + "/access",
          { ...context(), action: "revoke" },
        )
      ).status,
    ).toBe(409);
    const second = await person("FACILITY_ADMIN", a);
    const responses = await Promise.all(
      [fa, second].map((id) =>
        post(
          admin,
          "/institutional/facilities/" + a + "/members/" + id + "/access",
          { ...context(), action: "revoke" },
        ),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await db.user.count({
        where: {
          facilityId: a,
          role: "FACILITY_ADMIN",
          membershipState: "ACTIVE",
          isActive: true,
        },
      }),
    ).toBe(1);
  });
  it("database rejects bypassing last-admin service and zero-admin facility is uncommissioned", async () => {
    await expect(
      db.user.update({ where: { id: fa }, data: { isActive: false } }),
    ).rejects.toThrow();
    expect(
      (await db.facility.findUniqueOrThrow({ where: { id: b } }))
        .commissionedAt,
    ).toBeNull();
    expect(
      (
        await post(admin, "/admin/support/facilities/" + b + "/state", {
          ...context(),
          action: "reactivate",
        })
      ).status,
    ).toBe(409);
  });
  it("support requires exact current scope and revocation takes effect on existing token", async () => {
    expect(
      (await get(support, "/institutional/facilities/" + a + "/members"))
        .status,
    ).toBe(403);
    const g = await grant("STAFF_READ");
    expect(
      (await get(support, "/institutional/facilities/" + a + "/members"))
        .status,
    ).toBe(200);
    expect(
      (await get(support, "/institutional/facilities/" + b + "/members"))
        .status,
    ).toBe(403);
    await service.revokeGrant(admin, g.id, context());
    expect(
      (await get(support, "/institutional/facilities/" + a + "/members"))
        .status,
    ).toBe(403);
  });
  it("support cannot create facility, grant itself authority, or invite ADMIN", async () => {
    expect(
      (
        await post(support, "/admin/facilities", {
          name: "Forbidden",
          type: "OTHER",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(support, "/admin/support/employees/" + support + "/grants", {
          ...context(),
          capability: "STAFF_READ",
          facilityId: a,
        })
      ).status,
    ).toBe(403);
    await grant("STAFF_PROVISION");
    expect(
      (
        await post(support, "/institutional/facilities/" + a + "/invitations", {
          ...identity(),
          role: "ADMIN",
        })
      ).status,
    ).toBe(400);
  });
  it("support employment suspension invalidates sessions and grants", async () => {
    await grant("STAFF_READ");
    await service.employment(admin, support, "SUSPENDED", context());
    expect(
      (await get(support, "/institutional/facilities/" + a + "/members"))
        .status,
    ).toBe(401);
    expect(
      await db.supportCapabilityGrant.count({
        where: { actorUserId: support, revokedAt: null },
      }),
    ).toBe(0);
  });
  it.each(["ADMIN", "FACILITY_ADMIN", "TECHNICAL_SUPPORT"])(
    "%s resolution retains operational history and records actual authority",
    async (role) => {
      const actor =
        role === "ADMIN" ? admin : role === "FACILITY_ADMIN" ? fa : support;
      if (role === "TECHNICAL_SUPPORT") {
        await grant("INCIDENT_RESOLVE");
        await elevate("INCIDENT_RESOLVE");
      }
      await post(operator, "/incidents/" + incident + "/operations", {
        type: "ACKNOWLEDGED",
        note: "Received",
        correlationId: randomUUID(),
      });
      await post(operator, "/incidents/" + incident + "/operations", {
        type: "DISPATCHED",
        note: "Responder dispatched",
        correlationId: randomUUID(),
      });
      expect(
        (
          await post(
            actor,
            "/incidents/" + incident + "/institutional-resolution",
            context(),
          )
        ).status,
      ).toBe(201);
      expect(
        await db.incidentTimelineEvent.count({
          where: { incidentId: incident },
        }),
      ).toBe(3);
      expect(
        await db.administrativeAuditEvent.findFirst({
          where: { resourceId: incident, action: "INCIDENT_RESOLVED" },
        }),
      ).toMatchObject({ actorUserId: actor, actorRole: role });
      expect(
        (await db.incident.findUniqueOrThrow({ where: { id: incident } }))
          .status,
      ).toBe("RESOLVED");
    },
  );
  it("expired sensitive grant denies resolution", async () => {
    const g = await grant("INCIDENT_RESOLVE");
    await elevate("INCIDENT_RESOLVE");
    await db.$executeRaw`UPDATE "SupportCapabilityGrant" SET "createdAt"=clock_timestamp()-interval '2 hours',"expiresAt"=clock_timestamp()-interval '1 hour' WHERE id=${g.id}::uuid`;
    expect(
      (
        await post(
          support,
          "/incidents/" + incident + "/institutional-resolution",
          context(),
        )
      ).status,
    ).toBe(403);
  });
  it("owner closure races safely with institutional resolution", async () => {
    const results = await Promise.all([
      post(
        fa,
        "/incidents/" + incident + "/institutional-resolution",
        context(),
      ),
      request(app.getHttpServer())
        .patch("/incidents/" + incident + "/resolve")
        .set("Authorization", "Bearer " + token(owner))
        .send({ reason: "I am safe" }),
    ]);
    expect(results.filter((r) => r.status < 300)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(
      await db.incidentTimelineEvent.count({
        where: { incidentId: incident, type: "INCIDENT_RESOLVED" },
      }),
    ).toBe(1);
  });

  it("Operator sees own facility incidents but not another facility", async () => {
    const own = await get(
      operator,
      "/institutional/facilities/" + a + "/incidents",
    );
    expect(own.status).toBe(200);
    expect(own.body.map((row: { id: string }) => row.id)).toContain(incident);
    expect(
      (await get(operator, "/institutional/facilities/" + b + "/incidents"))
        .status,
    ).toBe(403);
  });
  it("support staff reading never enumerates residents", async () => {
    await grant("STAFF_READ");
    const response = await get(
      support,
      "/institutional/facilities/" + a + "/members",
    );
    expect(response.status).toBe(200);
    expect(response.body.map((row: { id: string }) => row.id)).not.toContain(
      owner,
    );
  });
  it("independent PII grant is necessary even with support capability; revocation denies", async () => {
    const source = {
      tenantId: a,
      subjectUserId: owner,
      sourceId: randomUUID(),
      kind: "EMAIL" as const,
    };
    const identityValue = randomUUID() + "@example.test";
    const lookup = await piiCrypto.lookup(identityValue, source);
    const record = await db.protectedIdentifier.create({
      data: {
        ...source,
        ...(await piiCrypto.seal(identityValue, source)),
        lookupDigest: lookup.digest,
        lookupKeyVersion: lookup.lookupKeyVersion,
      },
    });
    const path =
      "/protected-identities/facilities/" + a + "/" + record.id + "/resolve";
    const body = { purpose: "SUPPORT_CASE", caseReference: currentCaseId };
    expect((await post(support, path, body)).status).toBe(403);
    const g = await grant("PII_RESOLVE");
    expect((await post(support, path, body)).status).toBe(404);
    await db.identityAccessGrant.create({
      data: {
        tenantId: a,
        actorUserId: support,
        permission: "RESOLVE",
        expiresAt: new Date(Date.now() + 3600000),
        approvedByReference: admin,
      },
    });
    const response = await post(support, path, body);
    expect(response.status).toBe(201);
    expect(response.body.value).toBe(identityValue);
    expect(
      await db.identityResolutionAudit.findFirst({
        where: { identifierId: record.id, actorUserId: support },
      }),
    ).not.toBeNull();
    expect(
      await db.administrativeAuditEvent.findFirst({
        where: { resourceId: record.id, action: "SUPPORT_IDENTITY_RESOLVED" },
      }),
    ).toMatchObject({
      actorUserId: support,
      actorRole: "TECHNICAL_SUPPORT",
      authorityGrantId: g.id,
      caseReference: body.caseReference,
    });
    await service.revokeGrant(admin, g.id, context());
    expect((await post(support, path, body)).status).toBe(403);
  });
  it("legacy platform membership service rejects a current non-ADMIN even with tenant authority", async () => {
    const legacy = new LegacyPlatformService(
      db as unknown as PrismaService,
      new EnrollmentService(
        db as unknown as PrismaService,
        new ConfigService(values),
      ),
    );
    await expect(
      legacy.membershipAction(fa, a, operator, "revoke", "Reviewed"),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: operator } }))
        .membershipState,
    ).toBe("ACTIVE");
  });
  it("membership replay is idempotent and revalidates current authority", async () => {
    const proof = context();
    await service.membership(fa, a, operator, "revoke", proof);
    await service.membership(fa, a, operator, "revoke", proof);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: operator } }))
        .credentialVersion,
    ).toBe(1);
    expect(
      await db.administrativeAuditEvent.count({
        where: { correlationId: proof.correlationId },
      }),
    ).toBe(1);
    await expect(
      service.membership(fa, a, operator, "restore", proof),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("suspended support employment cannot enumerate retained onboarding grants", async () => {
    await db.onboardingAuthorityGrant.create({
      data: {
        actorUserId: support,
        approvedByUserId: admin,
        facilityId: a,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await db.supportEmployment.update({
      where: { userId: support },
      data: { state: "SUSPENDED" },
    });
    expect((await get(support, "/institutional/context")).status).toBe(403);
    expect(
      (await get(support, "/institutional/facilities/" + a + "/members"))
        .status,
    ).toBe(403);
  });
  it("actual HTTP DELETE cannot remove an incident", async () => {
    for (const actor of [operator, fa, support, admin])
      expect(
        (
          await request(app.getHttpServer())
            .delete("/incidents/" + incident)
            .set("Authorization", "Bearer " + token(actor))
        ).status,
      ).toBe(404);
    expect(await db.incident.count({ where: { id: incident } })).toBe(1);
  });
  it("Command Center diagnostics require an explicit current tenant grant", async () => {
    const path = "/institutional/facilities/" + a + "/command-center";
    expect((await get(support, path)).status).toBe(403);
    const g = await grant("COMMAND_CENTER_DIAGNOSTICS");
    expect((await get(support, path)).body).toMatchObject({
      facilityId: a,
      openIncidents: 1,
      activeOperators: 1,
    });
    expect(
      (await get(support, "/institutional/facilities/" + b + "/command-center"))
        .status,
    ).toBe(403);
    await service.revokeGrant(admin, g.id, context());
    expect((await get(support, path)).status).toBe(403);
  });
  it("institutional retry preserves channel rows, attempt history and five-minute cooldown", async () => {
    const invited = await service.invite(
      fa,
      a,
      "FACILITY_OPERATOR",
      identity(),
      randomUUID(),
    );
    const rows = await db.accountInvitationDelivery.findMany({
      where: { enrollmentId: invited.requestId },
      include: { enrollment: { select: { facilityId: true } } },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) => row.facilityId === null && row.enrollment?.facilityId === a,
      ),
    ).toBe(true);
    await expect(
      service.invitationAction(fa, a, invited.requestId, "resend", context()),
    ).rejects.toMatchObject({ status: 409 });
    await db.enrollmentRequest.update({
      where: { id: invited.requestId },
      data: { createdAt: new Date(Date.now() - 600000) },
    });
    await db.accountInvitationDelivery.updateMany({
      where: { enrollmentId: invited.requestId },
      data: {
        status: "FAILED",
        attemptCount: 3,
        lastAttemptAt: new Date(Date.now() - 600000),
      },
    });
    await service.invitationAction(
      fa,
      a,
      invited.requestId,
      "resend",
      context(),
    );
    const retried = await db.accountInvitationDelivery.findMany({
      where: { enrollmentId: invited.requestId },
    });
    expect(retried.map((r) => r.id).sort()).toEqual(
      rows.map((r) => r.id).sort(),
    );
    expect(
      retried.every((r) => r.status === "QUEUED" && r.attemptCount === 3),
    ).toBe(true);
    await expect(
      service.invitationAction(fa, a, invited.requestId, "resend", context()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("reciprocal Facility Admin removals cannot both succeed", async () => {
    const second = await person("FACILITY_ADMIN", a);
    const responses = await Promise.all(
      (
        [
          [fa, second],
          [second, fa],
        ] as Array<[string, string]>
      ).map(([actor, target]) =>
        post(
          actor,
          "/institutional/facilities/" + a + "/members/" + target + "/access",
          { ...context(), action: "revoke" },
        ),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      responses.every((r) => [201, 401, 403, 409].includes(r.status)),
    ).toBe(true);
    expect(
      await db.user.count({
        where: {
          facilityId: a,
          role: "FACILITY_ADMIN",
          membershipState: "ACTIVE",
          isActive: true,
          accountStatus: "ACTIVE",
        },
      }),
    ).toBe(1);
  });
  it.each(["role", "facility", "membership", "account"] as const)(
    "last-admin trigger denies direct %s removal even with pending replacement",
    async (kind) => {
      await db.user.create({
        data: {
          ...identity(),
          role: "FACILITY_ADMIN",
          facilityId: a,
          accountStatus: "PENDING_ACTIVATION",
        },
      });
      const change =
        kind === "role"
          ? { role: "USER" as const }
          : kind === "facility"
            ? { facilityId: b }
            : kind === "membership"
              ? { membershipState: "REVOKED" as const }
              : { accountStatus: "PENDING_ACTIVATION" as const };
      await expect(
        db.user.update({ where: { id: fa }, data: change }),
      ).rejects.toThrow();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: fa } }))
          .membershipState,
      ).toBe("ACTIVE");
    },
  );
  it("directory is assignment-filtered and grants no staff or incident authority", async () => {
    await grant("FACILITY_READ", null);
    const directory = await get(support, "/institutional/facilities");
    expect(directory.status).toBe(200);
    expect(directory.body.map((row: { id: string }) => row.id).sort()).toEqual(
      [a].sort(),
    );
    expect(Object.keys(directory.body[0]).sort()).toEqual([
      "id",
      "isActive",
      "name",
    ]);
    expect(
      (await get(support, "/institutional/context")).body.facilities,
    ).toEqual([]);
    for (const path of ["members", "incidents", "command-center"])
      expect(
        (await get(support, "/institutional/facilities/" + a + "/" + path))
          .status,
      ).toBe(403);
  });
  it("resolution preserves stored evidence and complete operational history", async () => {
    const e = await db.evidence.create({
      data: {
        incidentId: incident,
        type: "IMAGE",
        status: "STORED",
        storageKey: "synthetic/" + randomUUID(),
        sha256: randomBytes(32).toString("hex"),
      },
    });
    for (const type of [
      "SEEN",
      "ACKNOWLEDGED",
      "DISPATCHED",
      "RESPONSE_PROGRESS",
    ])
      expect(
        (
          await post(operator, "/incidents/" + incident + "/operations", {
            type,
            note: "Synthetic operation",
            correlationId: randomUUID(),
          })
        ).status,
      ).toBe(201);
    const g = await grant("INCIDENT_RESOLVE");
    await elevate("INCIDENT_RESOLVE");
    const proof = context();
    expect(
      (
        await post(
          support,
          "/incidents/" + incident + "/institutional-resolution",
          proof,
        )
      ).status,
    ).toBe(201);
    expect(await db.evidence.findUnique({ where: { id: e.id } })).toEqual(e);
    const events = await db.incidentTimelineEvent.findMany({
      where: { incidentId: incident },
      orderBy: { sequence: "asc" },
    });
    expect(events.map((row) => row.type)).toEqual([
      "OPERATOR_SEEN",
      "OPERATOR_ACKNOWLEDGED",
      "OPERATOR_DISPATCHED",
      "OPERATOR_RESPONSE_PROGRESS",
      "INCIDENT_RESOLVED",
    ]);
    expect(events[4]).toMatchObject({
      actorUserId: support,
      correlationId: proof.correlationId,
      payload: {
        actorRole: "TECHNICAL_SUPPORT",
        authority: "SUPPORT_CAPABILITY",
        grantId: g.id,
        caseReference: proof.caseReference,
      },
    });
    expect(
      await db.administrativeAuditEvent.findFirst({
        where: { resourceId: incident, action: "INCIDENT_RESOLVED" },
      }),
    ).toMatchObject({
      actorUserId: support,
      actorRole: "TECHNICAL_SUPPORT",
      authorityGrantId: g.id,
      ...proof,
    });
  });

  it("facility creation revalidates current ADMIN authority inside its transaction", async () => {
    const provisioning = new AdminProvisioningService(
      db as unknown as PrismaService,
    );
    await expect(
      provisioning.createFacility(
        { name: "Synthetic forbidden", type: "OTHER" },
        support,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const created = await provisioning.createFacility(
      { name: "Synthetic commissioned by platform", type: "OTHER" },
      admin,
    );
    expect(
      await db.administrativeAuditEvent.findFirst({
        where: { resourceId: created.id, action: "FACILITY_CREATED" },
      }),
    ).toMatchObject({ actorUserId: admin, actorRole: "ADMIN" });
  });
  it("delivery diagnostics include historical enrollment rows only inside their canonical facility", async () => {
    const invited = await service.invite(
      fa,
      a,
      "FACILITY_OPERATOR",
      identity(),
      randomUUID(),
    );
    await db.accountInvitationDelivery.updateMany({
      where: { enrollmentId: invited.requestId },
      data: { facilityId: null },
    });
    await grant("DELIVERY_DIAGNOSTICS");
    const response = await get(
      support,
      "/institutional/facilities/" + a + "/delivery",
    );
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(
      response.body.every((row: { status: string }) => row.status === "QUEUED"),
    ).toBe(true);
    expect(
      (await get(support, "/institutional/facilities/" + b + "/delivery"))
        .status,
    ).toBe(403);
  });

  it("a pending administrator is not treated as the last active administrator", async () => {
    const pending = await db.user.create({
      data: {
        ...identity(),
        role: "FACILITY_ADMIN",
        facilityId: b,
        accountStatus: "PENDING_ACTIVATION",
      },
    });
    await service.membership(admin, b, pending.id, "revoke", context());
    expect(
      await db.user.findUnique({ where: { id: pending.id } }),
    ).toMatchObject({
      facilityId: b,
      membershipState: "REVOKED",
      accountStatus: "PENDING_ACTIVATION",
    });
    expect(
      (await db.facility.findUniqueOrThrow({ where: { id: b } }))
        .commissionedAt,
    ).toBeNull();
  });
  it("only ADMIN can recover an accepted global account without restoring membership or issuing credentials", async () => {
    await service.membership(admin, a, operator, "suspend", context());
    await db.user.update({
      where: { id: operator },
      data: { isActive: false },
    });
    for (const actor of [fa, support])
      expect(
        (
          await post(
            actor,
            "/admin/support/accounts/" + operator + "/recover",
            context(),
          )
        ).status,
      ).toBe(403);
    const proof = context();
    const response = await post(
      admin,
      "/admin/support/accounts/" + operator + "/recover",
      proof,
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: operator,
      isActive: true,
      membershipState: "SUSPENDED",
      credentialsRevoked: true,
    });
    expect(response.body).not.toHaveProperty("accessToken");
    expect(response.body).not.toHaveProperty("password");
    await post(
      admin,
      "/admin/support/accounts/" + operator + "/recover",
      proof,
    ).expect(201);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: operator } }))
        .credentialVersion,
    ).toBe(2);
    expect(
      await db.administrativeAuditEvent.count({
        where: { action: "PLATFORM_ACCOUNT_RECOVERED", resourceId: operator },
      }),
    ).toBe(1);
  });
  it("ADMIN can recover a suspended zero-admin facility without granting support recovery authority", async () => {
    await db.facility.update({ where: { id: a }, data: { isActive: false } });
    await db.user.update({
      where: { id: fa },
      data: { isActive: false, membershipState: "SUSPENDED" },
    });
    await service.recoverAccount(admin, fa, context());
    await expect(
      service.membership(support, a, fa, "restore", context()),
    ).rejects.toMatchObject({ status: 403 });
    await service.membership(admin, a, fa, "restore", context());
    await service.facilityState(admin, a, "reactivate", context());
    expect(
      (await db.facility.findUniqueOrThrow({ where: { id: a } })).isActive,
    ).toBe(true);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: fa } }),
    ).toMatchObject({
      isActive: true,
      membershipState: "ACTIVE",
      facilityId: a,
    });
  });
});
