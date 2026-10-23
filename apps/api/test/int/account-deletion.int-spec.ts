import type { Prisma } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PassportModule } from "@nestjs/passport";
import { JwtService } from "@nestjs/jwt";
import { randomUUID, createHash } from "node:crypto";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { prismaTest as db } from "./prisma-test-client";
import { PrismaService } from "../../src/prisma/prisma.service";
import { AccountDeletionController } from "../../src/modules/auth/account-deletion.controller";
import { AccountDeletionService } from "../../src/modules/auth/account-deletion.service";
import { AuthService } from "../../src/modules/auth/auth.service";
import { JwtStrategy } from "../../src/modules/auth/jwt.strategy";
import { UsersService } from "../../src/modules/users/users.service";
import { RefreshTokenService } from "../../src/modules/refresh-token/refresh-token.service";
import { IncidentTimelineService } from "../../src/modules/incident-timeline/incident-timeline.service";
import { requireActiveAccount } from "../../src/modules/auth/active-account";

const secret = "account-deletion-disposable-test-only";
const values: Record<string, string | number> = {
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret + "-refresh",
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "30d",
  BCRYPT_ROUNDS: 4,
};
const config = {
  getOrThrow: (key: string) => {
    if (!(key in values)) throw Error("Test config missing");
    return values[key];
  },
} as ConfigService;
const jwt = new JwtService();
const users = new UsersService(db as never);
const auth = new AuthService(users, jwt, config);
const refresh = new RefreshTokenService(jwt, config, db as never);
const deletion = new AccountDeletionService(db as never);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
async function user(
  role:
    | "USER"
    | "ADMIN"
    | "FACILITY_ADMIN"
    | "FACILITY_OPERATOR"
    | "RESPONDER" = "USER",
  facilityId?: string,
) {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      email: id + "@example.test",
      phoneNumber: "+" + Date.now() + Math.floor(Math.random() * 10000),
      firstName: "Private",
      lastName: "Person",
      role,
      facilityId,
      passwordHash: await bcrypt.hash("test-password-123", 4),
    },
  });
}
const token = (u: { id: string; email: string; role: string }) =>
  jwt.sign(
    { sub: u.id, email: u.email, role: u.role, credentialVersion: 0 },
    { secret },
  );

describe("account deletion on disposable PostgreSQL", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AccountDeletionController],
      providers: [
        AccountDeletionService,
        JwtStrategy,
        { provide: PrismaService, useValue: db },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it("requires authentication and cannot target another account, even across tenants", async () => {
    const a = await db.facility.create({ data: { name: "A", type: "OTHER" } });
    const b = await db.facility.create({ data: { name: "B", type: "OTHER" } });
    const owner = await user("USER", a.id),
      other = await user("USER", b.id);
    await request(app.getHttpServer())
      .delete("/auth/account")
      .send({ userId: owner.id })
      .expect(401);
    const response = await request(app.getHttpServer())
      .delete("/auth/account")
      .auth(token(owner), { type: "bearer" })
      .send({ userId: other.id, email: other.email })
      .expect(200);
    expect(response.body).toEqual({ status: "DELETED" });
    expect(await db.user.findUnique({ where: { id: other.id } })).toEqual(
      other,
    );
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).facilityId,
    ).toBeNull();
    await request(app.getHttpServer())
      .delete("/auth/account")
      .auth(token(owner), { type: "bearer" })
      .expect(401);
  });

  it("preserves incident, evidence, timeline and audit records while deleting profile and disposable credentials", async () => {
    const owner = await user();
    const issued = await auth.issueTokens(owner);
    await db.user.update({
      where: { id: owner.id },
      data: {
        activationTokenHash: digest("activation"),
        activationExpiresAt: new Date(Date.now() + 60000),
      },
    });
    const incident = await db.incident.create({
      data: {
        userId: owner.id,
        trigger: "SOS_BUTTON",
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });
    const evidence = await db.evidence.create({
      data: {
        incidentId: incident.id,
        type: "DOCUMENT",
        status: "STORED",
        sha256: "a".repeat(64),
        storageKey: "retained-evidence",
      },
    });
    const timeline = await new IncidentTimelineService(db as never).recordEvent(
      {
        incidentId: incident.id,
        type: "INCIDENT_RESOLVED",
        source: "TEST",
        actorUserId: owner.id,
      },
    );
    const priorAudit = await db.administrativeAuditEvent.create({
      data: {
        actorUserId: owner.id,
        resourceId: owner.id,
        actorRole: "USER",
        action: "RETAINED",
      },
    });
    await db.emergencyContact.create({
      data: {
        userId: owner.id,
        firstName: "Contact",
        lastName: "Private",
        relationship: "Friend",
        phoneNumber: "+2348012345678",
      },
    });
    await db.passwordResetToken.create({
      data: {
        userId: owner.id,
        tokenHash: digest("reset"),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await deletion.deleteAccount(owner.id);
    const deleted = await db.user.findUniqueOrThrow({
      where: { id: owner.id },
    });
    expect(deleted).toMatchObject({
      isActive: false,
      credentialVersion: 1,
      passwordHash: null,
      activationTokenHash: null,
      activationExpiresAt: null,
      firstName: "Deleted",
      lastName: "Account",
    });
    expect(deleted.email).toMatch(/^deleted\+.*@account\.invalid$/);
    expect(deleted.phoneNumber).toMatch(/^deleted:/);
    expect(
      await db.incident.findUnique({ where: { id: incident.id } }),
    ).toEqual(incident);
    expect(
      await db.evidence.findUnique({ where: { id: evidence.id } }),
    ).toEqual(evidence);
    expect(
      await db.incidentTimelineEvent.findUnique({ where: { id: timeline.id } }),
    ).toEqual(timeline);
    expect(
      await db.administrativeAuditEvent.findUnique({
        where: { id: priorAudit.id },
      }),
    ).toEqual(priorAudit);
    expect(
      await db.emergencyContact.count({ where: { userId: owner.id } }),
    ).toBe(0);
    expect(
      await db.passwordResetToken.count({ where: { userId: owner.id } }),
    ).toBe(0);
    await expect(
      auth.login({ email: owner.email, password: "test-password-123" }),
    ).rejects.toThrow("Invalid credentials");
    await expect(refresh.rotate(issued.refreshToken)).rejects.toThrow();
    await request(app.getHttpServer())
      .delete("/auth/account")
      .auth(issued.accessToken, { type: "bearer" })
      .expect(401);
    const audit = await db.administrativeAuditEvent.findFirstOrThrow({
      where: { action: "ACCOUNT_DELETED" },
    });
    for (const value of [
      owner.email,
      owner.phoneNumber,
      owner.firstName,
      owner.lastName,
    ])
      expect(JSON.stringify(audit)).not.toContain(value);
    // Fresh identity proof may create a new account; retained history stays under the old UUID.
    const reused = await db.user.create({
      data: {
        email: owner.email,
        phoneNumber: owner.phoneNumber,
        firstName: "New",
        lastName: "Account",
      },
    });
    expect(reused.id).not.toBe(owner.id);
    expect(await db.incident.count({ where: { userId: reused.id } })).toBe(0);
  });

  it("revokes Protected Identity/SSO/guardian rights, clears accepted enrollment PII and retains snapshot/audit relations", async () => {
    const facility = await db.facility.create({
      data: { name: "Membership", type: "OTHER" },
    });
    const owner = await user("USER", facility.id),
      guardian = await user("USER", facility.id);
    const profile = await db.protectedIdentifier.create({
      data: {
        tenantId: facility.id,
        subjectUserId: owner.id,
        sourceId: owner.id,
        kind: "EMAIL",
        encryptionKeyVersion: "test",
        ciphertext: "encrypted-profile",
        nonce: "a".repeat(16),
        tag: "a".repeat(24),
        lookupDigest: "a".repeat(64),
        lookupKeyVersion: "test",
      },
    });
    const snapshot = await db.protectedIdentifier.create({
      data: {
        tenantId: facility.id,
        subjectUserId: owner.id,
        sourceId: randomUUID(),
        kind: "INVITATION_SNAPSHOT",
        encryptionKeyVersion: "test",
        ciphertext: "retained-history",
        nonce: "a".repeat(16),
        tag: "a".repeat(24),
      },
    });
    const grant = await db.identityAccessGrant.create({
      data: {
        tenantId: facility.id,
        actorUserId: owner.id,
        permission: "DELIVERY",
        approvedByReference: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const resolutionAudit = await db.identityResolutionAudit.create({
      data: {
        tenantId: facility.id,
        actorUserId: owner.id,
        identifierId: profile.id,
        grantId: grant.id,
        purpose: "ACCOUNT_RECOVERY",
        caseReference: randomUUID(),
        encryptionKeyVersion: "test",
      },
    });
    const sso = await db.ssoConfiguration.create({
      data: {
        facilityId: facility.id,
        providerType: "OIDC",
        issuer: "https://issuer.test",
        audience: "opa-test",
        trust: {},
        enabled: true,
      },
    });
    const mapping = await db.ssoExternalIdentity.create({
      data: {
        facilityId: facility.id,
        configurationId: sso.id,
        userId: owner.id,
        identityDigest: digest("subject"),
        identityCiphertext: { private: "subject" },
      },
    });
    const enrollment = await db.enrollmentRequest.create({
      data: {
        acceptedUserId: owner.id,
        verifiedAt: new Date(),
        acceptedAt: new Date(),
        identityCiphertext: "private-encrypted",
        idempotencyDigest: digest("enrollment"),
        expiresAt: new Date(Date.now() + 60000),
        emailTokenHash: digest("email"),
        phoneTokenHash: digest("phone"),
      },
    });
    const invitation = await db.accountInvitationDelivery.create({
      data: {
        userId: owner.id,
        facilityId: facility.id,
        recipient: "[protected]",
        channel: "EMAIL",
        status: "QUEUED",
        protectedSnapshotId: snapshot.id,
      },
    });
    const enrollmentDelivery = await db.accountInvitationDelivery.create({
      data: {
        purpose: "ENROLLMENT",
        enrollmentId: enrollment.id,
        recipient: "",
        channel: "EMAIL",
        status: "QUEUED",
      },
    });
    const session = await db.journeySession.create({
      data: {
        userId: owner.id,
        purpose: "SAFEWALK",
        status: "ENDED",
        endedAt: new Date(),
        endedReason: "USER_ENDED",
      },
    });
    const code = await db.safeWalkGuardianCode.create({
      data: {
        userId: owner.id,
        codeHash: digest("pair"),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const guardianGrant = await db.safeWalkGuardianGrant.create({
      data: {
        sessionId: session.id,
        ownerUserId: owner.id,
        guardianUserId: guardian.id,
        facilityScopeId: facility.id,
      },
    });
    await deletion.deleteAccount(owner.id);
    expect(
      await db.protectedIdentifier.findUnique({ where: { id: profile.id } }),
    ).toBeNull();
    expect(
      await db.protectedIdentifier.findUnique({ where: { id: snapshot.id } }),
    ).toEqual(snapshot);
    expect(
      await db.identityResolutionAudit.findUnique({
        where: { id: resolutionAudit.id },
      }),
    ).toEqual(resolutionAudit);
    expect(
      (
        await db.identityAccessGrant.findUniqueOrThrow({
          where: { id: grant.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      await db.ssoExternalIdentity.findUnique({ where: { id: mapping.id } }),
    ).toMatchObject({ enabled: false, identityCiphertext: null });
    expect(
      await db.enrollmentRequest.findUnique({ where: { id: enrollment.id } }),
    ).toMatchObject({
      identityCiphertext: "",
      emailTokenHash: null,
      phoneTokenHash: null,
    });
    expect(
      (
        await db.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).status,
    ).toBe("CANCELLED");
    expect(
      (
        await db.accountInvitationDelivery.findUniqueOrThrow({
          where: { id: enrollmentDelivery.id },
        })
      ).status,
    ).toBe("CANCELLED");
    expect(
      (
        await db.safeWalkGuardianCode.findUniqueOrThrow({
          where: { id: code.id },
        })
      ).consumedAt,
    ).not.toBeNull();
    expect(
      (
        await db.safeWalkGuardianGrant.findUniqueOrThrow({
          where: { id: guardianGrant.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      await db.journeySession.findUnique({ where: { id: session.id } }),
    ).toEqual(session);
  });

  it.each([
    "ADMIN",
    "FACILITY_ADMIN",
    "FACILITY_OPERATOR",
    "RESPONDER",
  ] as const)(
    "rejects institutional/privileged role %s without changing it",
    async (role) => {
      const owner = await user(role);
      await request(app.getHttpServer())
        .delete("/auth/account")
        .auth(token(owner), { type: "bearer" })
        .expect(403);
      expect(await db.user.findUnique({ where: { id: owner.id } })).toEqual(
        owner,
      );
    },
  );
  it.each(["OPEN", "ACKNOWLEDGED"] as const)(
    "refuses %s emergency and preserves it",
    async (status) => {
      const owner = await user();
      const incident = await db.incident.create({
        data: { userId: owner.id, trigger: "SOS_BUTTON", status },
      });
      await request(app.getHttpServer())
        .delete("/auth/account")
        .auth(token(owner), { type: "bearer" })
        .expect(409);
      expect(
        await db.incident.findUnique({ where: { id: incident.id } }),
      ).toEqual(incident);
    },
  );
  it("refuses live tracking and live guardian duty", async () => {
    const owner = await user(),
      guardian = await user();
    const session = await db.journeySession.create({
      data: { userId: owner.id, purpose: "SAFEWALK" },
    });
    await db.safeWalkGuardianGrant.create({
      data: {
        sessionId: session.id,
        ownerUserId: owner.id,
        guardianUserId: guardian.id,
      },
    });
    await expect(deletion.deleteAccount(owner.id)).rejects.toThrow(
      "Finish your active",
    );
    await expect(deletion.deleteAccount(guardian.id)).rejects.toThrow(
      "Finish your active",
    );
  });
  it("serializes retries with one tombstone, credential increment and durable audit", async () => {
    const owner = await user();
    await Promise.all([
      deletion.deleteAccount(owner.id),
      deletion.deleteAccount(owner.id),
    ]);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
        .credentialVersion,
    ).toBe(1);
    expect(
      await db.administrativeAuditEvent.count({
        where: { resourceId: owner.id, action: "ACCOUNT_DELETED" },
      }),
    ).toBe(1);
  });
  it("blocks an already-authenticated activation when deletion wins the lifecycle lock", async () => {
    const owner = await user();
    await deletion.deleteAccount(owner.id);
    await expect(
      db.$transaction(async (tx) => {
        await requireActiveAccount(tx, owner.id);
        await tx.incident.create({
          data: { userId: owner.id, trigger: "SOS_BUTTON" },
        });
      }),
    ).rejects.toThrow("Account unavailable");
    expect(await db.incident.count({ where: { userId: owner.id } })).toBe(0);
  });
  it("rolls back profile, contact and credential changes when the mandatory audit cannot commit", async () => {
    const owner = await user();
    const contact = await db.emergencyContact.create({
      data: {
        userId: owner.id,
        firstName: "Friend",
        lastName: "Private",
        relationship: "Friend",
        phoneNumber: "+2348012345678",
      },
    });
    const failing = new AccountDeletionService({
      $transaction: (
        work: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        db.$transaction((tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key === "administrativeAuditEvent")
                  return {
                    ...target.administrativeAuditEvent,
                    create: async () => {
                      throw Error("Audit unavailable");
                    },
                  };
                return Reflect.get(target, key);
              },
            }),
          ),
        ),
    } as never);
    await expect(failing.deleteAccount(owner.id)).rejects.toThrow(
      "could not be completed",
    );
    expect(await db.user.findUnique({ where: { id: owner.id } })).toEqual(
      owner,
    );
    expect(
      await db.emergencyContact.findUnique({ where: { id: contact.id } }),
    ).toEqual(contact);
    expect(
      await db.administrativeAuditEvent.count({
        where: { action: "ACCOUNT_DELETED" },
      }),
    ).toBe(0);
  });
  it("refuses deletion when an in-flight activation wins the shared lifecycle lock", async () => {
    const owner = await user();
    let locked!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => {
      locked = r;
    });
    const proceed = new Promise<void>((r) => {
      release = r;
    });
    const activation = db.$transaction(async (tx) => {
      await requireActiveAccount(tx, owner.id);
      locked();
      await proceed;
      return tx.incident.create({
        data: { userId: owner.id, trigger: "SOS_BUTTON" },
      });
    });
    await ready;
    const outcome = deletion.deleteAccount(owner.id).catch((error) => error);
    release();
    const incident = await activation;
    expect(await outcome).toMatchObject({ status: 409 });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).isActive,
    ).toBe(true);
    expect(
      (await db.incident.findUniqueOrThrow({ where: { id: incident.id } }))
        .status,
    ).toBe("OPEN");
  });
});
