import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// JourneySessionStatus was already here for the ENDED check; JourneyPurpose
// joins it rather than opening a second import of the same module.
import { JourneyPurpose, JourneySessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneySessionService } from './journey-session.service';
import { EmergencyIntelligenceSnapshotService } from '../emergency-intelligence/emergency-intelligence-snapshot.service';
import type {
  InsertFixesResult,
  JourneyFixInput,
} from './journey-session.service';
import type { EndJourneySessionDto } from './dto/end-session.dto';
import type {
  IngestFixesDto,
  JourneyFixDto,
} from './dto/ingest-fixes.dto';
import type {
  JourneySessionDto,
  StartSessionDto,
} from './dto/start-session.dto';

/** A device clock this far ahead of the server is not plausible. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Tolerance for a fix captured just before the session row was written. */
export const START_GRACE_MS = 5 * 60 * 1000;

/** Temporal rejection codes implemented by ADR-014 Phase B. */
export type RejectedFixCode =
  | 'FIX_RECORDED_TOO_FAR_IN_FUTURE'
  | 'FIX_PRECEDES_SESSION';

/** One rejected fix in the future ADR-014 ingest envelope. */
export interface RejectedFix {
  idempotencyKey: string;
  code: RejectedFixCode;
  /** Original wire value, retained for response detail and diagnostics. */
  recordedAt: string;
  retryable: boolean;
  resubmit?: 'reacquire';
}

/**
 * The ingest() envelope defined by ADR-014 section 7.
 *
 * Additive: it extends InsertFixesResult rather than replacing it, so
 * recordTrackedFixes, recordActivationFix and the retrigger path retain
 * their existing contracts.
 *
 * Phase A introduces this type only. ingest() still returns
 * InsertFixesResult, still throws its existing exceptions, and exposes no
 * runtime response change. Phases B and C will populate and return this
 * envelope in coordination with the mobile client.
 *
 * tailSequence and tailHash describe the accepted subset only, not the
 * submitted batch.
 */
export interface IngestFixesResult extends InsertFixesResult {
  accepted: string[];
  rejected: RejectedFix[];
}

export interface ClassifiedJourneyFixes {
  accepted: JourneyFixInput[];
  rejected: RejectedFix[];
}

/**
 * Pure ADR-014 Phase B temporal classifier.
 *
 * Both boundaries are inclusive for acceptance: exactly at floor and
 * exactly at the future-skew ceiling are accepted. HTTP exceptions remain
 * the responsibility of ingest(), so Phase C can expose this result without
 * removing Nest semantics from a utility function.
 */
export function classifyJourneyFixes(
  fixes: readonly JourneyFixDto[],
  floorMs: number,
  nowMs: number,
): ClassifiedJourneyFixes {
  const accepted: JourneyFixInput[] = [];
  const rejected: RejectedFix[] = [];

  for (const fix of fixes) {
    const recordedAt = new Date(fix.recordedAt);
    const timestampMs = recordedAt.getTime();

    if (timestampMs > nowMs + MAX_FUTURE_SKEW_MS) {
      rejected.push({
        idempotencyKey: fix.idempotencyKey,
        code: 'FIX_RECORDED_TOO_FAR_IN_FUTURE',
        recordedAt: fix.recordedAt,
        // Phase B is invisible. Phase C decides retryable and retryAfter
        // together when the mobile client can act on both.
        retryable: false,
      });
      continue;
    }

    if (timestampMs < floorMs) {
      rejected.push({
        idempotencyKey: fix.idempotencyKey,
        code: 'FIX_PRECEDES_SESSION',
        recordedAt: fix.recordedAt,
        retryable: false,
      });
      continue;
    }

    accepted.push({
      idempotencyKey: fix.idempotencyKey,
      source: fix.source,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy ?? null,
      speed: fix.speed ?? null,
      heading: fix.heading ?? null,
      batteryLevel: fix.batteryLevel ?? null,
      isCharging: fix.isCharging ?? null,
      recordedAt,
    });
  }

  return { accepted, rejected };
}

/**
 * Owns the transaction so JourneySessionService does not have to. D7 keeps
 * that service free of PrismaService precisely so the advisory locks stay
 * transaction-scoped; this is the seam that satisfies it.
 */
@Injectable()
export class JourneyIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journeySessionService: JourneySessionService,
    private readonly emergencyIntelligenceSnapshotService: EmergencyIntelligenceSnapshotService,
  ) {}

  /**
   * Obtain the caller's active journey session, creating one if there is
   * none. IDEMPOTENT for free: resolveForActivation reuses an open
   * session, and the partial unique index guarantees there is at most
   * one. A retry costs a transaction and nothing else.
   *
   * Lives on the ingestion service because that class exists to own the
   * transaction D7 forbids JourneySessionService from opening.
   */
  async startSession(
    userId: string,
    dto: StartSessionDto,
  ): Promise<JourneySessionDto> {
    // MANUAL, not INCIDENT: a session the app opened is not an emergency.
    const purpose = dto.purpose ?? JourneyPurpose.MANUAL;

    return this.prisma.$transaction(async (tx) => {
      // Take the SAME lifecycle lock resolveForActivation takes, before
      // looking. Without it the existence check races: two concurrent
      // callers could both see nothing and both report reused=false.
      // Reentrant within a transaction, so re-taking it below is free -
      // the orchestrator does exactly this on its create path.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const existing = await tx.journeySession.findFirst({
        where: {
          userId,
          status: {
            in: [JourneySessionStatus.STARTED, JourneySessionStatus.ACTIVE],
          },
        },
        select: { id: true },
      });

      const session = await this.journeySessionService.resolveForActivation(
        tx,
        userId,
        purpose,
      );

      return {
        sessionId: session.id,
        status: session.status,
        // AS STORED. A reused session keeps the purpose it was created
        // with, so a SAFEWALK request answered with INCIDENT is telling
        // the client it joined a session an emergency already opened.
        purpose: session.purpose,
        startedAt: session.startedAt.toISOString(),
        lastFixReceivedAt: session.lastFixReceivedAt?.toISOString() ?? null,
        reused: existing !== null,
      };
    });
  }

  /**
   * End the caller's session. Idempotent: ending an already-ended session
   * succeeds and returns the ORIGINAL endedAt rather than a fresh one.
   *
   * Lives here rather than on JourneySessionService for the same reason
   * startSession does: D7 forbids that service from opening a transaction,
   * and this class exists to own it.
   */
  async endSession(
    userId: string,
    sessionId: string,
  ): Promise<EndJourneySessionDto> {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.journeySessionService.endSession(
        tx,
        userId,
        sessionId,
      );

      // Unknown session and another user's session are the SAME 404. The
      // service returns null for both so this cannot accidentally split
      // them. Matches ingest() exactly.
      if (result === null) {
        throw new NotFoundException('Journey session not found.');
      }

      const { session, alreadyEnded } = result;

      // Unreachable on this path - status and endedAt are one write. The
      // guard exists for a row ended by some future owner that failed to set
      // them: ADR-014 section 3.2 treats a null endedAt on an ENDED session
      // as reject-and-reacquire, so serialising null here would be worse
      // than failing.
      if (session.endedAt === null || session.endedReason === null) {
        throw new Error(
          'journey: session ' +
            session.id +
            ' is ENDED without endedAt or endedReason',
        );
      }

      return {
        sessionId: session.id,
        // Return the endpoint invariant explicitly rather than widening from
        // the stored JourneySessionStatus field.
        status: JourneySessionStatus.ENDED,
        endedAt: session.endedAt.toISOString(),
        endedReason: session.endedReason,
        alreadyEnded,
      };
    });
  }

  async ingest(userId: string, dto: IngestFixesDto): Promise<InsertFixesResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialise the state verdict with session ending. Without this the
      // status read below is taken outside any lock, and a concurrent
      // endSession can commit ENDED between this read and insertFixes -
      // which would then append to an ended session, because insertFixes
      // uses status only for the STARTED -> ACTIVE promotion and does not
      // reject ENDED.
      //
      // The 2-arg ingestion lock, matching insertFixes. Advisory locks are
      // reentrant within a transaction so insertFixes re-taking it later is
      // free. Ingestion NEVER takes the 1-arg lifecycle lock, so this cannot
      // cycle with endSession's lifecycle-then-ingestion order.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, hashtext(${dto.sessionId}))`;

      const session = await tx.journeySession.findUnique({
        where: { id: dto.sessionId },
        select: { id: true, userId: true, status: true, startedAt: true },
      });

      // A session that does not exist and a session belonging to someone
      // else are the SAME 404, deliberately: the response must never
      // confirm that an id is real but owned by another user.
      if (session === null || session.userId !== userId) {
        throw new NotFoundException('Journey session not found.');
      }

      if (session.status === JourneySessionStatus.ENDED) {
        throw new ConflictException('Journey session has ended.');
      }

      const now = Date.now();
      const floor = session.startedAt.getTime() - START_GRACE_MS;

      const classified = classifyJourneyFixes(dto.fixes, floor, now);
      const firstRejected = classified.rejected[0];

      // Phase B remains invisible to clients. If any item is rejected,
      // preserve the original whole-request exception and write NONE of
      // the accepted survivors. Phase C may stop throwing only when the
      // mobile client can delete accepted items selectively.
      if (firstRejected !== undefined) {
        if (
          firstRejected.code === 'FIX_RECORDED_TOO_FAR_IN_FUTURE'
        ) {
          throw new BadRequestException(
            'recordedAt is too far in the future: ' +
              firstRejected.recordedAt,
          );
        }

        throw new BadRequestException(
          'recordedAt precedes the session: ' + firstRejected.recordedAt,
        );
      }

      return this.journeySessionService.recordTrackedFixes(tx, {
        sessionId: session.id,
        fixes: classified.accepted,
      });
    });

    // Provider work must never run while the journey transaction/advisory
    // lock is open. Pure replays have inserted=0 and therefore do not
    // trigger another refresh.
    if (result.inserted > 0 && result.tailSequence !== null) {
      try {
        await this.emergencyIntelligenceSnapshotService.refreshFromCommittedFix(
          dto.sessionId,
          result.tailSequence,
        );
      } catch {
        // Tracking ingestion is authoritative. Emergency Intelligence is a
        // derived projection, so provider/snapshot failure must not turn a
        // successfully committed location fix into an API failure.
      }
    }

    return result;
  }
}
