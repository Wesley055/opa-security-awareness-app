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
import type {
  InsertFixesResult,
  JourneyFixInput,
} from './journey-session.service';
import type { EndJourneySessionDto } from './dto/end-session.dto';
import type { IngestFixesDto } from './dto/ingest-fixes.dto';
import type {
  JourneySessionDto,
  StartSessionDto,
} from './dto/start-session.dto';

/** A device clock this far ahead of the server is not plausible. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Tolerance for a fix captured just before the session row was written. */
export const START_GRACE_MS = 5 * 60 * 1000;

/**
 * One rejected fix in the future ADR-014 ingest envelope.
 *
 * Phase A deliberately leaves code as string. Phase B owns the complete
 * classification vocabulary and will tighten it when the server begins
 * producing classifications.
 */
export interface RejectedFix {
  idempotencyKey: string;
  code: string;
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
    return this.prisma.$transaction(async (tx) => {
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

      const fixes: JourneyFixInput[] = dto.fixes.map((fix) => {
        const recordedAt = new Date(fix.recordedAt);
        const t = recordedAt.getTime();

        if (t > now + MAX_FUTURE_SKEW_MS) {
          throw new BadRequestException(
            'recordedAt is too far in the future: ' + fix.recordedAt,
          );
        }
        if (t < floor) {
          throw new BadRequestException(
            'recordedAt precedes the session: ' + fix.recordedAt,
          );
        }

        return {
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
        };
      });

      return this.journeySessionService.recordTrackedFixes(tx, {
        sessionId: session.id,
        fixes,
      });
    });
  }
}
