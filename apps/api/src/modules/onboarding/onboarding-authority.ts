import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

// Called inside the transaction which performs the privileged operation.
// Lock order: actor, facility, grant. Offboarding locks the actor FOR UPDATE.
export async function onboardingAuthority(
  tx: Prisma.TransactionClient,
  actorId: string,
  facilityId: string,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId}::uuid FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor?.isActive || actor.accountStatus !== "ACTIVE")
    throw new ForbiddenException("Onboarding authority required.");
  await tx.$queryRaw`SELECT id FROM "Facility" WHERE id = ${facilityId}::uuid FOR SHARE`;
  const facility = await tx.facility.findUnique({ where: { id: facilityId } });
  if (!facility?.isActive)
    throw new ForbiddenException("Onboarding authority required.");
  if (actor.role === "ADMIN")
    return {
      actorRole: "ADMIN",
      authority: "PLATFORM_ADMIN",
      grantId: null,
      approvedByUserId: null,
    };
  const grants = await tx.$queryRaw<
    Array<{ id: string; approvedByUserId: string }>
  >`
    SELECT id, "approvedByUserId" FROM "OnboardingAuthorityGrant"
    WHERE "actorUserId" = ${actorId}::uuid AND "facilityId" = ${facilityId}::uuid
      AND permission = 'STAFF_ONBOARDING' AND "revokedAt" IS NULL
      AND "expiresAt" > clock_timestamp()
    ORDER BY "expiresAt" DESC, id ASC LIMIT 1 FOR SHARE`;
  const grant = grants[0];
  if (!grant) throw new ForbiddenException("Onboarding authority required.");
  return {
    actorRole: actor.role,
    authority: "DELEGATED_ONBOARDING",
    grantId: grant.id,
    approvedByUserId: grant.approvedByUserId,
  };
}

export async function platformAuthority(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId}::uuid FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (
    !actor?.isActive ||
    actor.accountStatus !== "ACTIVE" ||
    actor.role !== "ADMIN"
  )
    throw new ForbiddenException("Platform authority required.");
}
