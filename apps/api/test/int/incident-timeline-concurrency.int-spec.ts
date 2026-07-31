import type { PrismaClient } from '@prisma/client';
import { makeTestClient, prismaTest } from './prisma-test-client';
import { createIncident, createUser, sleep, waitFor } from './fixtures';
import { firstRow } from './rows';
import { IncidentTimelineService } from '../../src/modules/incident-timeline/incident-timeline.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Trap #11: a badly written concurrency test passes whether or not the lock
 * exists. advisory-lock.int-spec.ts rehearses that problem against a bare
 * pg_advisory_xact_lock; this file applies the same shape to recordEvent.
 *
 * The defence is again the CONTROL case. Test 1 holds classid 3 on one
 * incident and asserts recordEvent has NOT completed. Test 2 holds the same
 * classid on a DIFFERENT incident and asserts it completes immediately. If
 * both blocked, the pair would be measuring connection serialisation rather
 * than the lock. If neither blocked, the lock would not be there at all.
 *
 * Test 1 also pins the KEY, not merely that some lock is taken: a recordEvent
 * that locked on classid 2, or hashed something other than incidentId, would
 * sail past a held classid-3 lock and fail the null assertion.
 *
 * Test 3 is the outcome the other two explain. Without the lock both writers
 * read a null tail, both compute sequence 1, and the second insert violates
 * @@unique([incidentId, sequence]) with P2002 - which is exactly what the
 * service doc comment used to tell callers to catch and retry.
 */

const HOLD_MS = 400;
const TX = { timeout: 20000, maxWait: 10000 };

/** Matches the service verbatim. A different key space would not exclude. */
const LOCK_SQL = 'SELECT pg_advisory_xact_lock(3, hashtext($1))';

describe('IncidentTimelineService contention', () => {
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

  /**
   * recordEvent opens its own transaction on whichever client it was
   * constructed with, so binding a service to each client is what makes two
   * genuinely concurrent writers possible.
   */
  const serviceOn = (client: PrismaClient) =>
    new IncidentTimelineService(client as unknown as PrismaService);

  it('blocks a concurrent recordEvent for the same incident', async () => {
    const user = await createUser();
    const incident = await createIncident(user.id);

    let aHasLock = false;
    let bFinishedAt: number | null = null;
    let release: (() => void) | null = null;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = clientA.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(LOCK_SQL, incident.id);
      aHasLock = true;
      await held;
    }, TX);

    await waitFor(() => aHasLock);

    const bStart = Date.now();
    const b = serviceOn(clientB)
      .recordEvent({
        incidentId: incident.id,
        type: 'SOS_ACTIVATED',
        source: 'INT_SPEC',
      })
      .then(() => {
        bFinishedAt = Date.now();
      });

    await sleep(HOLD_MS);

    // The assertion that fails if the lock is absent, uses a different
    // classid, or is keyed on something other than incidentId.
    expect(bFinishedAt).toBeNull();

    if (release) {
      (release as () => void)();
    }

    await a;
    await b;

    expect(bFinishedAt).not.toBeNull();

    // Loose bound on purpose: ordering is the property, and a loaded machine
    // must not be able to fail this spuriously.
    expect((bFinishedAt ?? 0) - bStart).toBeGreaterThanOrEqual(HOLD_MS / 2);
  });

  /**
   * Control. Same classid, different incident. If this blocked too, test 1
   * would prove nothing about per-incident keying.
   */
  it('does not block a recordEvent for a different incident', async () => {
    const user = await createUser();
    const held1 = await createIncident(user.id);
    const other = await createIncident(user.id);

    let aHasLock = false;
    let release: (() => void) | null = null;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = clientA.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(LOCK_SQL, held1.id);
      aHasLock = true;
      await held;
    }, TX);

    await waitFor(() => aHasLock);

    const bStart = Date.now();
    await serviceOn(clientB).recordEvent({
      incidentId: other.id,
      type: 'SOS_ACTIVATED',
      source: 'INT_SPEC',
    });

    // Completed while A still holds classid 3 on the other incident.
    expect(Date.now() - bStart).toBeLessThan(10000);

    if (release) {
      (release as () => void)();
    }
    await a;
  });

  it('allocates 1 and 2 and leaves a valid chain under concurrent writes', async () => {
    const user = await createUser();
    const incident = await createIncident(user.id);

    // Both started before either is awaited. Without the lock these race on
    // the tail read and collide on @@unique([incidentId, sequence]).
    await Promise.all([
      serviceOn(clientA).recordEvent({
        incidentId: incident.id,
        type: 'SOS_ACTIVATED',
        source: 'INT_SPEC',
      }),
      serviceOn(clientB).recordEvent({
        incidentId: incident.id,
        type: 'EVIDENCE_ADDED',
        source: 'INT_SPEC',
      }),
    ]);

    const events = await prismaTest.incidentTimelineEvent.findMany({
      where: { incidentId: incident.id },
      orderBy: { sequence: 'asc' },
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);

    const first = firstRow(events, 'timeline events');
    const second = events[1];
    if (second === undefined) {
      throw new Error('Expected a second timeline event.');
    }

    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.hash);

    // Whichever writer won, the chain the pair left behind must verify.
    await expect(
      serviceOn(prismaTest).verifyChain(incident.id),
    ).resolves.toEqual({ valid: true });
  });
});
