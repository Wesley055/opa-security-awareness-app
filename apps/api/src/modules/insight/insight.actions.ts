import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { CorrectiveActionStatus } from '@prisma/client';

const transitions: Record<CorrectiveActionStatus, readonly CorrectiveActionStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['VERIFIED', 'IN_PROGRESS'], VERIFIED: [], CANCELLED: [],
};
export function transition(from: CorrectiveActionStatus, to: CorrectiveActionStatus,
  actorId: string, ownerId: string, manager: boolean, hasEvidence: boolean) {
  if (!transitions[from].includes(to)) throw new ConflictException('Invalid corrective-action transition.');
  if (to === 'VERIFIED') {
    if (!manager || actorId === ownerId) throw new ForbiddenException('Independent manager verification required.');
  } else if (to === 'COMPLETED' || to === 'IN_PROGRESS') {
    if (actorId !== ownerId) throw new ForbiddenException('The assigned owner must perform this transition.');
  } else if (!manager) throw new ForbiddenException('Manager authority required.');
  if ((to === 'COMPLETED' || to === 'VERIFIED') && !hasEvidence)
    throw new ConflictException('Stored completion evidence is required.');
}
export function overdue(status: CorrectiveActionStatus, dueAt: Date, at: Date) {
  return ['OPEN', 'IN_PROGRESS'].includes(status) && dueAt < at;
}
