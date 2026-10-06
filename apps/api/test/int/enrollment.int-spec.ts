import { RefreshTokenService } from "../../src/modules/refresh-token/refresh-token.service";
import type { NotificationResponse } from "../../src/modules/notifications/providers/notification-provider.interface";
import { DeliveryLedgerService } from "../../src/modules/notifications/delivery-ledger.service";
import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { ThrottlerModule } from "@nestjs/throttler";
import { JwtService } from "@nestjs/jwt";
import type { User } from "@prisma/client";
import { createHash, randomUUID, randomBytes } from "crypto";
import request from "supertest";
import * as bcrypt from "bcrypt";
import { prismaTest } from "./prisma-test-client";
import { PrismaService } from "../../src/prisma/prisma.service";
import { AuthController } from "../../src/modules/auth/auth.controller";
import { AuthService } from "../../src/modules/auth/auth.service";
import { ActivationService } from "../../src/modules/auth/activation.service";
import { PasswordResetService } from "../../src/modules/auth/password-reset.service";
import type { EnrollmentIdentity } from "../../src/modules/auth/enrollment.service";
import { EnrollmentService } from "../../src/modules/auth/enrollment.service";
import { UsersService } from "../../src/modules/users/users.service";
import { JwtStrategy } from "../../src/modules/auth/jwt.strategy";
import { FacilityAdminResidentProvisioningController } from "../../src/modules/facilities/facility-admin-resident-provisioning.controller";
import { AdminProvisioningService } from "../../src/modules/admin-provisioning/admin-provisioning.service";
import { InvitationDeliveryWorker } from "../../src/modules/admin-provisioning/invitation-delivery.worker";
import { hashActivationCredential } from "../../src/shared/security/activation-code";

const testSettings = {
  OPA_WEB_URL: "https://viewer.example.test",
  JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
  JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "30d",
  BCRYPT_ROUNDS: 4,
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
};
const config = new ConfigService(testSettings);
// Isolate the HTTP fixture from developer .env values; ConfigService v3 otherwise
// gives process.env strings priority over these explicitly typed test settings.
jest
  .spyOn(config, "get")
  .mockImplementation(
    (key) => testSettings[key as keyof typeof testSettings] as never,
  );
const jwt = new JwtService();
const input = (): EnrollmentIdentity => ({
  email: randomUUID() + "@example.test",
  phoneNumber: "+23480" + String(Math.random()).slice(2, 10).padEnd(8, "0"),
  firstName: "Test",
  lastName: "Enrollment",
});
const password = randomBytes(24).toString("hex") + "aA1!";

describe("verification-first enrollment HTTP, signed JWT and PostgreSQL", () => {
  let app: INestApplication,
    service: EnrollmentService,
    worker: InvitationDeliveryWorker;
  let facility: string, other: string, admin: User, existing: User;
  const messages: Array<{ recipient: string; message: string }> = [];
  const send = jest.fn(
    async (value: {
      recipient: string;
      message: string;
    }): Promise<NotificationResponse> => {
      messages.push(value);
      return { success: true, provider: "test-local" };
    },
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: "jwt" }),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
      ],
      controllers: [
        AuthController,
        FacilityAdminResidentProvisioningController,
      ],
      providers: [
        EnrollmentService,
        AuthService,
        ActivationService,
        PasswordResetService,
        UsersService,
        JwtStrategy,
        AdminProvisioningService,
        { provide: PrismaService, useValue: prismaTest },
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: jwt },
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
    service = module.get(EnrollmentService);
    worker = new InvitationDeliveryWorker(
      prismaTest as never,
      { send } as never,
      { send } as never,
      config,
      {} as never,
    );
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    messages.length = 0;
    send.mockClear();
    facility = (
      await prismaTest.facility.create({
        data: { name: "Tenant A", type: "SECURITY_PROVIDER" },
      })
    ).id;
    other = (
      await prismaTest.facility.create({
        data: { name: "Tenant B", type: "SECURITY_PROVIDER" },
      })
    ).id;
    admin = await prismaTest.user.create({
      data: { ...input(), role: "FACILITY_ADMIN", facilityId: facility },
    });
    existing = await prismaTest.user.create({
      data: {
        ...input(),
        role: "USER",
        facilityId: other,
        passwordHash: await bcrypt.hash(password, 4),
      },
    });
  });
  const token = (u: User) =>
    jwt.sign(
      {
        sub: u.id,
        email: u.email,
        role: u.role,
        credentialVersion: 0,
        tokenType: "access",
      },
      { secret: config.getOrThrow("JWT_ACCESS_SECRET") },
    );
  const post = (path: string, u?: User) => {
    const r = request(app.getHttpServer()).post(path);
    return u ? r.set("Authorization", "Bearer " + token(u)) : r;
  };
  async function proofs(receipt: { requestId: string }) {
    await worker.tick();
    const parts = messages.filter((m) => m.message.includes(receipt.requestId));
    const code = (kind: string) =>
      parts
        .find((m) => m.message.includes(kind + " code:"))
        ?.message.match(new RegExp(kind + " code: ([A-Za-z0-9_-]+)"))?.[1];
    expect(parts).toHaveLength(2);
    return {
      requestId: receipt.requestId,
      emailCode: code("Email")!,
      phoneCode: code("Phone")!,
      password,
      accept: true as const,
    };
  }

  it("rejects a registration password instead of silently discarding it", async () => {
    await post("/auth/register")
      .send({ ...input(), password })
      .expect(400);
    expect(await prismaTest.enrollmentRequest.count()).toBe(0);
  });
  it.each([
    "USER",
    "FACILITY_ADMIN",
    "FACILITY_OPERATOR",
    "TECHNICAL_SUPPORT",
  ] as const)(
    "verification establishes exactly the chosen credential for %s",
    async (role) => {
      const platform = await prismaTest.user.create({
        data: { ...input(), role: "ADMIN" },
      });
      const identity = input();
      const r =
        role === "USER"
          ? (await post("/auth/register").send(identity).expect(202)).body
          : await service.request(
              identity,
              randomUUID(),
              role === "TECHNICAL_SUPPORT" ? undefined : facility,
              platform.id,
              role,
            );
      expect(
        await prismaTest.user.findUnique({ where: { email: identity.email } }),
      ).toBeNull();
      await post("/auth/login")
        .send({ email: identity.email, password })
        .expect(401);
      const chosen = randomBytes(24).toString("hex");
      const result = await service.verify({
        ...(await proofs(r)),
        password: chosen,
      });
      expect(result.status).toBe("ACCEPTED");
      const created = await prismaTest.user.findUniqueOrThrow({
        where: { email: identity.email },
      });
      expect(created.role).toBe(role);
      expect(await bcrypt.compare(chosen, created.passwordHash!)).toBe(true);
      expect(await bcrypt.compare(password, created.passwordHash!)).toBe(false);
      const login = await post("/auth/login")
        .send({ email: identity.email, password: chosen })
        .expect(200);
      expect(login.body.user.role).toBe(role);
    },
  );
  it.each([
    "ADMIN",
    "TECHNICAL_SUPPORT",
    "FACILITY_ADMIN",
    "FACILITY_OPERATOR",
    "USER",
  ] as const)(
    "recovery for %s invalidates old credentials and tokens, preserves authority and audits",
    async (role) => {
      const person = await prismaTest.user.create({
        data: {
          ...input(),
          role,
          facilityId:
            role === "ADMIN" || role === "TECHNICAL_SUPPORT" ? null : facility,
          passwordHash: await bcrypt.hash(password, 4),
        },
      });
      if (role === "TECHNICAL_SUPPORT")
        await prismaTest.supportEmployment.create({
          data: {
            userId: person.id,
            appointedByUserId: admin.id,
            state: "ACTIVE",
          },
        });
      const employment = await prismaTest.supportEmployment.findUnique({
        where: { userId: person.id },
      });
      const before = (
        await post("/auth/login")
          .send({ email: person.email, password })
          .expect(200)
      ).body;
      const refresh = new RefreshTokenService(jwt, config, prismaTest as never);
      const strategy = app.get(JwtStrategy);
      await strategy.validate(jwt.decode(before.accessToken) as never);
      await refresh.rotate(before.refreshToken);
      const resets = app.get(PasswordResetService);
      await resets.requestReset({ email: person.email });
      await worker.tick();
      const message = messages.find((m) =>
        m.message.includes("/reset-password?token="),
      );
      expect(message).toBeDefined();
      const raw = message!.message.match(/token=([a-f0-9]{64})/)![1]!;
      const chosen = randomBytes(24).toString("hex");
      await resets.confirmReset({ token: raw, password: chosen });
      await post("/auth/login")
        .send({ email: person.email, password })
        .expect(401);
      const afterLogin = (
        await post("/auth/login")
          .send({ email: person.email, password: chosen })
          .expect(200)
      ).body;
      expect(afterLogin.user.role).toBe(role);
      await expect(
        strategy.validate(jwt.decode(before.accessToken) as never),
      ).rejects.toThrow();
      await expect(refresh.rotate(before.refreshToken)).rejects.toThrow();
      await strategy.validate(jwt.decode(afterLogin.accessToken) as never);
      await refresh.rotate(afterLogin.refreshToken);
      await expect(
        resets.confirmReset({ token: raw, password }),
      ).rejects.toThrow();
      const after = await prismaTest.user.findUniqueOrThrow({
        where: { id: person.id },
      });
      expect({
        ...after,
        passwordHash: person.passwordHash,
        credentialVersion: person.credentialVersion,
        updatedAt: person.updatedAt,
      }).toEqual(person);
      expect(
        await prismaTest.supportEmployment.findUnique({
          where: { userId: person.id },
        }),
      ).toEqual(employment);
      const audit = await prismaTest.administrativeAuditEvent.findMany({
        where: { actorUserId: person.id, action: "LOCAL_PASSWORD_RESET" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorRole: role,
        resourceId: person.id,
        authorityKind: "SINGLE_USE_RECOVERY_TOKEN",
      });
      expect(JSON.stringify(audit)).not.toContain(raw);
      expect(JSON.stringify(audit)).not.toContain(chosen);
    },
  );
  it("expired recovery is rejected without changing credentials or audit", async () => {
    const raw = randomBytes(32).toString("hex");
    await prismaTest.passwordResetToken.create({
      data: {
        userId: existing.id,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(0),
      },
    });
    await expect(
      app.get(PasswordResetService).confirmReset({
        token: raw,
        password: randomBytes(24).toString("hex"),
      }),
    ).rejects.toThrow();
    expect(
      (await prismaTest.user.findUniqueOrThrow({ where: { id: existing.id } }))
        .passwordHash,
    ).toBe(existing.passwordHash);
    expect(
      await prismaTest.administrativeAuditEvent.count({
        where: { action: "LOCAL_PASSWORD_RESET" },
      }),
    ).toBe(0);
  });

  const receipt = (body: unknown) =>
    expect(body).toEqual({
      requestId: expect.any(String),
      status: "VERIFICATION_PENDING",
    });

  it("reports stored revocation and expiry without claiming membership activation", async () => {
    const revoked = await service.request(
      input(),
      randomUUID(),
      facility,
      admin.id,
    );
    const expired = await service.request(
      input(),
      randomUUID(),
      facility,
      admin.id,
    );
    await prismaTest.enrollmentRequest.update({
      where: { id: revoked.requestId },
      data: { revokedAt: new Date() },
    });
    await prismaTest.enrollmentRequest.update({
      where: { id: expired.requestId },
      data: { expiresAt: new Date(0) },
    });
    const result = await request(app.getHttpServer())
      .get("/facility-admin/facility/residents/enrollments")
      .set("Authorization", "Bearer " + token(admin))
      .expect(200);
    expect(result.body.page).toBe(0);
    expect(result.body.hasNext).toBe(false);
    expect(result.body.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: revoked.requestId,
          status: "REVOKED",
        }),
        expect.objectContaining({
          requestId: expired.requestId,
          status: "EXPIRED",
        }),
      ]),
    );
    expect(JSON.stringify(result.body)).not.toContain("@");
  });

  it.each(["unknown", "email", "phone"])(
    "public registration %s returns only a durable receipt and creates no account",
    async (kind) => {
      const data = input();
      if (kind === "email") data.email = existing.email;
      if (kind === "phone") data.phoneNumber = existing.phoneNumber;
      const before = await prismaTest.user.count();
      const r = await post("/auth/register").send(data).expect(202);
      expect(r.body).toEqual({
        requestId: expect.any(String),
        status: "VERIFICATION_PENDING",
        credentialStep: "SET_PASSWORD_DURING_VERIFICATION",
        message: expect.stringContaining("No login credential"),
      });
      expect(await prismaTest.user.count()).toBe(before);
      expect(
        await prismaTest.accountInvitationDelivery.count({
          where: { enrollmentId: r.body.requestId },
        }),
      ).toBe(2);
      expect(send).not.toHaveBeenCalled();
      const row = await prismaTest.enrollmentRequest.findUniqueOrThrow({
        where: { id: r.body.requestId },
      });
      expect(row.identityCiphertext).not.toContain(data.email);
      expect(row.identityCiphertext).not.toContain(data.phoneNumber);
    },
  );
  it.each(["unknown", "email", "phone"])(
    "tenant enrollment %s has identical receipts, safe status and no roster change",
    async (kind) => {
      const data = input();
      if (kind === "email") data.email = existing.email;
      if (kind === "phone") data.phoneNumber = existing.phoneNumber;
      const before = await prismaTest.user.count({
        where: { facilityId: facility },
      });
      const r = await post("/facility-admin/facility/residents", admin)
        .send(data)
        .expect(202);
      receipt(r.body);
      expect(
        await prismaTest.user.count({ where: { facilityId: facility } }),
      ).toBe(before);
      const status = await request(app.getHttpServer())
        .get("/facility-admin/facility/residents/enrollments")
        .set("Authorization", "Bearer " + token(admin))
        .expect(200);
      expect(status.body.requests[0]).toEqual({
        ...r.body,
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      });
      expect(JSON.stringify(status.body)).not.toContain(data.email);
      expect(JSON.stringify(status.body)).not.toContain(existing.id);
    },
  );
  it("rejects unauthenticated and unauthorized enrollment/status probing", async () => {
    await post("/facility-admin/facility/residents").send(input()).expect(401);
    await post("/facility-admin/facility/residents", existing)
      .send(input())
      .expect(403);
    await request(app.getHttpServer())
      .get("/facility-admin/facility/residents/enrollments")
      .set("Authorization", "Bearer " + token(existing))
      .expect(403);
    expect(await prismaTest.enrollmentRequest.count()).toBe(0);
  });
  it.each(["FACILITY_OPERATOR", "TECHNICAL_SUPPORT"] as const)(
    "bulk onboarding denies %s without resident onboarding authority",
    async (role) => {
      const actor = await prismaTest.user.create({
        data: {
          ...input(),
          role,
          facilityId: role === "FACILITY_OPERATOR" ? facility : null,
        },
      });
      if (role === "TECHNICAL_SUPPORT") {
        const approver = await prismaTest.user.create({
          data: { ...input(), role: "ADMIN" },
        });
        await prismaTest.supportEmployment.create({
          data: {
            userId: actor.id,
            appointedByUserId: approver.id,
            state: "ACTIVE",
          },
        });
      }
      await post("/facility-admin/facility/residents/bulk", actor)
        .send({ residents: [input(), input()] })
        .expect(403);
      expect(await prismaTest.enrollmentRequest.count()).toBe(0);
      expect(await prismaTest.accountInvitationDelivery.count()).toBe(0);
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("bulk validates every E.164 phone before creating any enrollment or delivery", async () => {
    await post("/facility-admin/facility/residents/bulk", admin)
      .send({
        residents: [input(), { ...input(), phoneNumber: "invalid-number" }],
      })
      .expect(400);
    expect(await prismaTest.enrollmentRequest.count()).toBe(0);
    expect(await prismaTest.accountInvitationDelivery.count()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("bulk accepts mixed global conflicts without row-dependent failures", async () => {
    const residents = [
      input(),
      { ...input(), email: existing.email },
      { ...input(), phoneNumber: existing.phoneNumber },
    ];
    const r = await post("/facility-admin/facility/residents/bulk", admin)
      .send({ residents })
      .expect(202);
    expect(r.body.requests).toHaveLength(3);
    r.body.requests.forEach((row: unknown, index: number) =>
      expect(row).toEqual({
        index,
        requestId: expect.any(String),
        status: "VERIFICATION_PENDING",
      }),
    );
    expect(await prismaTest.user.count()).toBe(2);
  });
  it("resumes a partially committed bulk intent through the guarded HTTP path without duplicate work", async () => {
    const residents = [input(), input(), input()],
      key = randomUUID();
    // A prior attempt committed row zero before its response/remaining work was lost.
    const first = await service.request(
      residents[0]!,
      key + ":0",
      facility,
      admin.id,
    );
    const beforeMembers = await prismaTest.user.count();
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        post("/facility-admin/facility/residents/bulk", admin)
          .set("Idempotency-Key", key)
          .send({ residents })
          .expect(202),
      ),
    );
    for (const result of results) {
      expect(result.body).toEqual(results[0]!.body);
      expect(result.body.requests).toHaveLength(3);
      expect(result.body.requests[0]).toEqual({ index: 0, ...first });
      expect(JSON.stringify(result.body)).not.toContain(residents[0]!.email);
      expect(JSON.stringify(result.body)).not.toContain("activationToken");
    }
    expect(
      await prismaTest.enrollmentRequest.count({
        where: { facilityId: facility },
      }),
    ).toBe(3);
    expect(await prismaTest.accountInvitationDelivery.count()).toBe(6);
    expect(
      await prismaTest.administrativeAuditEvent.count({
        where: { action: "ENROLLMENT_REQUESTED", facilityId: facility },
      }),
    ).toBe(3);
    expect(await prismaTest.user.count()).toBe(beforeMembers);
    expect(send).not.toHaveBeenCalled();
  });

  it("scopes an identical bulk retry key to the current inviter and tenant", async () => {
    const residents = [input()],
      key = randomUUID();
    const otherAdmin = await prismaTest.user.create({
      data: { ...input(), role: "FACILITY_ADMIN", facilityId: other },
    });
    const a = await post("/facility-admin/facility/residents/bulk", admin)
      .set("Idempotency-Key", key)
      .send({ residents })
      .expect(202);
    const b = await post("/facility-admin/facility/residents/bulk", otherAdmin)
      .set("Idempotency-Key", key)
      .send({ residents })
      .expect(202);
    expect(a.body.requests[0].requestId).not.toBe(b.body.requests[0].requestId);
    for (const [actor, expected] of [
      [admin, a],
      [otherAdmin, b],
    ] as const) {
      const replay = await post(
        "/facility-admin/facility/residents/bulk",
        actor,
      )
        .set("Idempotency-Key", key)
        .send({ residents })
        .expect(202);
      expect(replay.body).toEqual(expected.body);
    }
    expect(await prismaTest.enrollmentRequest.count()).toBe(2);
    expect(await prismaTest.accountInvitationDelivery.count()).toBe(4);
    await prismaTest.user.create({
      data: { ...input(), role: "FACILITY_ADMIN", facilityId: facility },
    });
    await prismaTest.user.update({
      where: { id: admin.id },
      data: { isActive: false },
    });
    await post("/facility-admin/facility/residents/bulk", admin)
      .set("Idempotency-Key", key)
      .send({ residents })
      .expect(401);
    expect(await prismaTest.enrollmentRequest.count()).toBe(2);
  });

  it("serializes duplicate intake and queues exactly one message per channel", async () => {
    const data = input(),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.request(data, key, facility, admin.id),
      ),
    );
    expect(new Set(results.map((r) => r.requestId)).size).toBe(1);
    expect(await prismaTest.enrollmentRequest.count()).toBe(1);
    expect(await prismaTest.accountInvitationDelivery.count()).toBe(2);
  });
  it("requires both proofs, then creates one account/membership with acceptance audit", async () => {
    const data = input(),
      r = await service.request(data, randomUUID(), facility, admin.id),
      dto = await proofs(r);
    await post("/auth/enrollment/verify")
      .send({ ...dto, phoneCode: "wrong" })
      .expect(400);
    expect(await prismaTest.user.count()).toBe(2);
    const result = await post("/auth/enrollment/verify").send(dto).expect(200);
    expect(result.body.status).toBe("ACCEPTED");
    expect(result.body.accessToken).toEqual(expect.any(String));
    expect(result.body.user).not.toHaveProperty("passwordHash");
    const user = await prismaTest.user.findUniqueOrThrow({
      where: { email: data.email },
    });
    expect(user.facilityId).toBe(facility);
    expect(
      await prismaTest.administrativeAuditEvent.count({
        where: { resourceId: r.requestId, actorUserId: user.id },
      }),
    ).toBe(1);
    await post("/auth/enrollment/verify").send(dto).expect(400);
    expect(await prismaTest.user.count({ where: { email: data.email } })).toBe(
      1,
    );
  });
  it.each(["expired", "exhausted"])(
    "refuses %s proof and creates no membership",
    async (kind) => {
      const r = await service.request(
          input(),
          randomUUID(),
          facility,
          admin.id,
        ),
        dto = await proofs(r);
      await prismaTest.enrollmentRequest.update({
        where: { id: r.requestId },
        data:
          kind === "expired"
            ? { expiresAt: new Date(0) }
            : { proofAttempts: 5 },
      });
      await expect(service.verify(dto)).rejects.toThrow(
        "Enrollment could not be completed.",
      );
      expect(await prismaTest.user.count()).toBe(2);
    },
  );
  it("persists failed proof attempts across rejected requests", async () => {
    const r = await service.request(input(), randomUUID()),
      dto = await proofs(r);
    for (let i = 0; i < 5; i++)
      await expect(
        service.verify({ ...dto, emailCode: "wrong" }),
      ).rejects.toThrow();
    await expect(service.verify(dto)).rejects.toThrow();
    expect(
      (
        await prismaTest.enrollmentRequest.findUniqueOrThrow({
          where: { id: r.requestId },
        })
      ).proofAttempts,
    ).toBe(5);
  });
  it("existing account must authenticate; same-tenant acceptance is idempotent", async () => {
    await prismaTest.user.update({
      where: { id: existing.id },
      data: { facilityId: facility },
    });
    const r = await service.request(existing, randomUUID(), facility, admin.id),
      dto = await proofs(r);
    const verified = await post("/auth/enrollment/verify")
      .send(dto)
      .expect(200);
    expect(verified.body).toEqual({
      status: "AUTHENTICATION_REQUIRED",
      acceptanceToken: expect.any(String),
    });
    const body = {
      requestId: r.requestId,
      acceptanceToken: verified.body.acceptanceToken,
    };
    await post("/auth/enrollment/accept").send(body).expect(401);
    await post("/auth/enrollment/accept", admin).send(body).expect(401);
    await post("/auth/enrollment/accept", existing).send(body).expect(200);
    await post("/auth/enrollment/accept", existing).send(body).expect(200);
    expect(
      await prismaTest.administrativeAuditEvent.count({
        where: { resourceId: r.requestId, action: "ENROLLMENT_ACCEPTED" },
      }),
    ).toBe(1);
    expect(await prismaTest.user.count()).toBe(2);
    expect(
      await bcrypt.compare(
        password,
        (
          await prismaTest.user.findUniqueOrThrow({
            where: { id: existing.id },
          })
        ).passwordHash!,
      ),
    ).toBe(true);
  });
  it("allows an authenticated unassigned account to accept without creating a duplicate account", async () => {
    await prismaTest.user.update({
      where: { id: existing.id },
      data: { facilityId: null },
    });
    const r = await service.request(existing, randomUUID(), facility, admin.id),
      dto = await proofs(r);
    const v = await service.verify(dto);
    expect(v.status).toBe("AUTHENTICATION_REQUIRED");
    await service.accept(existing.id, {
      requestId: r.requestId,
      acceptanceToken: ("acceptanceToken" in v ? v.acceptanceToken : "")!,
    });
    expect(
      (await prismaTest.user.findUniqueOrThrow({ where: { id: existing.id } }))
        .facilityId,
    ).toBe(facility);
    expect(await prismaTest.user.count()).toBe(2);
  });
  it("refuses cross-tenant transfer even after proofs and authenticated acceptance", async () => {
    const r = await service.request(existing, randomUUID(), facility, admin.id),
      dto = await proofs(r);
    const v = await service.verify(dto);
    expect(v.status).toBe("AUTHENTICATION_REQUIRED");
    await expect(
      service.accept(existing.id, {
        requestId: r.requestId,
        acceptanceToken: ("acceptanceToken" in v ? v.acceptanceToken : "")!,
      }),
    ).rejects.toThrow();
    expect(
      (await prismaTest.user.findUniqueOrThrow({ where: { id: existing.id } }))
        .facilityId,
    ).toBe(other);
    expect((await service.list(facility, admin.id)).requests[0]?.status).toBe(
      "VERIFICATION_PENDING",
    );
  });
  it("rejects client facility injection before verification creates any account", async () => {
    const data = input(), receipt = await service.request(data, randomUUID(), facility, admin.id), dto = await proofs(receipt);
    await post("/auth/enrollment/verify").send({ ...dto, facilityId: other }).expect(400);
    expect(await prismaTest.user.count({ where: { email: data.email } })).toBe(0);
    expect((await prismaTest.enrollmentRequest.findUniqueOrThrow({ where: { id: receipt.requestId } })).facilityId).toBe(facility);
  });
  it("does not move a verified existing account from a newly assigned foreign facility", async () => {
    await prismaTest.user.update({ where: { id: existing.id }, data: { facilityId: null } });
    const receipt = await service.request(existing, randomUUID(), facility, admin.id), dto = await proofs(receipt);
    const verified = await service.verify(dto);
    if (verified.status !== "AUTHENTICATION_REQUIRED") throw new Error("Expected verified existing-account continuation");
    await prismaTest.user.update({ where: { id: existing.id }, data: { facilityId: other } });
    await post("/auth/enrollment/accept", existing).send({ requestId: receipt.requestId, acceptanceToken: verified.acceptanceToken }).expect(400);
    expect((await prismaTest.user.findUniqueOrThrow({ where: { id: existing.id } })).facilityId).toBe(other);
    expect(await prismaTest.administrativeAuditEvent.count({ where: { resourceId: receipt.requestId, action: "ENROLLMENT_ACCEPTED" } })).toBe(0);
  });
  it("puts only the opaque request reference in both actionable invitation links", async () => {
    const receipt = await service.request(input(), randomUUID(), facility, admin.id);
    await proofs(receipt);
    const sent = messages.filter(message => message.message.includes(receipt.requestId));
    expect(sent).toHaveLength(2);
    for (const message of sent) {
      const destination = new URL(message.message.split("Enroll: ")[1]!);
      expect(destination.protocol).toBe("https:");
      expect(destination.pathname).toBe("/enroll");
      expect([...destination.searchParams.entries()]).toEqual([["requestId", receipt.requestId]]);
      expect(destination.hash).toBe("");
    }
  });
  it.each(["suspended", "removed", "facility-disabled"])(
    "rechecks %s inviter authority at completion",
    async (kind) => {
      const r = await service.request(
          input(),
          randomUUID(),
          facility,
          admin.id,
        ),
        dto = await proofs(r);
      if (kind === "facility-disabled")
        await prismaTest.facility.update({
          where: { id: facility },
          data: { isActive: false },
        });
      else {
        // Keep the commissioned facility staffed while revoking this inviter.
        await prismaTest.user.create({
          data: { ...input(), role: "FACILITY_ADMIN", facilityId: facility },
        });
        await prismaTest.user.update({
          where: { id: admin.id },
          data: kind === "removed" ? { facilityId: null } : { isActive: false },
        });
      }
      await expect(service.verify(dto)).rejects.toThrow();
      expect(await prismaTest.user.count()).toBe(
        kind === "facility-disabled" ? 2 : 3,
      );
    },
  );
  it("serializes duplicate verification submissions", async () => {
    const data = input(),
      r = await service.request(data, randomUUID()),
      dto = await proofs(r);
    const outcomes = await Promise.allSettled([
      service.verify(dto),
      service.verify(dto),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await prismaTest.user.count({ where: { email: data.email } })).toBe(
      1,
    );
  });
  it.each(["email", "phone"])(
    "competing completions preserve global %s uniqueness",
    async (kind) => {
      const one = input(),
        two = input();
      if (kind === "email") two.email = one.email;
      else two.phoneNumber = one.phoneNumber;
      const r1 = await service.request(one, randomUUID()),
        r2 = await service.request(two, randomUUID());
      const d1 = await proofs(r1),
        d2 = await proofs(r2);
      const outcomes = await Promise.all([
        service.verify(d1),
        service.verify(d2),
      ]);
      expect(outcomes.map((o) => o.status).sort()).toEqual([
        "ACCEPTED",
        "AUTHENTICATION_REQUIRED",
      ]);
      await expect(
        prismaTest.user.create({
          data: {
            ...one,
            phoneNumber:
              kind === "email" ? input().phoneNumber : one.phoneNumber,
            email: kind === "phone" ? input().email : one.email,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    },
  );
  it("provider failure cannot change accepted response or expose status; retries recover", async () => {
    const r = await service.request(input(), randomUUID());
    send.mockResolvedValueOnce({
      success: false,
      provider: "test-local",
      failureCategory: "RATE_LIMITED",
      retryable: true,
    });
    await worker.tick();
    const retry = await prismaTest.accountInvitationDelivery.findFirstOrThrow({
      where: { enrollmentId: r.requestId, status: "QUEUED" },
    });
    expect(retry.attemptCount).toBe(1);
    await prismaTest.accountInvitationDelivery.update({
      where: { id: retry.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await worker.tick();
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: retry.id },
        })
      ).status,
    ).toBe("SENT");
  });
  it("cancels stale queued enrollment proofs after inviter removal without exposing eligibility in status", async () => {
    await prismaTest.user.create({
      data: { ...input(), role: "FACILITY_ADMIN", facilityId: facility },
    });
    const r = await service.request(input(), randomUUID(), facility, admin.id);
    await prismaTest.user.update({
      where: { id: admin.id },
      data: { facilityId: null },
    });
    await worker.tick();
    await worker.tick();
    expect(send).not.toHaveBeenCalled();
    expect(
      await prismaTest.accountInvitationDelivery.count({
        where: { enrollmentId: r.requestId, status: "CANCELLED" },
      }),
    ).toBe(2);
    expect(
      (
        await prismaTest.enrollmentRequest.findUniqueOrThrow({
          where: { id: r.requestId },
        })
      ).verifiedAt,
    ).toBeNull();
  });
  it("records an abandoned enrollment attempt as UNKNOWN without resending or rotating credentials", async () => {
    const r = await service.request(input(), randomUUID());
    const delivery =
      await prismaTest.accountInvitationDelivery.findFirstOrThrow({
        where: { enrollmentId: r.requestId, channel: "EMAIL" },
      });
    const ledger = new DeliveryLedgerService(prismaTest as never);
    const attempt = await prismaTest.$transaction((tx) =>
      ledger.claim(tx, { kind: "invitation", id: delivery.id }),
    );
    expect(attempt).not.toBeNull();
    await prismaTest.deliveryAttempt.update({
      where: { id: attempt!.id },
      data: { startedAt: new Date(0) },
    });
    const before = await prismaTest.enrollmentRequest.findUniqueOrThrow({
      where: { id: r.requestId },
    });
    await worker.tick();
    const row = await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(row.status).toBe("FAILED");
    expect(row.deliveryStatus).toBe("UNKNOWN");
    expect(row.attemptCount).toBe(1);
    expect(
      (
        await prismaTest.enrollmentRequest.findUniqueOrThrow({
          where: { id: r.requestId },
        })
      ).emailTokenHash,
    ).toBe(before.emailTokenHash);
  });
  it("reset intake queues identical encrypted work and token creation happens only in worker", async () => {
    const resets = app.get(PasswordResetService);
    expect(await resets.requestReset({ email: existing.email })).toEqual(
      await resets.requestReset({ email: input().email }),
    );
    expect(await prismaTest.passwordResetToken.count()).toBe(0);
    expect(
      await prismaTest.accountInvitationDelivery.count({
        where: { purpose: "PASSWORD_RESET" },
      }),
    ).toBe(2);
    await worker.tick();
    expect(await prismaTest.passwordResetToken.count()).toBe(1);
    const message = messages.find((m) => m.recipient === existing.email)!;
    const raw = message.message
      .split("\n")
      .find((line) => /^[a-f0-9]{64}$/.test(line))!;
    expect(
      (await prismaTest.passwordResetToken.findFirstOrThrow()).tokenHash,
    ).toBe(hashActivationCredential(raw));
    await resets.confirmReset({
      token: raw,
      password: randomBytes(24).toString("hex") + "aA1!",
    });
    await expect(
      resets.confirmReset({ token: raw, password }),
    ).rejects.toThrow();
  });
  it("continuation requires authentication and both original proofs", async () => {
    const r = await service.request(existing, randomUUID(), facility, admin.id);
    await post("/auth/enrollment/continue")
      .send({ requestId: r.requestId })
      .expect(401);
    await post("/auth/enrollment/continue", existing)
      .send({ requestId: r.requestId })
      .expect(400);
    expect(
      (
        await prismaTest.enrollmentRequest.findUniqueOrThrow({
          where: { id: r.requestId },
        })
      ).verifiedAt,
    ).toBeNull();
  });
  it("continuation rotates a lost acceptance token without bypassing normal acceptance", async () => {
    await prismaTest.user.update({
      where: { id: existing.id },
      data: { facilityId: facility },
    });
    const r = await service.request(existing, randomUUID(), facility, admin.id);
    const dto = await proofs(r);
    const original = await service.verify(dto);
    const resumed = await post("/auth/enrollment/continue", existing)
      .send({ requestId: r.requestId })
      .expect(200);
    expect(resumed.body.status).toBe("AUTHENTICATION_REQUIRED");
    expect(
      (
        await prismaTest.enrollmentRequest.findUniqueOrThrow({
          where: { id: r.requestId },
        })
      ).acceptedAt,
    ).toBeNull();
    await expect(
      service.accept(existing.id, {
        requestId: r.requestId,
        acceptanceToken: ("acceptanceToken" in original
          ? original.acceptanceToken
          : "")!,
      }),
    ).rejects.toThrow();
    await post("/auth/enrollment/accept", existing)
      .send({
        requestId: r.requestId,
        acceptanceToken: resumed.body.acceptanceToken,
      })
      .expect(200);
    const completed = await post("/auth/enrollment/continue", existing)
      .send({ requestId: r.requestId })
      .expect(200);
    expect(completed.body).toEqual({ status: "ACCEPTED", role: "USER" });
  });
  it.each(["revoked", "expired", "exhausted"])(
    "continuation denies %s verified requests",
    async (kind) => {
      const r = await service.request(
        existing,
        randomUUID(),
        facility,
        admin.id,
      );
      await service.verify(await proofs(r));
      await prismaTest.enrollmentRequest.update({
        where: { id: r.requestId },
        data:
          kind === "revoked"
            ? { revokedAt: new Date() }
            : kind === "expired"
              ? { expiresAt: new Date(0) }
              : { proofAttempts: 5 },
      });
      await expect(
        service.continueVerified(existing.id, r.requestId),
      ).rejects.toThrow();
    },
  );
  it("continuation rejects an email/phone collision belonging to a different identity", async () => {
    const identity = { ...input(), phoneNumber: existing.phoneNumber };
    const r = await service.request(identity, randomUUID(), facility, admin.id);
    await service.verify(await proofs(r));
    await expect(
      service.continueVerified(existing.id, r.requestId),
    ).rejects.toThrow();
    expect(
      (
        await prismaTest.enrollmentRequest.findUniqueOrThrow({
          where: { id: r.requestId },
        })
      ).acceptedAt,
    ).toBeNull();
  });
  it("continuation reconciles a newly created account after a lost verification response", async () => {
    const identity = input();
    const r = await service.request(identity, randomUUID(), facility, admin.id);
    const result = await service.verify(await proofs(r));
    if (result.status !== "ACCEPTED")
      throw Error("Expected synthetic enrollment completion");
    expect(await service.continueVerified(result.user.id, r.requestId)).toEqual(
      { status: "ACCEPTED", role: "USER" },
    );
    expect(
      await prismaTest.user.count({ where: { email: identity.email } }),
    ).toBe(1);
  });
});
