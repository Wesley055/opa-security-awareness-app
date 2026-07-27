import type { PrismaClient } from '@prisma/client';
import { makeTestClient, prismaTest } from './prisma-test-client';
import { createSession, createUser, sleep, waitFor } from './fixtures';
import { JourneySessionService } from '../../src/modules/journey/journey-session.service';

/**
 * Trap #11, service level.
 *
 * READ THIS BEFORE CHANGING AN ASSERTION HERE.
 *
 * The timing assertion that carries the proof in advisory-lock.int-spec.ts
 * does NOT carry it here. Remove the ingestion lock and the second
 * transaction still blocks: both callers read an empty tail, both compute
 * the same sequence, and the second one waits on the unique index
 * (journeySessionId, sequence) instead of on the lock. It then fails with
 * P2002 when the first commits.
 *
 * So the mutation-sensitive assertions are the OUTCOME ones, marked below:
 * that the second call succeeds, lands at the next sequence, and links to
 * the first call's hash. A timing-only version of this test would pass with
 * the lock deleted.
 *
 * MUTATION TEST, to be re-run whenever this file changes:
 *   In journey-session.service.ts, replace
 *     SELECT pg_advisory_xact_lock(2, hashtext(${sessionId}))
 *   with
 *     SELECT hashtext(${sessionId})
 *   and confirm 'serialises two concurrent inserts' FAILS. Restore after.
 *   Do the same for the 1-arg lock and 'serialises two concurrent
 *   resolveForActivation calls'.
 *
 * This design also depends on READ COMMITTED. The waiting transaction must
 * see the committed row when it re-reads the tail; under REPEATABLE READ it
 * would hold the lock correctly and still read a stale tail.
 */

const HOLD_MS = 400;
const TX = { timeout: 20000, maxWait: 10000 };
const LAT = '6.524379';
const LNG = '3.379206';

describe('JourneySessionService concurrency', () => {
  const service = new JourneySessionService();

  let clientA: PrismaClient;
  let clientB: PrismaClient;

  beforeEach(() => {
    clientA = makeTestClient();
    clientB = makeTestClient();
  });

  afterEach(async () => {
    await clientA.$disconnect();
    await clientB.$disconnect();
  });

  it('serialises two concurrent inserts into one session', async () => {
    const user = await createUser();
    const session = await createSession(user.id, { status: 'STARTED' });

    let aInserted = false;
    let bFinishedAt: number | null = null;
    let release: (() => void) | null = null;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = clientA.$transaction(async (tx) => {
      await service.recordActivationFix(tx, {
        sessionId: session.id,
        incidentId: 'incident-a',
        latitude: LAT,
        longitude: LNG,
        recordedAt: new Date('2026-07-26T10:00:00.000Z'),
      });
      aInserted = true;
      await held;
    }, TX);

    await waitFor(() => aInserted);

    const b = clientB.$transaction(async (tx) => {
      await service.recordActivationFix(tx, {
        sessionId: session.id,
        incidentId: 'incident-b',
        latitude: LAT,
        longitude: LNG,
        recordedAt: new Date('2026-07-26T10:01:00.000Z'),
      });
      bFinishedAt = Date.now();
    }, TX);

    await sleep(HOLD_MS);

    // NOT mutation-sensitive: without the lock B blocks on the unique
    // index instead. Kept because it proves the two transactions genuinely
    // overlapped rather than running one after the other.
    expect(bFinishedAt).toBeNull();

    if (release) {
      (release as () => void)();
    }

    await a;

    // MUTATION-SENSITIVE: without the lock this rejects with P2002.
    await expect(b).resolves.toBeUndefined();

    const rows = await prismaTest.journeyLocationFix.findMany({
      where: { journeySessionId: session.id },
      orderBy: { sequence: 'asc' },
    });

    // MUTATION-SENSITIVE: two rows at distinct sequences, chained.
    expect(rows).toHaveLength(2);

    const first = rows[0];
    const second = rows[1];
    if (first === undefined || second === undefined) {
      throw new Error('expected two fix rows');
    }

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);

    // The later arrival is the one that waited, whichever key it carried.
    expect(second.idempotencyKey).toBe('activation:incident-b');
  });

  /**
   * Control. Same shape, a different session. If this also blocked, the
   * test above would be measuring connection serialisation rather than a
   * lock keyed on sessionId.
   */
  it('does not block an insert into a different session', async () => {
    const user = await createUser();
    const sessionOne = await createSession(user.id, { status: 'STARTED' });
    const otherUser = await createUser();
    const sessionTwo = await createSession(otherUser.id, { status: 'STARTED' });

    let aInserted = false;
    let bFinishedAt: number | null = null;
    let release: (() => void) | null = null;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = clientA.$transaction(async (tx) => {
      await service.recordActivationFix(tx, {
        sessionId: sessionOne.id,
        incidentId: 'incident-one',
        latitude: LAT,
        longitude: LNG,
        recordedAt: new Date('2026-07-26T10:00:00.000Z'),
      });
      aInserted = true;
      await held;
    }, TX);

    await waitFor(() => aInserted);

    const bStart = Date.now();
    await clientB.$transaction(async (tx) => {
      await service.recordActivationFix(tx, {
        sessionId: sessionTwo.id,
        incidentId: 'incident-two',
        latitude: LAT,
        longitude: LNG,
        recordedAt: new Date('2026-07-26T10:00:00.000Z'),
      });
      bFinishedAt = Date.now();
    }, TX);

    // Completed while A still holds its own session's lock.
    expect(bFinishedAt).not.toBeNull();
    expect(Date.now() - bStart).toBeLessThan(10000);

    if (release) {
      (release as () => void)();
    }
    await a;
  });

  it('serialises two concurrent resolveForActivation calls for one user', async () => {
    const user = await createUser();

    let aResolved: string | null = null;
    let bResolved: string | null = null;
    let release: (() => void) | null = null;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = clientA.$transaction(async (tx) => {
      const session = await service.resolveForActivation(tx, user.id);
      aResolved = session.id;
      await held;
    }, TX);

    await waitFor(() => aResolved !== null);

    const b = clientB.$transaction(async (tx) => {
      const session = await service.resolveForActivation(tx, user.id);
      bResolved = session.id;
    }, TX);

    await sleep(HOLD_MS);
    expect(bResolved).toBeNull();

    if (release) {
      (release as () => void)();
    }

    await a;

    // MUTATION-SENSITIVE: without the lifecycle lock B creates a second
    // open session and the partial unique index rejects it with P2002.
    await expect(b).resolves.toBeUndefined();

    expect(bResolved).not.toBeNull();
    expect(bResolved).toBe(aResolved);

    const sessions = await prismaTest.journeySession.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(1);
  });
});
