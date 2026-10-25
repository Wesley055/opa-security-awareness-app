import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { AccountDeletionService } from "./account-deletion.service";
import { AccountDeletionController } from "./account-deletion.controller";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { requireActiveAccount } from "./active-account";

function fixture() {
  const user = {
    id: "owner",
    role: "USER",
    isActive: true,
    accountStatus: "ACTIVE",
  };
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn() },
    administrativeAuditEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    incident: { findFirst: jest.fn().mockResolvedValue(null) },
    journeySession: { findFirst: jest.fn().mockResolvedValue(null) },
    safeWalkGuardianGrant: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
    },
    incidentNotification: { updateMany: jest.fn() },
    accountInvitationDelivery: { updateMany: jest.fn() },
    safeWalkNotice: { updateMany: jest.fn() },
    safeWalkGuardianCode: { updateMany: jest.fn() },
    identityAccessGrant: { updateMany: jest.fn() },
    protectedIdentifier: { deleteMany: jest.fn() },
    ssoExternalIdentity: {
      findMany: jest.fn().mockResolvedValue([{ id: "mapping" }]),
      update: jest.fn(),
    },
    ssoTransaction: { updateMany: jest.fn() },
    enrollmentRequest: { updateMany: jest.fn() },
    visitorPass: { updateMany: jest.fn() },
    savedPlace: { deleteMany: jest.fn() },
    safeWalkPlan: { updateMany: jest.fn() },
    deviceSmsKey: { updateMany: jest.fn() },
    passwordResetToken: { deleteMany: jest.fn() },
    emergencyContact: { deleteMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (work: (t: typeof tx) => unknown) => work(tx)),
  };
  return { tx, user, service: new AccountDeletionService(prisma as never) };
}
describe("self-service account deletion", () => {
  it("de-identifies the profile, invalidates credentials and retains the User identity/history", async () => {
    const { tx, service } = fixture();
    await expect(service.deleteAccount("owner")).resolves.toEqual({
      status: "DELETED",
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "owner" },
      data: expect.objectContaining({
        isActive: false,
        credentialVersion: { increment: 1 },
        passwordHash: null,
        activationTokenHash: null,
        activationExpiresAt: null,
        firstName: "Deleted",
        lastName: "Account",
        facilityId: null,
        invitedByUserId: null,
        email: expect.stringMatching(/^deleted\+[a-f0-9-]+@account\.invalid$/),
        phoneNumber: expect.stringMatching(/^deleted:[a-f0-9-]+$/),
      }),
    });
    expect(tx.emergencyContact.deleteMany).toHaveBeenCalledWith({
      where: { userId: "owner" },
    });
    expect(tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "owner" },
    });
    expect(tx.administrativeAuditEvent.create).toHaveBeenCalledWith({
      data: {
        actorUserId: "owner",
        actorRole: "USER",
        action: "ACCOUNT_DELETED",
        resourceId: "owner",
        afterState: {
          completed: true,
          profileDeidentified: true,
          credentialsRevoked: true,
        },
      },
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.update.mock.invocationCallOrder[0]!,
    );
  });
  it("revokes unused EstateFlow visitor passes but keeps visitors already inside", async () => {
    const { tx, service } = fixture();
    await service.deleteAccount("owner");
    expect(tx.visitorPass.updateMany).toHaveBeenCalledWith({
      where: { hostUserId: "owner", status: "ISSUED" },
      data: { status: "REVOKED", closedAt: expect.any(Date) },
    });
  });

  it("revokes identity, SSO and guardian authority while preserving retained snapshot/audit references", async () => {
    const { tx, service } = fixture();
    await service.deleteAccount("owner");
    expect(tx.identityAccessGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { actorUserId: "owner", revokedAt: null },
      }),
    );
    expect(tx.protectedIdentifier.deleteMany).toHaveBeenCalledWith({
      where: {
        subjectUserId: "owner",
        kind: { in: ["EMAIL", "PHONE"] },
        incidentSnapshots: { none: {} },
        invitationSnapshots: { none: {} },
      },
    });
    expect(tx.ssoExternalIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: false,
          unlinkedAt: expect.any(Date),
          identityDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(tx.safeWalkGuardianGrant.updateMany).toHaveBeenCalled();
    expect(tx.safeWalkGuardianCode.updateMany).toHaveBeenCalled();
    expect(tx.enrollmentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityCiphertext: "",
          acceptanceTokenHash: null,
          revokedAt: expect.any(Date),
        }),
      }),
    );
    expect(tx.incidentNotification.updateMany).toHaveBeenCalled();
  });
  it.each(["ADMIN", "FACILITY_ADMIN", "FACILITY_OPERATOR", "RESPONDER"])(
    "fails closed for %s",
    async (role) => {
      const { tx, user, service } = fixture();
      user.role = role;
      await expect(service.deleteAccount("owner")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    },
  );
  it.each(["incident", "journeySession", "safeWalkGuardianGrant"] as const)(
    "refuses live %s without mutation",
    async (kind) => {
      const { tx, service } = fixture();
      tx[kind].findFirst.mockResolvedValue({ id: "live" });
      await expect(service.deleteAccount("owner")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.emergencyContact.deleteMany).not.toHaveBeenCalled();
    },
  );
  it("makes a concurrent authenticated retry harmless without another credential increment", async () => {
    const { tx, user, service } = fixture();
    user.isActive = false;
    tx.administrativeAuditEvent.findFirst.mockResolvedValue({ id: "audit" });
    await expect(service.deleteAccount("owner")).resolves.toEqual({
      status: "DELETED",
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it("does not treat an unrelated suspension as completed deletion", async () => {
    const { user, service } = fixture();
    user.isActive = false;
    await expect(service.deleteAccount("owner")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it("never releases database error details or profile PII", async () => {
    const { tx, service } = fixture();
    tx.user.update.mockRejectedValue(new Error("private@example.com"));
    await expect(service.deleteAccount("owner")).rejects.toEqual(
      new ServiceUnavailableException(
        "Account deletion could not be completed. Please try again.",
      ),
    );
  });
  it("uses only the authenticated principal and requires the JWT guard", async () => {
    const deletion = { deleteAccount: jest.fn() };
    const controller = new AccountDeletionController(deletion as never);
    await controller.deleteAccount({
      user: { sub: "principal" },
      body: { userId: "victim" },
    } as never);
    expect(deletion.deleteAccount).toHaveBeenCalledWith("principal");
    expect(
      Reflect.getMetadata("__guards__", controller.deleteAccount),
    ).toContain(JwtAuthGuard);
  });
  it("rejects a stale authenticated lifecycle operation after deletion", async () => {
    const { tx, user } = fixture();
    user.isActive = false;
    await expect(
      requireActiveAccount(tx as never, "owner"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
