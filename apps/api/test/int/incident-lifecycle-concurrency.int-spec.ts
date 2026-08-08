import type { PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { makeTestClient, prismaTest } from './prisma-test-client';
import { createIncident, createUser, sleep, waitFor } from './fixtures';
import { IncidentsService } from '../../src/modules/incidents/incidents.service';
import { IncidentAccessTokenService } from '../../src/modules/incident-access/incident-access-token.service';
import { IncidentTimelineService } from '../../src/modules/incident-timeline/incident-timeline.service';
import { JourneySessionService } from '../../src/modules/journey/journey-session.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Trap #11 again: a concurrency test that only shows blocking proves nothing,
 * because connection serialisation looks identical. The defence, copied from
 * incident-timeline-concurrency.int-spec.ts, is the CONTROL case - test 2
 * holds the same lock on a DIFFERENT incident and asserts the transition
 * completes anyway.
 *
 * Test 1 also pins the KEY. A close() that locked on a different classid, or
 * hashed something other than incidentId, would sail past a held classid-3
 * lock and fail the null assertion.
 *
 * Test 3 is the property the other two explain, and it is the safety-critical
 * one: two terminal transitions raced against one OPEN incident must produce
 * exactly one winner, one terminal status, one terminal timeline event, and a
 * chain that still verifies.
 */

const HOLD_MS = 400;
const TX = { timeout: 20000, maxWait: 10000 };

/** Identical to the timeline spec and to both services. */
const LOCK_SQL = 'SELECT pg_advisory_xact_lock(3, hashtext($1))';

describe('IncidentsService lifecycle contention', () => {
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
   * close() opens its own transaction on whichever client the service was
   * constructed with, so binding a whole service graph to each client is what
   * makes two genuinely concurrent closers possible.
   */
  const serviceOn = (client: PrismaClient) =>
    new IncidentsService(
      client as unknown as PrismaService,
      new IncidentAccessTokenService(client as unknown as PrismaService),
      new IncidentTimelineService(client as unknown as PrismaService),
      // A REAL JourneySessionService, not a double. It injects nothing and
      // every method takes an explicit transaction client, so it composes
      // straight into close()'s transaction - and that means this suite
      // exercises the actual session-ending path against Postgres, including
      // its own advisory locks, rather than a mock's say-so.
      new JourneySessionService(),
    );

  it('blocks a concurrent resolve for the same incident', async () => {
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
      .resolve(incident.id, user.id)
      .then(() => {
        bFinishedAt = Date.now();
      });

    await sleep(HOLD_MS);

    // Fails if the lock is absent, uses a different classid, or is keyed on
    // anything other than incidentId.
    expect(bFinishedAt).toBeNull();

    if (release) {
      (release as () => void)();
    }

    await a;
    await b;

    expect(bFinishedAt).not.toBeNull();
    expect((bFinishedAt ?? 0) - bStart).toBeGreaterThanOrEqual(HOLD_MS / 2);
  });

  /**
   * Control. Same classid, different incident. If this blocked too, test 1
   * would be measuring connection serialisation rather than the lock.
   */
  it('does not block a resolve for a different incident', async () => {
    const user = await createUser();
    const locked = await createIncident(user.id);
    const other = await createIncident(user.id);

    let aHasLock = false;
    let release: (() => void) | null = null;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = clientA.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(LOCK_SQL, locked.id);
      aHasLock = true;
      await held;
    }, TX);

    await waitFor(() => aHasLock);

    const bStart = Date.now();
    await serviceOn(clientB).resolve(other.id, user.id);

    expect(Date.now() - bStart).toBeLessThan(10000);

    if (release) {
      (release as () => void)();
    }
    await a;
  });

  it('lets exactly one of a raced resolve and cancel win', async () => {
    const user = await createUser();
    const incident = await createIncident(user.id);

    // Two live tracking tokens, issued the way the orchestrator issues them.
    const tokens = new IncidentAccessTokenService(
      prismaTest as unknown as PrismaService,
    );
    await tokens.issue(incident.id);
    await tokens.issue(incident.id);

    // Both started before either is awaited. Without the lock both read OPEN,
    // both write a terminal status, and the timeline gets two terminal events
    // - or collides on @@unique([incidentId, sequence]).
    const outcomes = await Promise.allSettled([
      serviceOn(clientA).resolve(incident.id, user.id, { reason: 'USER_SAFE' }),
      serviceOn(clientB).cancel(incident.id, user.id, { reason: 'FALSE_ALARM' }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser must lose for the RIGHT reason: it read a terminal status,
    // not a deadlock or a unique violation.
    const loser = rejected[0];
    if (loser === undefined || loser.status !== 'rejected') {
      throw new Error('Expected exactly one rejection.');
    }
    expect(loser.reason).toBeInstanceOf(ConflictException);

    const after = await prismaTest.incident.findUniqueOrThrow({
      where: { id: incident.id },
    });
    expect(['RESOLVED', 'CANCELLED']).toContain(after.status);

    // resolvedAt carries exactly one meaning.
    if (after.status === 'RESOLVED') {
      expect(after.resolvedAt).not.toBeNull();
    } else {
      expect(after.resolvedAt).toBeNull();
    }

    const events = await prismaTest.incidentTimelineEvent.findMany({
      where: { incidentId: incident.id },
      orderBy: { sequence: 'asc' },
    });

    const terminal = events.filter(
      (e) => e.type === 'INCIDENT_RESOLVED' || e.type === 'INCIDENT_CANCELLED',
    );
    expect(terminal).toHaveLength(1);

    const only = terminal[0];
    if (only === undefined) {
      throw new Error('Expected one terminal timeline event.');
    }
    expect(only.type).toBe(
      after.status === 'RESOLVED' ? 'INCIDENT_RESOLVED' : 'INCIDENT_CANCELLED',
    );
    expect(only.actorUserId).toBe(user.id);

    // Live tracking stops when the emergency is over. This is the assertion
    // that makes the atomicity worth having.
    const live = await prismaTest.incidentAccessToken.count({
      where: { incidentId: incident.id, revokedAt: null },
    });
    expect(live).toBe(0);

    // Whichever writer won, the chain it left behind must verify.
    await expect(
      new IncidentTimelineService(
        prismaTest as unknown as PrismaService,
      ).verifyChain(incident.id),
    ).resolves.toEqual({ valid: true });
  });
});
