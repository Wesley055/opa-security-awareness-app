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
  // Legacy grants are historical evidence only, including unexpired rows.
  throw new ForbiddenException("Legacy onboarding authority is retired. Use the institutional workspace.");
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
