import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IncidentStatus,
  IncidentTrigger,
  JourneySessionEndReason,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IncidentAccessTokenService } from '../incident-access/incident-access-token.service';
import { IncidentTimelineService } from '../incident-timeline/incident-timeline.service';
import { JourneySessionService } from '../journey/journey-session.service';
import type { CloseIncidentDto } from './dto/close-incident.dto';
import type { CreateIncidentDto } from './dto/create-incident.dto';

/**
 * A lifecycle transition takes CLASSID 3 - the SAME per-incident key the
 * timeline already uses - rather than a new namespace.
 *
 * The namespace elsewhere: 1-arg = per-user lifecycle, 2 = journey fix
 * ingestion, 3 = incident timeline append.
 *
 * A new classid 4 was considered and rejected. Lifecycle and timeline
 * serialise on the SAME resource - one incident - so a second namespace
 * would buy nothing and would create a 4-then-3 ordering that all future
 * code would have to honour. pg_advisory_xact_lock is transaction-scoped
 * and reentrant, so recordEvent taking 3 again inside this transaction is a
 * no-op.
 *
 * test/int/incident-timeline-concurrency.int-spec.ts already pins this key
 * with a literal LOCK_SQL. Sharing it means one constant describes both.
 *
 * THE 1-ARG USER LOCK IS TAKEN FIRST, before classid 3. endSession takes
 * the user lock and then classid 2, so a close that ends a journey session
 * acquires user -> 3 -> 2. The orchestrator already acquires user -> 3.
 * Taking 3 first here would have produced 3 -> user -> 2 against the
 * orchestrator's user -> 3, which is a lock-order inversion and the
 * textbook shape of a deadlock. All locks are reentrant within a
 * transaction, so re-taking the user lock inside endSession is free (D6).
 */

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: IncidentAccessTokenService,
    private readonly timeline: IncidentTimelineService,
    private readonly journeySessions: JourneySessionService,
  ) {}

  async create(userId: string, dto: CreateIncidentDto, tx?: Prisma.TransactionClient) {
    if (
      dto.trigger === IncidentTrigger.VOICE_HELP_HELP &&
      dto.voicePhrase?.toUpperCase() !== 'HELP HELP'
    ) {
      throw new BadRequestException(
        'Voice-triggered incidents require phrase HELP HELP.',
      );
    }

    const createInside = async (db: Prisma.TransactionClient) => {
      // Command Center routing is a SERVER-AUTHORITATIVE SNAPSHOT.
      // The client never supplies facilityId. Membership is read here and
      // frozen onto the incident, in the SAME transaction as the insert, so
      // the read and the write cannot be torn apart.
      //
      // NO ADVISORY LOCK IS TAKEN, DELIBERATELY. Nothing in the codebase
      // writes User.facilityId today, so a lock here would serialise against
      // no counterparty while costing a round trip on the SOS path. When
      // invite-code membership is built, the serialisation requirement
      // belongs in THAT code, enforced by a test that fails without it -
      // not in a comment here asserting a contract nothing keeps.
      const membership = await db.user.findUnique({
        where: { id: userId },
        select: { facilityId: true },
      });

      return db.incident.create({
        data: {
          userId,
          facilityId: membership?.facilityId ?? null,
          trigger: dto.trigger,
          latitude: dto.latitude,
          longitude: dto.longitude,
          address: dto.address,
          voicePhrase: dto.voicePhrase,
          // Initialised for retrigger ordering and audit. Under the
          // lifecycle-based identity invariant the orchestrator retriggers an
          // OPEN incident regardless of elapsed time; this path still applies
          // the legacy time-window filter and has not been converged.
          lastTriggeredAt: new Date(),
          metadata: {
            redisDispatchPrepared: true,
            notificationFanoutPrepared: true,
          },
        },
      });
    };

    if (tx) {
      return createInside(tx);
    }

    return this.prisma.$transaction(async (innerTx) => createInside(innerTx));
  }

  listForUser(userId: string) {
    return this.prisma.incident.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * The subject says the emergency is over and they are safe. Terminal.
   */
  resolve(incidentId: string, userId: string, dto?: CloseIncidentDto) {
    return this.close(incidentId, userId, IncidentStatus.RESOLVED, dto?.reason);
  }

  /**
   * The subject says the activation was accidental or false. Terminal.
   *
   * Deliberately distinct from RESOLVED: an insurer, an auditor and a
   * hospital risk committee will read "this did not happen" and "this
   * happened and is over" very differently.
   */
  cancel(incidentId: string, userId: string, dto?: CloseIncidentDto) {
    return this.close(incidentId, userId, IncidentStatus.CANCELLED, dto?.reason);
  }

  /**
   * ONLY THE INCIDENT OWNER MAY CLOSE AN INCIDENT.
   *
   * A Command Centre operator resolving somebody else's emergency is a claim
   * about the world made by a party with an interest in it - the seam
   * ADR-013 section 6.2 identifies. Acknowledgement is an observed fact and
   * is recorded as a timeline event; closing is not, and is not exposed to
   * operators by this method.
   *
   * Status change, token revocation and the timeline event share ONE
   * transaction and ONE timestamp, so the transition is atomic and
   * temporally coherent.
   */
  /**
   * INTERNAL LEGACY RECONCILIATION.
   *
   * This is NOT an operator close and NOT a resident "I'm Safe" action.
   * It corrects an OPEN row created by the former time-based incident
   * identity rule, but only when a later genuinely RESOLVED incident for the
   * same user proves that the older row cannot still represent the current
   * emergency.
   *
   * The duplicate is CANCELLED rather than RESOLVED. RESOLVED means an
   * emergency occurred and was explicitly brought to a resolved terminal
   * state; these rows are duplicate lifecycle records.
   *
   * The repair is auditable rather than backdated:
   *   - Incident.resolvedAt remains NULL because the row is CANCELLED.
   *   - the evidence incident/resolution timestamp is preserved in payload.
   *   - token revokedAt is the actual repair time.
   *   - timeline occurredAt is the actual repair time.
   *   - actorUserId is deliberately absent.
   */
  async reconcileLegacyDuplicate(
    incidentId: string,
    userId: string,
    evidenceIncidentId: string,
    expectedLastTriggeredAt: Date,
  ) {
    const reconciledAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Same global lock order as ordinary lifecycle operations:
      // user -> incident timeline/lifecycle.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, hashtext(${incidentId}))`;

      const incident = await tx.incident.findUnique({
        where: { id: incidentId },
        select: {
          id: true,
          userId: true,
          status: true,
          createdAt: true,
          lastTriggeredAt: true,
          journeySessionId: true,
        },
      });

      if (!incident || incident.userId !== userId) {
        throw new NotFoundException('Incident not found.');
      }

      if (incident.status !== IncidentStatus.OPEN) {
        throw new ConflictException(
          `Incident is already ${incident.status} and cannot be reconciled.`,
        );
      }

      // OPTIMISTIC SAFETY PIN.
      //
      // The reconciliation plan is a snapshot. The per-user advisory lock
      // prevents an SOS from racing THIS transaction, but an SOS may have
      // retriggered this OPEN incident after the plan was computed and before
      // this transaction acquired the lock.
      //
      // Every retrigger advances lastTriggeredAt. If it changed, the row may
      // now represent a live emergency and MUST NOT be cancelled.
      if (
        incident.lastTriggeredAt === null ||
        incident.lastTriggeredAt.getTime() !==
          expectedLastTriggeredAt.getTime()
      ) {
        throw new ConflictException(
          'Incident was retriggered after the reconciliation plan was computed.',
        );
      }

      const evidence = await tx.incident.findUnique({
        where: { id: evidenceIncidentId },
        select: {
          id: true,
          userId: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
        },
      });

      if (
        !evidence ||
        evidence.userId !== userId ||
        evidence.status !== IncidentStatus.RESOLVED ||
        evidence.resolvedAt === null ||
        evidence.createdAt <= incident.createdAt
      ) {
        throw new BadRequestException(
          'A later RESOLVED incident for the same user is required as reconciliation evidence.',
        );
      }

      const updated = await tx.incident.update({
        where: { id: incidentId },
        data: {
          status: IncidentStatus.CANCELLED,
          resolvedAt: null,
        },
      });

      let endedSessionId: string | null = null;

      if (incident.journeySessionId !== null) {
        const otherOpenIncident = await tx.incident.findFirst({
          where: {
            journeySessionId: incident.journeySessionId,
            status: IncidentStatus.OPEN,
            id: { not: incident.id },
          },
          select: { id: true },
        });

        // During reconciliation many duplicate rows may share one session.
        // Leave telemetry alone until the LAST OPEN row using it is gone.
        if (otherOpenIncident === null) {
          const result = await this.journeySessions.endSession(
            tx,
            userId,
            incident.journeySessionId,
            JourneySessionEndReason.ADMIN_ENDED,
          );

          if (result !== null && !result.alreadyEnded) {
            endedSessionId = incident.journeySessionId;
          }
        }
      }

      const revokedTokens = await this.accessTokens.revokeAllForIncident(
        incidentId,
        tx,
      );

      await this.timeline.recordEvent(
        {
          incidentId,
          type: 'INCIDENT_CANCELLED',
          payload: {
            previousStatus: IncidentStatus.OPEN,
            newStatus: IncidentStatus.CANCELLED,
            reason: 'LEGACY_DUPLICATE_RECONCILIATION',
            evidenceIncidentId: evidence.id,
            evidenceResolvedAt: evidence.resolvedAt.toISOString(),
            revokedTokens,
            endedJourneySessionId: endedSessionId,
          },
          source: 'SYSTEM_RECONCILIATION',
          occurredAt: reconciledAt,
        },
        tx,
      );

      return {
        id: updated.id,
        status: updated.status,
        resolvedAt: updated.resolvedAt,
        evidenceIncidentId: evidence.id,
        evidenceResolvedAt: evidence.resolvedAt,
        revokedTokens,
        endedJourneySessionId: endedSessionId,
      };
    });
  }

  private async close(
    incidentId: string,
    userId: string,
    target: typeof IncidentStatus.RESOLVED | typeof IncidentStatus.CANCELLED,
    reason?: string,
  ) {
    const occurredAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // FIRST, and the order matters - see the class doc above. endSession
      // takes this lock then classid 2, and the orchestrator takes this lock
      // then classid 3. Taking 3 before this one would invert that.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      // Serialises two concurrent close requests for the SAME incident.
      // Without it both could read OPEN and both could write a terminal
      // status, producing two timeline events for one transition - or
      // colliding on @@unique([incidentId, sequence]).
      //
      // Held for the whole transaction, so recordEvent's own classid 3 below
      // is reentrant and free.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, hashtext(${incidentId}))`;

      const incident = await tx.incident.findUnique({
        where: { id: incidentId },
        select: {
          id: true,
          userId: true,
          status: true,
          journeySessionId: true,
        },
      });

      // Missing and not-yours produce the SAME 404, deliberately. Confirming
      // that an incident exists to somebody who does not own it discloses
      // that a particular person raised an emergency.
      if (!incident || incident.userId !== userId) {
        throw new NotFoundException('Incident not found.');
      }

      if (incident.status !== IncidentStatus.OPEN) {
        throw new ConflictException(
          `Incident is already ${incident.status} and cannot be closed again.`,
        );
      }

      const updated = await tx.incident.update({
        where: { id: incidentId },
        data: {
          status: target,
          // resolvedAt means RESOLVED and nothing else. A cancelled incident
          // is not resolved, and overloading one column with two meanings
          // would be read wrongly later. The timeline event carries the
          // cancellation timestamp.
          resolvedAt: target === IncidentStatus.RESOLVED ? occurredAt : null,
        },
      });

      // END THE LINKED JOURNEY SESSION - BUT ONLY IF NO OTHER OPEN INCIDENT
      // IS STILL USING IT.
      //
      // A session should normally belong to only one OPEN incident under the
      // lifecycle-based identity invariant. The other-OPEN check remains
      // necessary during legacy reconciliation and as defensive protection
      // while pre-invariant production data still exists.
      //
      // Without this, a resolved incident's session stays ACTIVE and the
      // tracker RESUMES CAPTURE ON THE NEXT APP START - measured on a device
      // as "session ... reused=true purpose=INCIDENT" after a resolve.
      //
      // ADR-008 governs the direction: "on incident closure, live access
      // revoked immediately". Incident closure ending its telemetry is the
      // permitted direction. The reverse - a journey ending an incident - is
      // what endSession's own comment forbids.
      let endedSessionId: string | null = null;

      if (incident.journeySessionId !== null) {
        const otherOpenIncident = await tx.incident.findFirst({
          where: {
            journeySessionId: incident.journeySessionId,
            status: IncidentStatus.OPEN,
            id: { not: incident.id },
          },
          select: { id: true },
        });

        if (otherOpenIncident === null) {
          const result = await this.journeySessions.endSession(
            tx,
            userId,
            incident.journeySessionId,
            target === IncidentStatus.RESOLVED
              ? JourneySessionEndReason.INCIDENT_RESOLVED
              : JourneySessionEndReason.USER_ENDED,
          );

          // null means the session vanished or belongs to somebody else.
          // Neither should block a close the owner is entitled to make.
          if (result !== null && !result.alreadyEnded) {
            endedSessionId = incident.journeySessionId;
          }
        }
      }

      const revokedTokens = await this.accessTokens.revokeAllForIncident(
        incidentId,
        tx,
      );

      await this.timeline.recordEvent(
        {
          incidentId,
          type:
            target === IncidentStatus.RESOLVED
              ? 'INCIDENT_RESOLVED'
              : 'INCIDENT_CANCELLED',
          payload: {
            previousStatus: IncidentStatus.OPEN,
            newStatus: target,
            ...(reason === undefined ? {} : { reason }),
            revokedTokens,
            endedJourneySessionId: endedSessionId,
          },
          source: 'MOBILE',
          actorUserId: userId,
          occurredAt,
        },
        tx,
      );

      return {
        id: updated.id,
        status: updated.status,
        resolvedAt: updated.resolvedAt,
        revokedTokens,
        endedJourneySessionId: endedSessionId,
      };
    });
  }
}