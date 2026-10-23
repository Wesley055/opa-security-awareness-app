import { UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Recheck under the lifecycle lock: a JWT may have been validated before deletion committed. */
export async function requireActiveAccount(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { isActive: true, accountStatus: true },
  });
  if (!user?.isActive || user.accountStatus !== "ACTIVE")
    throw new UnauthorizedException("Account unavailable.");
}
