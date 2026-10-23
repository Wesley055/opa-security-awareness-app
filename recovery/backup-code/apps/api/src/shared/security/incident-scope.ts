import type { Prisma } from '@prisma/client';

export interface IncidentActor {
  membershipState?: string;
  role: string;
  facilityId: string | null;
  isActive: boolean;
  accountStatus: string;
}

/** Platform access is explicit; tenant authority comes only from the current user row. */
export function incidentScope(
  userId: string,
  actor: IncidentActor | null,
): Prisma.IncidentWhereInput {
  if (!actor?.isActive || actor.accountStatus !== 'ACTIVE')
    return { id: { in: [] } };
  if (actor.role === 'ADMIN') return {};
  const owner = { userId };
  return ['FACILITY_OPERATOR','FACILITY_ADMIN'].includes(actor.role) && actor.membershipState === 'ACTIVE' && actor.facilityId
    ? { OR: [owner, { facilityId: actor.facilityId }] }
    : owner;
}
