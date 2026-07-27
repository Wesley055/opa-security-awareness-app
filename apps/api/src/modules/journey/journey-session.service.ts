import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  JourneyPurpose,
  JourneySessionStatus,
  type JourneySession,
  type Prisma,
} from '@prisma/client';
import { canonicalChainEnvelope } from './canonical-chain';
import { canonicalFixPayload } from './canonical-fix';

/** Values permitted by JourneyLocationFix.source (VarChar(32)). */
export type JourneyFixSource =
  | 'foreground'
  | 'background'
  | 'manual'
  | 'activation'
  | 'retrigger';

/** Coordinates are carried as exact decimal values, never as floats. */
export type CoordinateInput = Prisma.Decimal | string | number;

export interface JourneyFixInput {
  idempotencyKey: string;
  source: JourneyFixSource;
  latitude: CoordinateInput;
  longitude: CoordinateInput;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  batteryLevel?: number | null;
  isCharging?: boolean | null;
  recordedAt: Date;
}

export interface InsertFixesResult {
  /** Rows actually written by this call. */
  inserted: number;
  /** Dropped because an earlier fix in the same batch had the same key. */
  skippedDuplicateInBatch: number;
  /** Dropped because (sessionId, idempotencyKey) already existed. */
  skippedAlreadyStored: number;
  /** The single transaction clock value used for every hash in this call. */
  receivedAt: Date;
  /** Chain head after this call, or null when the session has no fixes. */
  tailSequence: number | null;
  tailHash: string | null;
}

/** Enough of an Incident to route a retrigger fix. Structural so callers
 *  using a partial select still satisfy it. */
export interface RetriggerIncidentRef {
  id: string;
  userId: string;
  journeySessionId: string | null;
  retriggerCount: number;
}

function sha256Hex(preimage: string): string {
  return createHash('sha256').update(preimage, 'utf8').digest('hex');
}

@Injectable()
export class JourneySessionService {
  // Every method takes an explicit transaction client and there is no
  // injected fallback. pg_advisory_xact_lock is transaction-scoped: on a
  // non-transactional client each statement is its own implicit transaction,
  // so the lock would be released before the next statement ran. The code
  // would look identical, raise nothing, and provide no mutual exclusion at
  // all. Making tx optional would put that failure one missing argument away.

  /**
   * Return the user's open session, creating one if there is none.
   *
   * Takes the 1-arg lifecycle lock defensively (D6). pg_advisory_xact_lock is
   * reentrant within a transaction, so this costs almost nothing when the
   * orchestrator already holds it, and it removes the question of whether
   * every path that reaches here holds it.
   */
  async resolveForActivation(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose: JourneyPurpose = JourneyPurpose.INCIDENT,
  ): Promise<JourneySession> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    const existing = await tx.journeySession.findFirst({
      where: {
        userId,
        status: {
          in: [JourneySessionStatus.STARTED, JourneySessionStatus.ACTIVE],
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (existing !== null) {
      return existing;
    }

    // purpose is a tag only. Nothing in 10B may branch on it.
    return tx.journeySession.create({ data: { userId, purpose } });
  }

  /** The position captured when an incident was raised. */
  async recordActivationFix(
    tx: Prisma.TransactionClient,
    params: {
      sessionId: string;
      incidentId: string;
      latitude: CoordinateInput;
      longitude: CoordinateInput;
      recordedAt: Date;
    },
  ): Promise<InsertFixesResult> {
    return this.insertFixes(tx, params.sessionId, [
      {
        // Deterministic: a retried transaction must not create a second row.
        idempotencyKey: `activation:${params.incidentId}`,
        source: 'activation',
        latitude: params.latitude,
        longitude: params.longitude,
        recordedAt: params.recordedAt,
      },
    ]);
  }

  /** The position captured when an existing incident was retriggered. */
  async recordRetriggerFix(
    tx: Prisma.TransactionClient,
    params: {
      incident: RetriggerIncidentRef;
      latitude: CoordinateInput;
      longitude: CoordinateInput;
      recordedAt: Date;
    },
  ): Promise<InsertFixesResult> {
    const { incident } = params;

    const sessionId =
      incident.journeySessionId ??
      (await this.resolveForActivation(tx, incident.userId)).id;

    return this.insertFixes(tx, sessionId, [
      {
        // retriggerCount makes each retrigger its own key while keeping a
        // retry of the same retrigger idempotent.
        idempotencyKey: `retrigger:${incident.id}:${incident.retriggerCount}`,
        source: 'retrigger',
        latitude: params.latitude,
        longitude: params.longitude,
        recordedAt: params.recordedAt,
      },
    ]);
  }

  /**
   * The single owner of the hash chain (D2). Every write path goes through
   * here, so the concurrency tests exercise the code the batch endpoint will
   * use. Two implementations of the chain is the one duplication this design
   * cannot afford.
   */
  private async insertFixes(
    tx: Prisma.TransactionClient,
    sessionId: string,
    fixes: JourneyFixInput[],
  ): Promise<InsertFixesResult> {
    // Ingestion lock. The 2-arg form occupies a lock space entirely separate
    // from the 1-arg lifecycle lock above; they cannot collide with each
    // other whatever their values. hashtext returns int4, so two sessionIds
    // can collide within this form, which costs serialisation and never
    // correctness.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(2, hashtext(${sessionId}))`;

    // D3: one clock value for the whole transaction, from the database, and
    // truncated at the source. The column is timestamp(3) and PostgreSQL
    // ROUNDS to that precision on store, so an untruncated microsecond tail
    // would be hashed as one millisecond and stored as another.
    // canonicalTimestamp cannot catch that: the JS Date constructor truncates
    // a sub-millisecond ISO string silently rather than rejecting it.
    const clockRows = await tx.$queryRaw<Array<{ received_at: Date }>>`
      SELECT date_trunc('milliseconds', now()) AS received_at
    `;
    const clockRow = clockRows[0];
    if (clockRow === undefined) {
      throw new Error('journey: transaction clock query returned no row');
    }
    const receivedAt = clockRow.received_at;

    // D5: in-batch dedupe before the database check. The database cannot see
    // two fixes sharing a key within one batch; both would pass the existence
    // check and collide at insert as an unexplained P2002.
    const deduped: JourneyFixInput[] = [];
    const seenKeys = new Set<string>();
    for (const fix of fixes) {
      if (seenKeys.has(fix.idempotencyKey)) {
        continue;
      }
      seenKeys.add(fix.idempotencyKey);
      deduped.push(fix);
    }
    const skippedDuplicateInBatch = fixes.length - deduped.length;

    // Chain order is receipt order; travel order is recordedAt. Sorting here
    // makes a batch's sequence numbers follow the movement it describes.
    deduped.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

    const session = await tx.journeySession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session === null) {
      throw new Error('journey: session ' + sessionId + ' not found');
    }

    // One indexed lookup for the chain head.
    const tail = await tx.journeyLocationFix.findFirst({
      where: { journeySessionId: sessionId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true, hash: true },
    });

    // One query for every already-stored key in this batch.
    const stored = await tx.journeyLocationFix.findMany({
      where: {
        journeySessionId: sessionId,
        idempotencyKey: { in: deduped.map((fix) => fix.idempotencyKey) },
      },
      select: { idempotencyKey: true },
    });
    const storedKeys = new Set(stored.map((row) => row.idempotencyKey));

    let previousHash: string | null = tail === null ? null : tail.hash;
    let sequence = tail === null ? 0 : tail.sequence + 1;
    let skippedAlreadyStored = 0;

    const rows: Prisma.JourneyLocationFixCreateManyInput[] = [];

    for (const fix of deduped) {
      // An idempotent replay is a normal outcome, not an error.
      if (storedKeys.has(fix.idempotencyKey)) {
        skippedAlreadyStored += 1;
        continue;
      }

      const nonce = randomBytes(32).toString('hex');

      // All seven keys are passed explicitly. An absent key and an explicit
      // null must never take different paths into the envelope.
      const payloadHash = sha256Hex(
        canonicalFixPayload({
          nonce,
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy: fix.accuracy ?? null,
          speed: fix.speed ?? null,
          heading: fix.heading ?? null,
          recordedAt: fix.recordedAt,
        }),
      );

      const hash = sha256Hex(
        canonicalChainEnvelope({
          previousHash,
          payloadHash,
          sequence,
          receivedAt,
        }),
      );

      rows.push({
        journeySessionId: sessionId,
        sequence,
        idempotencyKey: fix.idempotencyKey,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy ?? null,
        speed: fix.speed ?? null,
        heading: fix.heading ?? null,
        batteryLevel: fix.batteryLevel ?? null,
        isCharging: fix.isCharging ?? null,
        source: fix.source,
        recordedAt: fix.recordedAt,
        // Passed explicitly. Letting the column default fill it would make
        // the hash cover a value the row does not hold.
        receivedAt,
        nonce,
        payloadHash,
        previousHash,
        hash,
      });

      previousHash = hash;
      sequence += 1;
    }

    if (rows.length === 0) {
      // Nothing was written, so lastFixReceivedAt must not move. It is
      // denormalised from the newest fix; advancing it here would make it
      // disagree with every row it is derived from.
      return {
        inserted: 0,
        skippedDuplicateInBatch,
        skippedAlreadyStored,
        receivedAt,
        tailSequence: tail === null ? null : tail.sequence,
        tailHash: tail === null ? null : tail.hash,
      };
    }

    await tx.journeyLocationFix.createMany({ data: rows });

    await tx.journeySession.update({
      where: { id: sessionId },
      data: {
        lastFixReceivedAt: receivedAt,
        ...(session.status === JourneySessionStatus.STARTED
          ? { status: JourneySessionStatus.ACTIVE }
          : {}),
      },
    });

    return {
      inserted: rows.length,
      skippedDuplicateInBatch,
      skippedAlreadyStored,
      receivedAt,
      tailSequence: sequence - 1,
      tailHash: previousHash,
    };
  }
}
