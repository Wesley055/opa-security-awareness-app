import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordTimelineEventParams {
  incidentId: string;
  type: string;
  payload?: Record<string, unknown>;
  source: string;
  actorUserId?: string;
  correlationId?: string;
  occurredAt?: Date;
}

interface HashInput {
  incidentId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  previousHash: string | null;
}

@Injectable()
export class IncidentTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends one event to an incident's timeline.
   *
   * A transaction-scoped advisory lock serialises writes for the same incident
   * before the prior event is read. Sequence allocation, previous-hash lookup,
   * hash computation, and insertion therefore occur in one ordered critical
   * section.
   *
   * The two-key advisory-lock namespace uses class ID 3 for incident timelines.
   * Different incidents normally do not contend. A hashtext collision may cause
   * unnecessary serialisation, but it cannot corrupt sequence or hash-chain
   * correctness.
   */
  async recordEvent(params: RecordTimelineEventParams) {
    const occurredAt = params.occurredAt ?? new Date();
    const payload = params.payload ?? {};

    return this.prisma.$transaction(async (tx) => {
      // Serialises concurrent writers for the same incident before the prior
      // event is read. classid 3 is the timeline namespace: the 1-arg form is
      // the per-user lifecycle lock and classid 2 is journey fix ingestion, so
      // these three cannot contend with one another whatever their values.
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and
      // there is no Prisma type to deserialize a void column into. The tagged
      // template still parameterises incidentId.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, hashtext(${params.incidentId}))`;

      const lastEvent = await tx.incidentTimelineEvent.findFirst({
        where: { incidentId: params.incidentId },
        orderBy: { sequence: 'desc' },
      });

      const sequence = (lastEvent?.sequence ?? 0) + 1;
      const previousHash = lastEvent?.hash ?? null;

      const hash = this.computeHash({
        incidentId: params.incidentId,
        sequence,
        type: params.type,
        payload,
        occurredAt,
        previousHash,
      });

      return tx.incidentTimelineEvent.create({
        data: {
          incidentId: params.incidentId,
          sequence,
          type: params.type,
          payload: payload as Prisma.InputJsonValue,
          source: params.source,
          actorUserId: params.actorUserId,
          correlationId: params.correlationId,
          occurredAt,
          previousHash,
          hash,
        },
      });
    });
  }

  getTimeline(incidentId: string) {
    return this.prisma.incidentTimelineEvent.findMany({
      where: { incidentId },
      orderBy: { sequence: 'asc' },
    });
  }

  /**
   * Walks the full chain for an incident and recomputes every hash,
   * confirming both that each event's hash matches its own content and
   * that each event correctly points at the previous one. This is the
   * actual mechanism behind "tamper-evident" — not the field's
   * existence, but this function catching a mismatch.
   */
  async verifyChain(
    incidentId: string,
  ): Promise<{ valid: boolean; brokenAtSequence?: number }> {
    const events = await this.getTimeline(incidentId);
    let expectedPreviousHash: string | null = null;

    for (const event of events) {
      if (event.previousHash !== expectedPreviousHash) {
        return { valid: false, brokenAtSequence: event.sequence };
      }

      const recomputedHash = this.computeHash({
        incidentId: event.incidentId,
        sequence: event.sequence,
        type: event.type,
        payload: (event.payload as Record<string, unknown>) ?? {},
        occurredAt: event.occurredAt,
        previousHash: event.previousHash,
      });

      if (recomputedHash !== event.hash) {
        return { valid: false, brokenAtSequence: event.sequence };
      }

      expectedPreviousHash = event.hash;
    }

    return { valid: true };
  }

  private computeHash(input: HashInput): string {
    const canonical = JSON.stringify({
      incidentId: input.incidentId,
      sequence: input.sequence,
      type: input.type,
      payload: input.payload,
      occurredAt: input.occurredAt.toISOString(),
      previousHash: input.previousHash,
    });

    return createHash('sha256').update(canonical).digest('hex');
  }
}