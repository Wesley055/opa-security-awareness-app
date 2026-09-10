import { Prisma } from "@prisma/client";
import { ProtectedSnapshotsService } from "../../src/modules/protected-identity/protected-snapshots.service";
import { InvitationDeliveryWorker } from "../../src/modules/admin-provisioning/invitation-delivery.worker";
import { NotificationService } from "../../src/modules/notifications/notification.service";
import { createIncident } from "./fixtures";
import { randomBytes, randomUUID } from "crypto";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { prismaTest } from "./prisma-test-client";
import { createUser } from "./fixtures";
import { PrismaService } from "../../src/prisma/prisma.service";
import { JwtStrategy } from "../../src/modules/auth/jwt.strategy";
import {
  IdentityCrypto,
  LocalIdentityCrypto,
} from "../../src/modules/protected-identity/identity-crypto";
import { ProtectedIdentityService } from "../../src/modules/protected-identity/protected-identity.service";
import { ProtectedIdentityController } from "../../src/modules/protected-identity/protected-identity.controller";

const jwtSecret = "isolated-test-jwt-secret-only";
const jwt = new JwtService({ secret: jwtSecret });
const crypto = new LocalIdentityCrypto(
  new Map([["e1", randomBytes(32)]]),
  "e1",
  randomBytes(32),
  "h1",
);
let app: INestApplication;
let service: ProtectedIdentityService;
let actorId: string;
let tenantId: string;
let foreignTenantId: string;
let subjectId: string;
let identityId: string;
let token: string;
const caseReference = randomUUID();

beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [PassportModule],
    controllers: [ProtectedIdentityController],
    providers: [
      ProtectedIdentityService,
      JwtStrategy,
      { provide: PrismaService, useValue: prismaTest },
      { provide: IdentityCrypto, useValue: crypto },
      { provide: ConfigService, useValue: { getOrThrow: () => jwtSecret } },
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
  service = module.get(ProtectedIdentityService);
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  const actor = await createUser();
  const subject = await createUser();
  actorId = actor.id;
  subjectId = subject.id;
  tenantId = (await prismaTest.facility.create({ data: { name: "PII test facility", type: "OTHER" } })).id;
  foreignTenantId = (await prismaTest.facility.create({ data: { name: "PII test facility", type: "OTHER" } })).id;
  await prismaTest.user.updateMany({ where: { id: { in: [actorId, subjectId] } }, data: { facilityId: tenantId } });
  await prismaTest.user.update({ where: { id: actorId }, data: { role: "FACILITY_ADMIN" } });
  await prismaTest.identityAccessGrant.createMany({
    data: ["WRITE", "READ_MASKED", "LOOKUP", "RESOLVE", "DELIVERY"].map(
      (permission) => ({
        tenantId,
        actorUserId: actorId,
        permission: permission as "WRITE",
        expiresAt: new Date(Date.now() + 60000),
        approvedByReference: randomUUID(),
      }),
    ),
  });
  identityId = (
    await service.protect(
      actorId,
      {
        tenantId,
        subjectUserId: subjectId,
        sourceId: subjectId,
        kind: "EMAIL",
      },
      "Private.Person@Example.test",
    )
  ).id;
  token = jwt.sign({
    sub: actorId,
    email: actor.email,
    role: actor.role,
    credentialVersion: 0,
  });
});
const get = (tenant: string, id: string) =>
  request(app.getHttpServer())
    .get(`/protected-identities/${id}`)
    .set("Authorization", `Bearer ${token}`);
const resolve = (tenant: string, id: string) =>
  request(app.getHttpServer())
    .post(`/protected-identities/${id}/resolve`)
    .set("Authorization", `Bearer ${token}`)
    .send({ purpose: "SUPPORT_CASE", caseReference });

describe("protected identity real PostgreSQL and authenticated HTTP", () => {
  it("stores encrypted values and deterministic lookup metadata, retaining legacy records", async () => {
    const stored = await prismaTest.protectedIdentifier.findUniqueOrThrow({
      where: { id: identityId },
    });
    expect(JSON.stringify(stored)).not.toContain("private.person");
    expect(stored.lookupDigest).toHaveLength(64);
    expect(
      await prismaTest.user.findUnique({ where: { id: subjectId } }),
    ).not.toBeNull();
    expect(
      await service.lookup(
        actorId,
        tenantId,
        "EMAIL",
        " PRIVATE.PERSON@example.test ",
      ),
    ).toEqual([{ id: identityId, kind: "EMAIL", value: "[protected]" }]);
  });
  it("audits every concurrent reveal with distinct durable records", async () => {
    const values = await Promise.all(Array.from({ length: 8 }, () => service.resolve(actorId, tenantId, identityId, "SUPPORT_CASE", caseReference)));
    expect(values).toEqual(Array(8).fill("private.person@example.test"));
    const audits = await prismaTest.identityResolutionAudit.findMany({ where: { identifierId: identityId } });
    expect(audits).toHaveLength(8);
    expect(new Set(audits.map(audit => audit.id)).size).toBe(8);
  });
  it("denies interactive resolution after an actor loses their institutional role", async () => {
    await prismaTest.user.update({ where: { id: actorId }, data: { role: "USER" } });
    await resolve(tenantId, identityId).expect(404);
  });
  it("returns masked API output and no-store headers", async () => {
    const result = await get(tenantId, identityId).expect(200);
    expect(result.body).toEqual({
      id: identityId,
      kind: "EMAIL",
      value: "[protected]",
    });
    expect(result.headers["cache-control"]).toBe("no-store");
  });
  it("denies unauthenticated ID access", async () => {
    await request(app.getHttpServer())
      .get(`/protected-identities/${identityId}`)
      .expect(401);
  });
  it("resolves only with grant and records a durable audit", async () => {
    const result = await resolve(tenantId, identityId).expect(201);
    expect(result.body).toEqual({ value: "private.person@example.test" });
    const audit = await prismaTest.identityResolutionAudit.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenantId,
      actorUserId: actorId,
      identifierId: identityId,
      purpose: "SUPPORT_CASE",
      caseReference,
    });
    expect(JSON.stringify(audit)).not.toContain("private.person");
  });
  it("does not elevate ADMIN to decryptor", async () => {
    await prismaTest.user.update({
      where: { id: actorId },
      data: { role: "ADMIN" },
    });
    await prismaTest.identityAccessGrant.deleteMany({
      where: { actorUserId: actorId, permission: "RESOLVE" },
    });
    await resolve(tenantId, identityId).expect(404);
    expect(await prismaTest.identityResolutionAudit.count()).toBe(0);
  });
  it("makes foreign and missing references indistinguishable", async () => {
    await prismaTest.user.update({ where: { id: actorId }, data: { facilityId: foreignTenantId } });
    const foreign = await resolve(foreignTenantId, identityId).expect(404);
    const absent = await resolve(tenantId, randomUUID()).expect(404);
    expect(foreign.body).toEqual(absent.body);
  });
  it("rejects revoked and expired grants", async () => {
    await prismaTest.identityAccessGrant.updateMany({
      where: { permission: "RESOLVE" },
      data: { revokedAt: new Date() },
    });
    await resolve(tenantId, identityId).expect(404);
    await prismaTest.identityAccessGrant.updateMany({
      where: { permission: "RESOLVE" },
      data: { revokedAt: null, expiresAt: new Date(0) },
    });
    await resolve(tenantId, identityId).expect(404);
  });
  it("rejects inactive tenant and subject membership", async () => {
    await prismaTest.user.update({
      where: { id: subjectId },
      data: { isActive: false },
    });
    await resolve(tenantId, identityId).expect(404);
    await prismaTest.facility.update({
      where: { id: tenantId },
      data: { isActive: false },
    });
    await get(tenantId, identityId).expect(404);
  });
  it.each(["INVITATION_SNAPSHOT", "NOTIFICATION_SNAPSHOT"] as const)(
    "protects immutable %s and requires delivery authority",
    async (kind) => {
      const snapshot = JSON.stringify({
        recipient: "+14155552671",
        message: "code-87654321",
        trackingUrl: "https://example.test/secret",
      });
      const context = {
        tenantId,
        subjectUserId: subjectId,
        sourceId: randomUUID(),
        kind,
      };
      const protectedRow = await service.protect(actorId, context, snapshot);
      expect(
        await service.resolve(
          actorId,
          tenantId,
          protectedRow.id,
          "DELIVERY",
          caseReference,
        ),
      ).toBe(snapshot);
      await resolve(tenantId, protectedRow.id).expect(404);
      await expect(
        service.protect(actorId, context, "changed"),
      ).rejects.toThrow("Protected identity operation unavailable.");
      const stored = await prismaTest.protectedIdentifier.findUniqueOrThrow({
        where: { id: protectedRow.id },
      });
      expect(stored.lookupDigest).toBeNull();
      expect(JSON.stringify(stored)).not.toContain("87654321");
    },
  );
  it("enforces facility foreign keys without duplicating membership tables", async () => {
    const stored = await prismaTest.protectedIdentifier.findUniqueOrThrow({
      where: { id: identityId },
    });
    await expect(
      prismaTest.protectedIdentifier.create({
        data: { ...stored, id: randomUUID(), tenantId: randomUUID() },
      }),
    ).rejects.toThrow();
  });
  it("prevents ordinary audit deletion and modification", async () => {
    await resolve(tenantId, identityId).expect(201);
    await expect(
      prismaTest.identityResolutionAudit.deleteMany(),
    ).rejects.toThrow();
    await expect(
      prismaTest.identityResolutionAudit.updateMany({
        data: { purpose: "changed" },
      }),
    ).rejects.toThrow();
  });
  it("does not accept body-supplied grants, roles or delivery purpose", async () => {
    await request(app.getHttpServer())
      .post(`/protected-identities/${identityId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ purpose: "DELIVERY", caseReference, role: "ADMIN" })
      .expect(400);
  });
});

describe("protected recipient snapshot cutover and real workers", () => {
  const previousActor = process.env.PII_DELIVERY_ACTOR_USER_ID;
  let snapshots: ProtectedSnapshotsService;
  beforeEach(() => {
    process.env.PII_DELIVERY_ACTOR_USER_ID = actorId;
    snapshots = new ProtectedSnapshotsService(
      prismaTest as unknown as PrismaService,
      service,
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (previousActor === undefined)
      delete process.env.PII_DELIVERY_ACTOR_USER_ID;
    else process.env.PII_DELIVERY_ACTOR_USER_ID = previousActor;
  });
  async function invitation() {
    const facility = { id: tenantId };
    await prismaTest.user.update({
      where: { id: subjectId },
      data: { facilityId: facility.id, accountStatus: "PENDING_ACTIVATION" },
    });
    return prismaTest.accountInvitationDelivery.create({
      data: {
        userId: subjectId,
        facilityId: facility.id,
        recipient: "+14155552671",
        channel: "SMS",
        status: "QUEUED",
        lastError: "old sensitive provider detail",
      },
    });
  }
  async function notification() {
    const incident =
      (await prismaTest.incident.findFirst({ where: { userId: subjectId } })) ??
      (await createIncident(subjectId));
    await prismaTest.incident.update({ where: { id: incident.id }, data: { facilityId: tenantId } });
    return prismaTest.incidentNotification.create({
      data: {
        incidentId: incident.id,
        recipient: "+14155552671",
        contactName: "Private contact",
        contactType: "TRUSTED",
        channel: "SMS",
        status: "QUEUED",
        payload: {
          version: 1,
          channel: "SMS",
          recipient: "+14155552671",
          message: "secret-bearing message",
          subject: "Emergency",
          trackingUrl: "https://example.test/secret-token",
          personName: "Private person",
          location: "Private location",
        },
      },
    });
  }
  const notify = (send: jest.Mock) =>
    new NotificationService(
      prismaTest as unknown as PrismaService,
      { send } as never,
      { send } as never,
      { send } as never,
      { send } as never,
      { send } as never,
      snapshots,
    );

  it("dry-runs without creating ciphertext or changing the source", async () => {
    const source = await invitation();
    expect(
      await snapshots.backfill(
        actorId,
        tenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        source.updatedAt,
      ),
    ).toEqual({ sourceId: source.id, status: "READY" });
    expect(
      await prismaTest.accountInvitationDelivery.findUnique({
        where: { id: source.id },
      }),
    ).toEqual(source);
    expect(await prismaTest.protectedIdentifier.count()).toBe(1);
  });
  it("refuses stale source versions and in-flight deliveries", async () => {
    const source = await invitation();
    await expect(
      snapshots.backfill(
        actorId,
        tenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        new Date(0),
        true,
      ),
    ).rejects.toThrow();
    const sending = await prismaTest.accountInvitationDelivery.update({
      where: { id: source.id },
      data: { status: "SENDING" },
    });
    await expect(
      snapshots.backfill(
        actorId,
        tenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        sending.updatedAt,
        true,
      ),
    ).rejects.toThrow();
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).recipient,
    ).toBe(source.recipient);
  });
  it("refuses cutover without independently granted delivery authority", async () => {
    const source = await invitation();
    await prismaTest.identityAccessGrant.deleteMany({
      where: { permission: "DELIVERY" },
    });
    await expect(
      snapshots.backfill(
        actorId,
        tenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        source.updatedAt,
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).protectedSnapshotId,
    ).toBeNull();
  });
  it("rejects source ownership from another tenant without inferring facility scope", async () => {
    const source = await invitation();
    await prismaTest.user.update({ where: { id: actorId }, data: { facilityId: foreignTenantId } });
    await prismaTest.identityAccessGrant.create({
      data: {
        tenantId: foreignTenantId,
        actorUserId: actorId,
        permission: "WRITE",
        expiresAt: new Date(Date.now() + 60000),
        approvedByReference: randomUUID(),
      },
    });
    await expect(
      snapshots.backfill(
        actorId,
        foreignTenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        source.updatedAt,
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("cuts over invitations atomically and delivers the frozen recipient after audit commit", async () => {
    const source = await invitation();
    await snapshots.backfill(
      actorId,
      tenantId,
      "INVITATION_SNAPSHOT",
      source.id,
      source.updatedAt,
      true,
    );
    const stored = await prismaTest.accountInvitationDelivery.findUniqueOrThrow(
      { where: { id: source.id } },
    );
    expect(stored.recipient).toBe("[protected]");
    expect(stored.lastError).toBeNull();
    await prismaTest.user.update({
      where: { id: subjectId },
      data: { phoneNumber: "+14155552672" },
    });
    const send = jest.fn(async () => {
      expect(
        await prismaTest.identityResolutionAudit.count({
          where: { identifierId: stored.protectedSnapshotId! },
        }),
      ).toBe(1);
      return { success: true, provider: "SMS", messageId: "test-delivery" };
    });
    await new InvitationDeliveryWorker(
      prismaTest as never,
      { send } as never,
      {} as never,
      {} as never,
      snapshots,
    ).tick();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: source.recipient }),
    );
    expect(
      (
        await prismaTest.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).status,
    ).toBe("SENT");
    expect(
      await snapshots.backfill(
        actorId,
        tenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        source.updatedAt,
        true,
      ),
    ).toEqual({ sourceId: source.id, status: "ALREADY_PROTECTED" });
  });
  it("encrypts the entire notification payload and delivers it after durable audit", async () => {
    const source = await notification();
    await snapshots.backfill(
      actorId,
      tenantId,
      "NOTIFICATION_SNAPSHOT",
      source.id,
      source.updatedAt,
      true,
    );
    const stored = await prismaTest.incidentNotification.update({
      where: { id: source.id },
      data: { status: "SENDING" },
    });
    expect(stored.payload).toBeNull();
    expect(stored.contactName).toBe("[protected]");
    expect(JSON.stringify(stored)).not.toContain("secret");
    const send = jest.fn(async () => {
      expect(
        await prismaTest.identityResolutionAudit.count({
          where: { identifierId: stored.protectedSnapshotId! },
        }),
      ).toBe(1);
      return { success: true, provider: "SMS" };
    });
    await notify(send).dispatchNotification(source.id);
    expect(send).toHaveBeenCalledWith({
      recipient: "+14155552671",
      message: "secret-bearing message",
      subject: "Emergency",
    });
    expect(
      (
        await prismaTest.incidentNotification.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).status,
    ).toBe("SENT");
  });
  it("does not send when snapshot decryption or audit fails", async () => {
    const source = await notification();
    await snapshots.backfill(
      actorId,
      tenantId,
      "NOTIFICATION_SNAPSHOT",
      source.id,
      source.updatedAt,
      true,
    );
    await prismaTest.incidentNotification.update({
      where: { id: source.id },
      data: { status: "SENDING" },
    });
    const send = jest.fn();
    // Fail the transaction's real INSERT, not a root-client delegate that the transaction never calls.
    await prismaTest.$executeRawUnsafe(
      'ALTER TABLE "IdentityResolutionAudit" ADD CONSTRAINT pii_test_reject_audit CHECK ("purpose" <> \'DELIVERY\') NOT VALID',
    );
    try {
      await notify(send).dispatchNotification(source.id);
      expect(send).not.toHaveBeenCalled();
    } finally {
      await prismaTest.$executeRawUnsafe(
        'ALTER TABLE "IdentityResolutionAudit" DROP CONSTRAINT pii_test_reject_audit',
      );
    }
    await prismaTest.incidentNotification.update({
      where: { id: source.id },
      data: { status: "SENDING" },
    });
    jest
      .spyOn(crypto, "open")
      .mockRejectedValueOnce(new Error("secret key details"));
    await notify(send).dispatchNotification(source.id);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await prismaTest.incidentNotification.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).lastError,
    ).toBe("Protected snapshot unavailable.");
  });
  it("rejects copied snapshot references without a plaintext fallback", async () => {
    const first = await notification();
    await snapshots.backfill(
      actorId,
      tenantId,
      "NOTIFICATION_SNAPSHOT",
      first.id,
      first.updatedAt,
      true,
    );
    const stored = await prismaTest.incidentNotification.findUniqueOrThrow({
      where: { id: first.id },
    });
    const second = await notification();
    await prismaTest.incidentNotification.update({
      where: { id: second.id },
      data: {
        status: "SENDING",
        protectedSnapshotId: stored.protectedSnapshotId,
        recipient: "[protected]",
        contactName: "[protected]",
        payload: Prisma.DbNull,
      },
    });
    const send = jest.fn();
    await notify(send).dispatchNotification(second.id);
    expect(send).not.toHaveBeenCalled();
  });
  it("rolls back source cutover on crypto failure", async () => {
    const source = await invitation();
    jest.spyOn(crypto, "seal").mockRejectedValueOnce(new Error("no keys"));
    await expect(
      snapshots.backfill(
        actorId,
        tenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        source.updatedAt,
        true,
      ),
    ).rejects.toThrow();
    expect(
      await prismaTest.accountInvitationDelivery.findUnique({
        where: { id: source.id },
      }),
    ).toEqual(source);
    expect(await prismaTest.protectedIdentifier.count()).toBe(1);
  });
  it("serializes repeated cutover and blocks plaintext reintroduction at the database", async () => {
    const source = await invitation();
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        snapshots.backfill(
          actorId,
          tenantId,
          "INVITATION_SNAPSHOT",
          source.id,
          source.updatedAt,
          true,
        ),
      ),
    );
    expect(outcomes.map((x) => x.status).sort()).toEqual([
      "ALREADY_PROTECTED",
      "PROTECTED",
    ]);
    await expect(
      prismaTest.accountInvitationDelivery.update({
        where: { id: source.id },
        data: { recipient: source.recipient },
      }),
    ).rejects.toThrow();
  });

  it("keeps legacy plaintext intact when persisted ciphertext cannot verify", async () => {
    const source = await invitation();
    jest.spyOn(crypto, "open").mockResolvedValueOnce("different-value");
    await expect(
      snapshots.backfill(
        actorId,
        tenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        source.updatedAt,
        true,
      ),
    ).rejects.toThrow();
    expect(
      await prismaTest.accountInvitationDelivery.findUnique({
        where: { id: source.id },
      }),
    ).toEqual(source);
  });
  it("resumes successfully after a failed cutover without duplicate protected rows", async () => {
    const source = await invitation();
    const seal = jest
      .spyOn(crypto, "seal")
      .mockRejectedValueOnce(new Error("key unavailable"));
    await expect(
      snapshots.backfill(
        actorId,
        tenantId,
        "INVITATION_SNAPSHOT",
        source.id,
        source.updatedAt,
        true,
      ),
    ).rejects.toThrow();
    seal.mockRestore();
    await snapshots.backfill(
      actorId,
      tenantId,
      "INVITATION_SNAPSHOT",
      source.id,
      source.updatedAt,
      true,
    );
    await snapshots.backfill(
      actorId,
      tenantId,
      "INVITATION_SNAPSHOT",
      source.id,
      source.updatedAt,
      true,
    );
    expect(
      await prismaTest.protectedIdentifier.count({
        where: { sourceId: source.id },
      }),
    ).toBe(1);
  });
});
