import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JourneySessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneySessionService } from './journey-session.service';
import type {
  InsertFixesResult,
  JourneyFixInput,
} from './journey-session.service';
import type { IngestFixesDto } from './dto/ingest-fixes.dto';

/** A device clock this far ahead of the server is not plausible. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Tolerance for a fix captured just before the session row was written. */
export const START_GRACE_MS = 5 * 60 * 1000;

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

  async ingest(userId: string, dto: IngestFixesDto): Promise<InsertFixesResult> {
    return this.prisma.$transaction(async (tx) => {
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
