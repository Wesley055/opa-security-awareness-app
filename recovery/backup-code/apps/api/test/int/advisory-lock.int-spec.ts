import type { PrismaClient } from '@prisma/client';
import { makeTestClient } from './prisma-test-client';
import { createUser, sleep, waitFor } from './fixtures';

/**
 * Trap #11: a badly written concurrency test passes whether or not the lock
 * exists. This file is the rehearsal for that problem, run against a bare
 * pg_advisory_xact_lock before any service logic is involved.
 *
 * The defence is the control case. The contended test asserts the second
 * transaction has NOT acquired while the first still holds; the control
 * asserts a DIFFERENT key acquires immediately. If both blocked, the test
 * would be measuring connection serialisation rather than the lock.
 *
 * Uses the 1-arg form, hashtext(userId), matching the orchestrator verbatim
 * per decision 11. A separate key space would not mutually exclude.
 */

const HOLD_MS = 400;
const TX = { timeout: 20000, maxWait: 10000 };

describe('pg_advisory_xact_lock', () => {
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

  it('blocks a second transaction taking the same key', async () => {
    const user = await createUser();

    let aHasLock = false;
    let bAcquiredAt: number | null = null;
    let release: (() => void) | null = null;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = clientA.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        user.id,
      );
      aHasLock = true;
      await held;
    }, TX);

    await waitFor(() => aHasLock);

    const bStart = Date.now();
    const b = clientB.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        user.id,
      );
      bAcquiredAt = Date.now();
    }, TX);

    await sleep(HOLD_MS);

    // The assertion that fails if the lock does nothing.
    expect(bAcquiredAt).toBeNull();

    if (release) {
      (release as () => void)();
    }

    await a;
    await b;

    expect(bAcquiredAt).not.toBeNull();

    const waited = (bAcquiredAt ?? 0) - bStart;
    // Ordering is the property under test; the bound is deliberately
    // loose so a slow or loaded machine cannot fail it spuriously.
    expect(waited).toBeGreaterThanOrEqual(HOLD_MS / 2);
  });

  /**
   * Control. Same shape, different key. If this also blocked, the test above
   * would prove nothing about the lock.
   */
  it('does not block when the keys differ', async () => {
    const userA = await createUser();
    const userB = await createUser();

    let aHasLock = false;
    let bAcquiredAt: number | null = null;
    let release: (() => void) | null = null;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = clientA.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        userA.id,
      );
      aHasLock = true;
      await held;
    }, TX);

    await waitFor(() => aHasLock);

    const bStart = Date.now();
    const b = clientB.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        userB.id,
      );
      bAcquiredAt = Date.now();
    }, TX);

    await b;

    // Acquired while A still holds its own, different key.
    expect(bAcquiredAt).not.toBeNull();
    expect(Date.now() - bStart).toBeLessThan(10000);

    if (release) {
      (release as () => void)();
    }
    await a;
  });

  /**
   * xact locks release at COMMIT, not by explicit unlock. If this ever fails,
   * something is holding a transaction open and the service code that relies
   * on automatic release is unsafe.
   */
  it('releases the lock when the transaction commits', async () => {
    const user = await createUser();

    await clientA.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        user.id,
      );
    }, TX);

    const start = Date.now();

    await clientB.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        user.id,
      );
    }, TX);

    // Generous: if the lock had NOT been released, this transaction
    // would block until the 20s transaction timeout and throw.
    expect(Date.now() - start).toBeLessThan(10000);
  });
});
