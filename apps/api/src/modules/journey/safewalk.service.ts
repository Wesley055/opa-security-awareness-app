import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JourneyPurpose, JourneySessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneySessionService } from './journey-session.service';
import { settleSafeWalk, lockJourney } from './safewalk-policy';

@Injectable()
export class SafeWalkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journeys: JourneySessionService,
  ) {}

  async active(userId: string) {
    const session = await this.prisma.journeySession.findFirst({ where: { userId, purpose: 'SAFEWALK', redactedAt: null, status: { in: ['STARTED', 'ACTIVE'] } }, select: { id: true } });
    return session ? this.getStatus(userId, session.id) : null;
  }

  async cancel(userId: string, sessionId: string) {
    return this.prisma.$transaction(async tx => {
      await lockJourney(tx, userId, sessionId);
      const session = await tx.journeySession.findFirst({ where: { id: sessionId, userId, purpose: 'SAFEWALK', redactedAt: null } });
      if (!session) throw new NotFoundException('Journey session not found.');
      if (session.safeWalkEmergencyIncidentId || await tx.incident.findFirst({ where: { journeySessionId: sessionId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { id: true } })) throw new ConflictException('Use the existing emergency controls for this journey.');
      const result = await this.journeys.endSession(tx, userId, sessionId);
      if (result && !result.alreadyEnded) await tx.safeWalkAudit.create({ data: { sessionId, actorUserId: userId, eventKey: sessionId + ':cancelled', kind: 'CANCELLED', reasonCode: 'OWNER_CANCELLED' } });
      return result;
    });
  }

  async getStatus(userId: string, sessionId: string) {
    const session = await this.prisma.journeySession.findFirst({
      where: { id: sessionId, userId, purpose: JourneyPurpose.SAFEWALK, redactedAt: null },
      select: {
        id: true, status: true, startedAt: true, endedAt: true,
        safeWalkEmergencyIncidentId: true, safeWalkEmergencyAt: true,
        lastFixReceivedAt: true, destinationLabel: true,
        destinationLatitude: true, destinationLongitude: true,
        expectedArrivalAt: true, safetyConfirmedAt: true, arrivalConfirmedAt: true,
        safeWalkEscalation: { select: { state: true, checkDueAt: true, responseDueAt: true } },
        safeWalkNotices: { select: { id: true, kind: true, deliveryStatus: true, cancelledAt: true, providerAcceptedAt: true, confirmedDeliveredAt: true } },
        guardianGrants: { select: { id: true, grantedAt: true, revokedAt: true, policyVersion: true } },
      },
    });
    if (!session) throw new NotFoundException('Journey session not found.');
    return { ...session, safetyChecksEnabled: process.env.SAFEWALK_ESCALATION_ENABLED === 'true', visibility: session.safeWalkEmergencyIncidentId ? 'EMERGENCY_ONLY' : 'PRIVATE', serverTime: new Date().toISOString(), locationStatus: !session.lastFixReceivedAt ? 'UNAVAILABLE' : Date.now() - session.lastFixReceivedAt.getTime() > 60_000 ? 'STALE' : 'RECENT_RECEIPT' };
  }

  async confirm(userId: string, sessionId: string, kind: 'SAFETY' | 'ARRIVAL') {
    return this.prisma.$transaction(async (tx) => {
      // Preserve the established lifecycle -> ingestion lock order.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, hashtext(${sessionId}))`;
      const session = await tx.journeySession.findFirst({
        where: { id: sessionId, userId, purpose: JourneyPurpose.SAFEWALK, redactedAt: null },
      });
      if (!session) throw new NotFoundException('Journey session not found.');
      const existing = kind === 'ARRIVAL' ? session.arrivalConfirmedAt : session.safetyConfirmedAt;
      if (existing) {
        await settleSafeWalk(tx, sessionId, existing, 'SATISFIED', userId);
        return { sessionId, kind, confirmedAt: existing, alreadyConfirmed: true };
      }
      if (session.status === JourneySessionStatus.ENDED) {
        throw new ConflictException('Journey session has ended.');
      }
      // Arrival is not an emergency-resolution action. Keep live emergency
      // telemetry running; the existing incident lifecycle owns its outcome.
      if (kind === 'ARRIVAL') {
        const incident = await tx.incident.findFirst({
          where: { journeySessionId: sessionId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          select: { id: true },
        });
        if (incident) throw new ConflictException('Resolve the active emergency before confirming arrival.');
      }
      const rows = await tx.$queryRaw<Array<{ confirmed_at: Date }>>`
        SELECT date_trunc('milliseconds', clock_timestamp()) AS confirmed_at
      `;
      const confirmedAt = rows[0]?.confirmed_at;
      if (!confirmedAt) throw new Error('SafeWalk confirmation clock unavailable.');
      await tx.journeySession.update({
        where: { id: sessionId },
        data: kind === 'ARRIVAL' ? { arrivalConfirmedAt: confirmedAt } : { safetyConfirmedAt: confirmedAt },
      });
      await tx.safeWalkAudit.create({ data: { sessionId, actorUserId: userId, eventKey: sessionId + ':' + kind.toLowerCase(), kind: kind === 'ARRIVAL' ? 'ARRIVAL_CONFIRMED' : 'SAFETY_CONFIRMED', reasonCode: 'OWNER_CONFIRMED', occurredAt: confirmedAt } });
      await settleSafeWalk(tx, sessionId, confirmedAt, 'SATISFIED', userId);
      if (kind === 'ARRIVAL') {
        await this.journeys.endSession(tx, userId, sessionId);
      }
      return { sessionId, kind, confirmedAt, alreadyConfirmed: false };
    });
  }
}
