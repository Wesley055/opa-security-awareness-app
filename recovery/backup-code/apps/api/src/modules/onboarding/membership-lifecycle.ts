import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, SupportCapability } from "@prisma/client";
import { institutionalAuthority } from "./support-authority";
import { platformAuthority } from "./onboarding-authority";
export type ActionContext = {
  reason: string;
  caseReference: string;
  correlationId: string;
};
export type MembershipAction = "suspend" | "revoke" | "restore" | "recover";
/** Shared transaction boundary for platform and institutional entry points. */
export async function changeMembership(
  tx: Prisma.TransactionClient,
  actorId: string,
  facilityId: string,
  targetId: string,
  action: MembershipAction,
  context: ActionContext,
  platformOnly = false,
) {
  if (!context.reason.trim() || context.reason.length > 500)
    throw new BadRequestException("A reason of 1–500 characters is required.");
  // Match the existing per-user lifecycle lock before row locks. Reciprocal
  // administrator operations use sorted user locks, then the facility count lock.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${targetId}))`;
  for (const id of [...new Set([actorId, targetId])].sort())
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Facility" WHERE id=${facilityId}::uuid FOR UPDATE`;
  const platformActor =
    (
      await tx.user.findUnique({
        where: { id: actorId },
        select: { role: true },
      })
    )?.role === "ADMIN";
  if (platformOnly || platformActor) await platformAuthority(tx, actorId);
  const facility = await tx.facility.findUnique({
    where: { id: facilityId },
    select: { isActive: true },
  });
  if (!facility) throw new NotFoundException("Facility not found.");
  const target = await tx.user.findUnique({ where: { id: targetId } });
  if (
    !target ||
    target.facilityId !== facilityId ||
    !["USER", "FACILITY_ADMIN", "FACILITY_OPERATOR"].includes(target.role)
  )
    throw new NotFoundException("Membership not found.");
  // Resident recovery is still a resident override; a staff recovery grant must
  // never become resident authority. Facility Admin changes remain sensitive.
  const capability: SupportCapability =
    target.role === "USER"
      ? "RESIDENT_SUPPORT_OVERRIDE"
      : action === "recover"
        ? "STAFF_RECOVER_ACCESS"
        : target.role === "FACILITY_ADMIN"
          ? "FACILITY_ADMIN_DEPROVISION"
          : action === "suspend"
            ? "STAFF_SUSPEND"
            : "OPERATOR_MANAGE";
  const authority = platformActor
    ? { actorRole: "ADMIN", authority: "PLATFORM_ADMIN", grantId: null }
    : await institutionalAuthority(tx, actorId, facilityId, capability, context.caseReference);
  if (actorId === targetId && action === "recover")
    throw new ForbiddenException("Use personal recovery.");
  const previous = await tx.administrativeAuditEvent.findFirst({
    where: { actorUserId: actorId, correlationId: context.correlationId },
  });
  if (previous) {
    if (
      previous.resourceId !== targetId ||
      previous.facilityId !== facilityId ||
      previous.action !== "FACILITY_MEMBERSHIP_" + action.toUpperCase() ||
      previous.reason !== context.reason ||
      previous.caseReference !== context.caseReference
    )
      throw new ConflictException("Operation reference already used.");
    return {
      id: targetId,
      membershipState: target.membershipState,
      credentialsRevoked: true,
    };
  }
  if (
    facility.isActive &&
    target.role === "FACILITY_ADMIN" &&
    target.isActive &&
    target.accountStatus === "ACTIVE" &&
    target.membershipState === "ACTIVE" &&
    action !== "restore" &&
    action !== "recover"
  ) {
    const remaining = await tx.user.count({
      where: {
        facilityId,
        role: "FACILITY_ADMIN",
        isActive: true,
        accountStatus: "ACTIVE",
        membershipState: "ACTIVE",
        id: { not: targetId },
      },
    });
    if (remaining === 0)
      throw new ConflictException("Another active Facility Admin is required.");
  }
  if (
    action === "restore" &&
    (!target.isActive || target.accountStatus !== "ACTIVE")
  )
    throw new ConflictException(
      "Global account recovery requires platform review.",
    );
  const state =
    action === "restore"
      ? "ACTIVE"
      : action === "suspend"
        ? "SUSPENDED"
        : action === "revoke"
          ? "REVOKED"
          : target.membershipState;
  await tx.user.update({
    where: { id: targetId },
    data: {
      membershipState: state,
      credentialVersion: { increment: 1 },
      activationTokenHash: null,
      activationExpiresAt: null,
    },
  });
  if (action === "revoke" || action === "suspend")
    await tx.accountInvitationDelivery.updateMany({
      where: { userId: targetId, facilityId, status: "QUEUED" },
      data: { status: "CANCELLED" },
    });
  await tx.administrativeAuditEvent.create({
    data: {
      actorUserId: actorId,
      actorRole: authority.actorRole,
      authorityKind: authority.authority,
      authorityGrantId: authority.grantId,
      action: "FACILITY_MEMBERSHIP_" + action.toUpperCase(),
      resourceId: targetId,
      facilityId,
      reason: context.reason,
      caseReference: context.caseReference,
      correlationId: context.correlationId,
      beforeState: {
        facilityId: target.facilityId,
        membershipState: target.membershipState,
        isActive: target.isActive,
      },
      afterState: {
        facilityId: target.facilityId,
        membershipState: state,
        isActive: target.isActive,
        credentialsRevoked: true,
      },
    },
  });
  return { id: targetId, membershipState: state, credentialsRevoked: true };
}
