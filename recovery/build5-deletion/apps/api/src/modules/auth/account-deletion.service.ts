import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";

export const ACCOUNT_DELETED_ACTION = "ACCOUNT_DELETED";
const completed = () => ({ status: "DELETED" as const });

@Injectable()
export class AccountDeletionService {
  constructor(private readonly prisma: PrismaService) {}

  async deleteAccount(userId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Same lifecycle lock as SOS, Journey, enrollment, SSO and provisioning.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              role: true,
              isActive: true,
              accountStatus: true,
            },
          });
          if (!user) throw new UnauthorizedException("Account unavailable.");
          const prior = await tx.administrativeAuditEvent.findFirst({
            where: {
              actorUserId: userId,
              resourceId: userId,
              action: ACCOUNT_DELETED_ACTION,
            },
            select: { id: true },
          });
          if (prior && !user.isActive) return completed();
          if (!user.isActive || user.accountStatus !== "ACTIVE")
            throw new UnauthorizedException("Account unavailable.");
          if (user.role !== "USER")
            throw new ForbiddenException(
              "This account requires organizational offboarding before deletion. Contact your organization administrator.",
            );

          const [incident, journey, guardianDuty] = await Promise.all([
            tx.incident.findFirst({
              where: { userId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
              select: { id: true },
            }),
            tx.journeySession.findFirst({
              where: { userId, status: { in: ["STARTED", "ACTIVE"] } },
              select: { id: true },
            }),
            tx.safeWalkGuardianGrant.findFirst({
              where: {
                guardianUserId: userId,
                revokedAt: null,
                session: { status: { in: ["STARTED", "ACTIVE"] } },
              },
              select: { id: true },
            }),
          ]);
          if (incident || journey || guardianDuty)
            throw new ConflictException(
              "Finish your active emergency or journey, and any active SafeWalk guardian responsibility, before deleting your account.",
            );

          const now = new Date();
          // Cancellation preserves delivery/evidence history. Already accepted provider sends cannot be recalled.
          await tx.incidentNotification.updateMany({
            where: {
              incident: { userId },
              status: { in: ["QUEUED", "SENDING"] },
            },
            data: { status: "CANCELLED", cancelledAt: now },
          });
          await tx.accountInvitationDelivery.updateMany({
            where: {
              OR: [{ userId }, { enrollment: { acceptedUserId: userId } }],
              status: { in: ["QUEUED", "SENDING"] },
            },
            data: { status: "CANCELLED" },
          });
          await tx.safeWalkNotice.updateMany({
            where: {
              OR: [{ recipientUserId: userId }, { session: { userId } }],
              cancelledAt: null,
            },
            data: { cancelledAt: now, status: "CANCELLED" },
          });
          await tx.safeWalkGuardianCode.updateMany({
            where: { userId, consumedAt: null },
            data: { consumedAt: now, expiresAt: now },
          });
          await tx.safeWalkGuardianGrant.updateMany({
            where: {
              OR: [{ guardianUserId: userId }, { ownerUserId: userId }],
              revokedAt: null,
            },
            data: { revokedAt: now },
          });
          await tx.identityAccessGrant.updateMany({
            where: { actorUserId: userId, revokedAt: null },
            data: { revokedAt: now },
          });
          // Live profile identifiers are disposable; immutable delivery snapshots and resolution audits survive.
          await tx.protectedIdentifier.deleteMany({
            where: {
              subjectUserId: userId,
              kind: { in: ["EMAIL", "PHONE"] },
              incidentSnapshots: { none: {} },
              invitationSnapshots: { none: {} },
            },
          });
          const mappings = await tx.ssoExternalIdentity.findMany({
            where: { userId },
            select: { id: true },
          });
          for (const mapping of mappings) {
            await tx.ssoExternalIdentity.update({
              where: { id: mapping.id },
              data: {
                enabled: false,
                unlinkedAt: now,
                identityCiphertext: Prisma.JsonNull,
                identityDigest: createHash("sha256")
                  .update(randomUUID())
                  .digest("hex"),
              },
            });
          }
          await tx.ssoTransaction.updateMany({
            where: { targetUserId: userId },
            data: {
              consumedAt: now,
              expiresAt: now,
              verifiedProof: Prisma.DbNull,
              nonce: Prisma.DbNull,
              pkceVerifier: Prisma.DbNull,
              linkSessionHash: null,
            },
          });
          await tx.enrollmentRequest.updateMany({
            where: { acceptedUserId: userId },
            data: {
              revokedAt: now,
              expiresAt: now,
              identityCiphertext: "",
              emailTokenHash: null,
              phoneTokenHash: null,
              acceptanceTokenHash: null,
            },
          });
          await tx.passwordResetToken.deleteMany({ where: { userId } });
          await tx.emergencyContact.deleteMany({ where: { userId } });
          const tombstone = randomUUID();
          await tx.user.update({
            where: { id: userId },
            data: {
              isActive: false,
              credentialVersion: { increment: 1 },
              passwordHash: null,
              activationTokenHash: null,
              activationExpiresAt: null,
              activatedAt: null,
              email: "deleted+" + tombstone + "@account.invalid",
              phoneNumber: "deleted:" + tombstone,
              firstName: "Deleted",
              lastName: "Account",
              facilityId: null,
              invitedByUserId: null,
            },
          });
          await tx.administrativeAuditEvent.create({
            data: {
              actorUserId: userId,
              actorRole: user.role,
              action: ACCOUNT_DELETED_ACTION,
              resourceId: userId,
              afterState: {
                completed: true,
                profileDeidentified: true,
                credentialsRevoked: true,
              },
            },
          });
          return completed();
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      )
        throw error;
      // Never return/log Prisma diagnostics, which can include profile values.
      throw new ServiceUnavailableException(
        "Account deletion could not be completed. Please try again.",
      );
    }
  }
}
