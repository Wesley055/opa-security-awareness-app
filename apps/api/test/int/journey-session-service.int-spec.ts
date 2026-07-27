import { createHash } from 'node:crypto';
import { prismaTest } from './prisma-test-client';
import { createSession, createUser } from './fixtures';
import { JourneySessionService } from '../../src/modules/journey/journey-session.service';
import { canonicalChainEnvelope } from '../../src/modules/journey/canonical-chain';
import { canonicalFixPayload } from '../../src/modules/journey/canonical-fix';

/**
 * Single-transaction behaviour of JourneySessionService. Contention lives in
 * journey-session-concurrency.int-spec.ts.
 *
 * The strongest test here is the recomputation one: it rebuilds both hashes
 * from what the row actually holds and compares them to the stored digests.
 * That is the only assertion that would catch receivedAt being left to the
 * column default, which would make the hash cover a value the row does not
 * hold (D3).
 */

const TX = { timeout: 20000, maxWait: 10000 };

const LAT = '6.524379';
const LNG = '3.379206';

function sha256Hex(preimage: string): string {
  return createHash('sha256').update(preimage, 'utf8').digest('hex');
}

describe('JourneySessionService', () => {
  const service = new JourneySessionService();

  it('writes a genesis fix at sequence 0 and activates a STARTED session', async () => {
    const user = await createUser();
    const session = await createSession(user.id, { status: 'STARTED' });

    const result = await prismaTest.$transaction(
      (tx) =>
        service.recordActivationFix(tx, {
          sessionId: session.id,
          incidentId: 'incident-genesis',
          latitude: LAT,
          longitude: LNG,
          recordedAt: new Date('2026-07-26T10:00:00.000Z'),
        }),
      TX,
    );

    expect(result.inserted).toBe(1);
    expect(result.skippedAlreadyStored).toBe(0);
    expect(result.skippedDuplicateInBatch).toBe(0);
    expect(result.tailSequence).toBe(0);

    const rows = await prismaTest.journeyLocationFix.findMany({
      where: { journeySessionId: session.id },
      orderBy: { sequence: 'asc' },
    });
    expect(rows).toHaveLength(1);

    const row = rows[0];
    if (row === undefined) {
      throw new Error('expected one fix row');
    }

    expect(row.sequence).toBe(0);
    // Genesis carries a null previousHash, never an empty string.
    expect(row.previousHash).toBeNull();
    expect(row.source).toBe('activation');
    expect(row.idempotencyKey).toBe('activation:incident-genesis');
    expect(row.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.receivedAt.getTime()).toBe(result.receivedAt.getTime());

    const after = await prismaTest.journeySession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.status).toBe('ACTIVE');
    expect(after.lastFixReceivedAt).not.toBeNull();
    expect(after.lastFixReceivedAt?.getTime()).toBe(result.receivedAt.getTime());
  });

  it('treats a replayed idempotency key as a skip, not an error', async () => {
    const user = await createUser();
    const session = await createSession(user.id, { status: 'STARTED' });

    const call = (): Promise<{
      inserted: number;
      skippedAlreadyStored: number;
      receivedAt: Date;
    }> =>
      prismaTest.$transaction(
        (tx) =>
          service.recordActivationFix(tx, {
            sessionId: session.id,
            incidentId: 'incident-replay',
            latitude: LAT,
            longitude: LNG,
            recordedAt: new Date('2026-07-26T10:00:00.000Z'),
          }),
        TX,
      );

    const first = await call();
    expect(first.inserted).toBe(1);

    const sessionAfterFirst = await prismaTest.journeySession.findUniqueOrThrow({
      where: { id: session.id },
    });

    const second = await call();

    // A replay is a normal outcome. It must not raise, and it must not
    // write a second row.
    expect(second.inserted).toBe(0);
    expect(second.skippedAlreadyStored).toBe(1);

    const rows = await prismaTest.journeyLocationFix.findMany({
      where: { journeySessionId: session.id },
    });
    expect(rows).toHaveLength(1);

    // lastFixReceivedAt is denormalised from the newest fix. Nothing was
    // written, so it must not have moved, even though the second call
    // captured a later transaction clock.
    const sessionAfterSecond = await prismaTest.journeySession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(sessionAfterSecond.lastFixReceivedAt?.getTime()).toBe(
      sessionAfterFirst.lastFixReceivedAt?.getTime(),
    );
    expect(second.receivedAt.getTime()).toBeGreaterThanOrEqual(
      first.receivedAt.getTime(),
    );
  });

  it('produces a chain that verifies by recomputation from stored values', async () => {
    const user = await createUser();
    const session = await createSession(user.id, { status: 'STARTED' });

    for (const n of [1, 2, 3]) {
      await prismaTest.$transaction(
        (tx) =>
          service.recordActivationFix(tx, {
            sessionId: session.id,
            incidentId: 'incident-' + String(n),
            latitude: LAT,
            longitude: LNG,
            recordedAt: new Date('2026-07-26T10:0' + String(n) + ':00.000Z'),
          }),
        TX,
      );
    }

    const rows = await prismaTest.journeyLocationFix.findMany({
      where: { journeySessionId: session.id },
      orderBy: { sequence: 'asc' },
    });
    expect(rows).toHaveLength(3);

    let expectedPrevious: string | null = null;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row === undefined) {
        throw new Error('missing row at index ' + String(i));
      }

      expect(row.sequence).toBe(i);
      expect(row.previousHash).toBe(expectedPrevious);

      // The canonicaliser runs on read as well as write. Coordinates go
      // through toString so the Decimal is carried as an exact decimal
      // string rather than through a float.
      const payloadHash = sha256Hex(
        canonicalFixPayload({
          nonce: row.nonce ?? '',
          latitude: row.latitude === null ? null : row.latitude.toString(),
          longitude: row.longitude === null ? null : row.longitude.toString(),
          accuracy: row.accuracy,
          speed: row.speed,
          heading: row.heading,
          recordedAt: row.recordedAt,
        }),
      );
      expect(payloadHash).toBe(row.payloadHash);

      // This is the assertion that fails if receivedAt were left to the
      // column default: the hash would cover the value the service captured
      // and the row would hold the one PostgreSQL generated at insert.
      const chainHash = sha256Hex(
        canonicalChainEnvelope({
          previousHash: row.previousHash,
          payloadHash: row.payloadHash,
          sequence: row.sequence,
          receivedAt: row.receivedAt,
        }),
      );
      expect(chainHash).toBe(row.hash);

      expectedPrevious = row.hash;
    }
  });

  it('resolveForActivation reuses an open session and creates one otherwise', async () => {
    const user = await createUser();

    const created = await prismaTest.$transaction(
      (tx) => service.resolveForActivation(tx, user.id),
      TX,
    );
    expect(created.status).toBe('STARTED');
    expect(created.purpose).toBe('INCIDENT');

    const reused = await prismaTest.$transaction(
      (tx) => service.resolveForActivation(tx, user.id),
      TX,
    );
    expect(reused.id).toBe(created.id);

    const all = await prismaTest.journeySession.findMany({
      where: { userId: user.id },
    });
    expect(all).toHaveLength(1);
  });

  it('resolveForActivation does not reuse an ENDED session', async () => {
    const user = await createUser();
    const ended = await createSession(user.id, {
      status: 'ENDED',
      endedAt: new Date(),
      endedReason: 'USER_ENDED',
    });

    const resolved = await prismaTest.$transaction(
      (tx) => service.resolveForActivation(tx, user.id),
      TX,
    );

    expect(resolved.id).not.toBe(ended.id);
    expect(resolved.status).toBe('STARTED');
  });
});
