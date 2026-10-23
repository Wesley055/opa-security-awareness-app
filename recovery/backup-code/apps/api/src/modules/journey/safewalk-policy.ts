import type { Prisma } from "@prisma/client";

export const SAFEWALK_CHECK_MS = 5 * 60_000;
export const SAFEWALK_RESPONSE_MS = 3 * 60_000;
export const SAFEWALK_POLICY = "safewalk-eta-v1";
export const OWNER_CHECK_MESSAGE =
  "SafeWalk: please confirm your safety. Your expected arrival time has passed.";
export const GUARDIAN_OVERDUE_MESSAGE =
  "SafeWalk overdue: arrival could not be confirmed for a journey shared with you. This is a non-emergency notification.";

export const scopeSelect = {
  id: true,
  role: true,
  isActive: true,
  accountStatus: true,
  facilityId: true,
  facility: { select: { isActive: true } },
} as const;
export type SafeWalkScope = Prisma.UserGetPayload<{
  select: typeof scopeSelect;
}>;

export function eligibleAccount(account: SafeWalkScope | null): boolean {
  return (
    !!account &&
    account.isActive &&
    account.accountStatus === "ACTIVE" &&
    account.role === "USER" &&
    (account.facilityId === null || account.facility?.isActive === true)
  );
}

export function guardianScopeAllowed(
  owner: SafeWalkScope | null,
  guardian: SafeWalkScope | null,
  facilityScopeId: string | null,
): boolean {
  return (
    eligibleAccount(owner) &&
    eligibleAccount(guardian) &&
    owner!.id !== guardian!.id &&
    owner!.facilityId === facilityScopeId &&
    guardian!.facilityId === facilityScopeId
  );
}

export function deadlines(expectedArrivalAt: Date) {
  return {
    checkDueAt: new Date(expectedArrivalAt.getTime() + SAFEWALK_CHECK_MS),
    guardianDueAt: new Date(
      expectedArrivalAt.getTime() + SAFEWALK_CHECK_MS + SAFEWALK_RESPONSE_MS,
    ),
  };
}

export function responseDeadline(
  scheduled: Date,
  promptAvailableAt: Date,
): Date {
  return new Date(
    Math.max(
      scheduled.getTime(),
      promptAvailableAt.getTime() + SAFEWALK_RESPONSE_MS,
    ),
  );
}

export async function dbTime(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<
    Array<{ now: Date }>
  >`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
  if (!rows[0]) throw new Error("SafeWalk database clock unavailable.");
  return rows[0].now;
}

export async function lockJourney(
  tx: Prisma.TransactionClient,
  ownerId: string,
  sessionId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, hashtext(${sessionId}))`;
}

/// Only called within the same lifecycle-locked transaction as confirmation/end.
export async function settleSafeWalk(
  tx: Prisma.TransactionClient,
  sessionId: string,
  now: Date,
  state: "SATISFIED" | "CLOSED",
  actorUserId: string | null,
) {
  const changed = await tx.safeWalkEscalation.updateMany({
    where: { sessionId, state: { notIn: ["SATISFIED", "CLOSED"] } },
    data: { state, settledAt: now },
  });
  await tx.safeWalkNotice.updateMany({
    where: { sessionId, cancelledAt: null },
    data: { cancelledAt: now },
  });
  if (changed.count) {
    await tx.safeWalkAudit.create({
      data: {
        sessionId,
        actorUserId,
        eventKey: sessionId + ":settled",
        kind: state,
        reasonCode:
          state === "SATISFIED" ? "OWNER_CONFIRMED" : "JOURNEY_INELIGIBLE",
        occurredAt: now,
      },
    });
  }
}
