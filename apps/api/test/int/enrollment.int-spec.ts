import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { ThrottlerModule } from "@nestjs/throttler";
import { JwtService } from "@nestjs/jwt";
import type { User } from "@prisma/client";
import { randomUUID } from "crypto";
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

const config = new ConfigService({
  JWT_ACCESS_SECRET: "enrollment-integration-secret-only-32",
  JWT_REFRESH_SECRET: "enrollment-integration-refresh-only-32",
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "30d",
  BCRYPT_ROUNDS: 4,
  ENROLLMENT_ENCRYPTION_KEY: "ab".repeat(32),
});
const jwt = new JwtService();
const input = (): EnrollmentIdentity => ({
  email: randomUUID() + "@example.test",
  phoneNumber: "+23480" + String(Math.random()).slice(2, 10).padEnd(8, "0"),
  firstName: "Test",
  lastName: "Enrollment",
});
const password = "TestOnlyPassword123!";

describe("verification-first enrollment HTTP, signed JWT and PostgreSQL", () => {
  let app: INestApplication,
    service: EnrollmentService,
    worker: InvitationDeliveryWorker;
  let facility: string, other: string, admin: User, existing: User;
  const messages: Array<{ recipient: string; message: string }> = [];
  const send = jest.fn(
    async (value: { recipient: string; message: string }) => {
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
  const receipt = (body: unknown) =>
    expect(body).toEqual({
      requestId: expect.any(String),
      status: "VERIFICATION_PENDING",
    });

  it.each(["unknown", "email", "phone"])(
    "public registration %s returns only a durable receipt and creates no account",
    async (kind) => {
      const data = input();
      if (kind === "email") data.email = existing.email;
      if (kind === "phone") data.phoneNumber = existing.phoneNumber;
      const before = await prismaTest.user.count();
      const r = await post("/auth/register").send(data).expect(202);
      receipt(r.body);
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
        where: { resourceId: r.requestId },
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
  it('allows an authenticated unassigned account to accept without creating a duplicate account', async () => {
    await prismaTest.user.update({where:{id:existing.id},data:{facilityId:null}});
    const r=await service.request(existing,randomUUID(),facility,admin.id),dto=await proofs(r);
    const v=await service.verify(dto);
    expect(v.status).toBe('AUTHENTICATION_REQUIRED');
    await service.accept(existing.id,{requestId:r.requestId,acceptanceToken:('acceptanceToken' in v ? v.acceptanceToken : '')!});
    expect((await prismaTest.user.findUniqueOrThrow({where:{id:existing.id}})).facilityId).toBe(facility);
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
      else
        await prismaTest.user.update({
          where: { id: admin.id },
          data: kind === "removed" ? { facilityId: null } : { isActive: false },
        });
      await expect(service.verify(dto)).rejects.toThrow();
      expect(await prismaTest.user.count()).toBe(2);
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
    send.mockResolvedValueOnce({ success: false, provider: "test-local" });
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
  it("recovers a stale SENDING enrollment attempt and rotates its credential", async () => {
    const r = await service.request(input(), randomUUID());
    const delivery =
      await prismaTest.accountInvitationDelivery.findFirstOrThrow({
        where: { enrollmentId: r.requestId, channel: "EMAIL" },
      });
    await prismaTest.accountInvitationDelivery.update({
      where: { id: delivery.id },
      data: { status: "SENDING", attemptCount: 1, lastAttemptAt: new Date(0) },
    });
    await worker.tick();
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
      ).status,
    ).toBe("SENT");
    expect(
      (
        await prismaTest.enrollmentRequest.findUniqueOrThrow({
          where: { id: r.requestId },
        })
      ).emailTokenHash,
    ).toMatch(/^[a-f0-9]{64}$/);
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
      password: "AnotherTestPassword123!",
    });
    await expect(
      resets.confirmReset({ token: raw, password }),
    ).rejects.toThrow();
  });
});
