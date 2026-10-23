import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveryLedgerService } from '../notifications/delivery-ledger.service';
import { dispatchWithEvidence } from '../notifications/delivery-dispatch';
import { EmailProvider } from '../notifications/providers/email.provider';
import { ProtectedSnapshotsService } from '../protected-identity/protected-snapshots.service';
import { dbTime, eligibleAccount, guardianScopeAllowed, lockJourney, scopeSelect } from './safewalk-policy';

@Injectable()
export class SafeWalkNotificationWorker {
  private readonly logger = new Logger(SafeWalkNotificationWorker.name);
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly ledger: DeliveryLedgerService, private readonly email: EmailProvider, private readonly snapshots: ProtectedSnapshotsService) {}

  @Interval(2000)
  async tick() {
    if (this.running || process.env.SAFEWALK_ESCALATION_ENABLED !== 'true') return;
    this.running = true;
    try {
      const notices = await this.prisma.safeWalkNotice.findMany({ where: { status: 'QUEUED', cancelledAt: null, nextAttemptAt: { lte: new Date() }, attemptCount: { lt: 5 } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }], take: 25, select: { id: true } });
      for (const notice of notices) await this.dispatch(notice.id);
    } catch {
      this.logger.error('SafeWalk notification failed; durable state retained for retry.');
    } finally { this.running = false; }
  }

  async dispatch(id: string) {
    const candidate = await this.prisma.safeWalkNotice.findUnique({ where: { id } });
    if (!candidate || candidate.cancelledAt || candidate.status !== 'QUEUED') return;
    const recipient = candidate.protectedSnapshotId
      ? await this.snapshots.safeWalkRecipient(candidate.protectedSnapshotId, id, candidate.recipientUserId)
      : candidate.recipient;
    if (!recipient || recipient === '[protected]') return;
    const work = await this.prisma.$transaction(async tx => {
      const hint = await tx.journeySession.findUnique({ where: { id: candidate.sessionId }, select: { userId: true } });
      if (!hint) return null;
      await lockJourney(tx, hint.userId, candidate.sessionId);
      const session = await tx.journeySession.findUnique({ where: { id: candidate.sessionId } });
      const notice = await tx.safeWalkNotice.findUnique({ where: { id } });
      if (!session || !notice || notice.cancelledAt || notice.status !== 'QUEUED') return null;
      const owner = await tx.user.findUnique({ where: { id: session.userId }, select: scopeSelect });
      let allowed = eligibleAccount(owner) && session.purpose === 'SAFEWALK' && session.status !== 'ENDED' && !session.redactedAt && !session.safeWalkEmergencyIncidentId && !session.safetyConfirmedAt && !session.arrivalConfirmedAt;
      if (notice.kind === 'OWNER_CHECK') allowed = allowed && notice.recipientUserId === session.userId && !notice.grantId;
      else {
        const grant = notice.grantId ? await tx.safeWalkGuardianGrant.findUnique({ where: { id: notice.grantId } }) : null;
        const guardian = await tx.user.findUnique({ where: { id: notice.recipientUserId }, select: scopeSelect });
        allowed = allowed && !!grant && grant.sessionId === session.id && grant.ownerUserId === session.userId && grant.guardianUserId === notice.recipientUserId && !grant.revokedAt && grant.policyVersion === 'safewalk-status-v1' && guardianScopeAllowed(owner, guardian, grant.facilityScopeId);
      }
      if (!allowed) {
        await tx.safeWalkNotice.update({ where: { id }, data: { cancelledAt: await dbTime(tx) } });
        return null;
      }
      // Dispatch authorization linearizes here with completion, revocation and SOS.
      // A provider call already authorized cannot be recalled after it leaves OPA.
      const attempt = await this.ledger.claim(tx, { kind: 'safewalk', id });
      if (!attempt) return null;
      await tx.safeWalkAudit.create({ data: { sessionId: session.id, grantId: notice.grantId, eventKey: attempt.id + ':dispatch', kind: 'NOTICE_DISPATCH_AUTHORIZED', reasonCode: notice.kind } });
      return { attempt, message: notice.message };
    });
    if (!work) return;
    await dispatchWithEvidence(work.attempt.provider, () => this.email.send({ recipient, subject: 'OPA SafeWalk check-in', message: work.message }), response => this.ledger.complete(work.attempt.id, response));
  }
}
