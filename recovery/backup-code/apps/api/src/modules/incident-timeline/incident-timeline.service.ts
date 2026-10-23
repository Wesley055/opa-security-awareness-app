import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  toReaderTimelineEvent,
  type ReaderTimelineEvent,
} from './dto/timeline-event.dto';

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
  async recordEvent(
    params: RecordTimelineEventParams,
    outerTx?: Prisma.TransactionClient,
  ) {
    const occurredAt = params.occurredAt ?? new Date();
    const payload = params.payload ?? {};

    // When a caller supplies its own transaction the event MUST be written
    // inside it, or a status change and its timeline record could commit
    // independently. Opening a nested $transaction here would do exactly
    // that. classid 3 is still taken on the caller's transaction, so
    // per-incident serialisation is unchanged.
    const append = async (tx: Prisma.TransactionClient) => {
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
    };

    return outerTx ? append(outerTx) : this.prisma.$transaction(append);
  }

  /**
   * The RAW read. Every column, including payload and the hash chain,
   * because verifyChain recomputes from all of it.
   *
   * NOT SAFE TO RETURN TO A READER - see getTimelineForReader.
   */
  getTimeline(incidentId: string) {
    return this.prisma.incidentTimelineEvent.findMany({
      where: { incidentId },
      orderBy: { sequence: 'asc' },
    });
  }

  /**
   * The same events, projected to what a reader may see.
   *
   * The allowlist lives in dto/timeline-event.dto.ts so write-time
   * knowledge of payload shapes stays on this side of the API.
   */
  async getTimelineForReader(
    incidentId: string,
  ): Promise<ReaderTimelineEvent[]> {
    const events = await this.getTimeline(incidentId);
    return events.map((event) => toReaderTimelineEvent(event));
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

  /**
   * Key-order-independent form of a JSON value.
   *
   * WHY THIS EXISTS. The payload column is Prisma `Json`, which is
   * PostgreSQL `jsonb`. jsonb DOES NOT PRESERVE KEY ORDER - it stores keys
   * sorted by length and then bytewise. Measured on this database:
   *
   *   written  {"previousStatus":"OPEN","newStatus":"RESOLVED",
   *             "reason":"X","revokedTokens":2}
   *   read     {"reason":"X","newStatus":"RESOLVED",
   *             "revokedTokens":2,"previousStatus":"OPEN"}
   *
   * JSON.stringify follows insertion order, so hashing the payload object
   * directly produced one string at write time and a DIFFERENT one at
   * verify time. verifyChain then reported a valid chain as broken.
   *
   * The flaw was latent: every caller before the incident lifecycle passed
   * NO payload, so `{}` was hashed on both sides and key order never
   * mattered. The first caller with a real payload exposed it.
   *
   * ARRAYS KEEP THEIR ORDER. Element order in an array is data, not
   * representation, and jsonb preserves it. Only OBJECT keys are sorted.
   */
  private canonicalise(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.canonicalise(item));
    }

    // typeof null === 'object', and Object.keys(null) throws.
    if (value === null || typeof value !== 'object') {
      return value;
    }

    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    // Sorted at EVERY depth, including objects nested inside arrays. A
    // shallow sort passes a flat test and fails on real payloads.
    for (const key of Object.keys(source).sort()) {
      sorted[key] = this.canonicalise(source[key]);
    }

    return sorted;
  }

  /**
   * Both recordEvent and verifyChain hash through here, so write-time and
   * verify-time canonicalisation cannot drift apart.
   */
  /**
   * Verifies only the STORED STRUCTURE of a timeline.
   *
   * Historical payloads written before canonicalisation may not have a
   * reproducible content hash because PostgreSQL jsonb did not preserve the
   * JavaScript key insertion order used by the old writer.
   *
   * This method therefore proves the structural property that remains
   * recoverable: sequence numbers are contiguous and each event points to the
   * stored hash of its immediate predecessor.
   */
  async verifyStructuralChain(
    incidentId: string,
  ): Promise<{ valid: boolean; brokenAtSequence?: number }> {
    const events = await this.getTimeline(incidentId);

    let expectedSequence = 1;
    let expectedPreviousHash: string | null = null;

    for (const event of events) {
      if (event.sequence !== expectedSequence) {
        return {
          valid: false,
          brokenAtSequence: event.sequence,
        };
      }

      if (event.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          brokenAtSequence: event.sequence,
        };
      }

      expectedSequence += 1;
      expectedPreviousHash = event.hash;
    }

    return { valid: true };
  }

  /**
   * Verifies the current tail using today's canonical hash algorithm and
   * confirms that it links to its immediate predecessor.
   *
   * Unlike verifyChain(), this does not attempt to recompute older legacy
   * payload hashes. It is intended for verifying a newly appended event on a
   * structurally intact historical chain.
   */
  async verifyTailEvent(
    incidentId: string,
  ): Promise<{ valid: boolean; brokenAtSequence?: number }> {
    const events = await this.getTimeline(incidentId);

    if (events.length === 0) {
      return { valid: true };
    }

    const tail = events[events.length - 1];

    if (tail === undefined) {
      return { valid: true };
    }

    const predecessor =
      events.length > 1 ? events[events.length - 2] : undefined;

    const expectedPreviousHash = predecessor?.hash ?? null;

    if (tail.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        brokenAtSequence: tail.sequence,
      };
    }

    const expectedSequence =
      predecessor === undefined ? 1 : predecessor.sequence + 1;

    if (tail.sequence !== expectedSequence) {
      return {
        valid: false,
        brokenAtSequence: tail.sequence,
      };
    }

    const recomputedHash = this.computeHash({
      incidentId: tail.incidentId,
      sequence: tail.sequence,
      type: tail.type,
      payload: (tail.payload as Record<string, unknown>) ?? {},
      occurredAt: tail.occurredAt,
      previousHash: tail.previousHash,
    });

    if (recomputedHash !== tail.hash) {
      return {
        valid: false,
        brokenAtSequence: tail.sequence,
      };
    }

    return { valid: true };
  }
  private computeHash(input: HashInput): string {
    const canonical = JSON.stringify({
      incidentId: input.incidentId,
      sequence: input.sequence,
      type: input.type,
      payload: this.canonicalise(input.payload),
      occurredAt: input.occurredAt.toISOString(),
      previousHash: input.previousHash,
    });

    return createHash('sha256').update(canonical).digest('hex');
  }
}