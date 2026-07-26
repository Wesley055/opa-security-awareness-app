import { prismaTest } from './prisma-test-client';
import { captureError, createSession, createUser } from './fixtures';

/**
 * Decision 10: one active session per user, enforced by a partial unique
 * index that lives in migration SQL and cannot exist in schema.prisma.
 *
 * harness.int-spec.ts asserts the index DEFINITION. This asserts the index
 * BEHAVIOUR. Both matter: a definition check catches a dropped index, but
 * only an insert proves the database actually refuses the write.
 */
describe('one active session per user', () => {
  it('rejects a second active session for the same user', async () => {
    const user = await createUser();

    await createSession(user.id, { status: 'STARTED' });

    const err = await captureError(() =>
      createSession(user.id, { status: 'ACTIVE' }),
    );

    expect(err).not.toBeNull();
    expect(err?.code).toBe('P2002');

    expect(await prismaTest.journeySession.count()).toBe(1);
  });

  it('rejects two STARTED sessions for the same user', async () => {
    const user = await createUser();

    await createSession(user.id, { status: 'STARTED' });

    const err = await captureError(() =>
      createSession(user.id, { status: 'STARTED' }),
    );

    expect(err?.code).toBe('P2002');

    // The real property: the rejected insert left no row behind.
    expect(await prismaTest.journeySession.count()).toBe(1);
  });

  /**
   * The predicate must cover STARTED and ACTIVE only. If a future migration
   * widened it to every status, this test fails — a user accumulates ended
   * sessions over their lifetime and that must stay legal.
   */
  it('allows many ENDED sessions for one user', async () => {
    const user = await createUser();

    for (let i = 0; i < 3; i += 1) {
      await createSession(user.id, {
        status: 'ENDED',
        endedAt: new Date(),
        endedReason: 'USER_ENDED',
      });
    }

    expect(await prismaTest.journeySession.count()).toBe(3);
  });

  /**
   * Supersession order from decision 11: end the current session, then
   * insert its replacement. The index is the last-resort defence behind the
   * advisory lock, and it must not block the legitimate sequence.
   */
  it('allows a replacement once the previous session is ENDED', async () => {
    const user = await createUser();
    const first = await createSession(user.id, { status: 'ACTIVE' });

    await prismaTest.journeySession.update({
      where: { id: first.id },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        endedReason: 'SUPERSEDED',
      },
    });

    const second = await createSession(user.id, { status: 'STARTED' });

    expect(second.id).not.toBe(first.id);
    expect(await prismaTest.journeySession.count()).toBe(2);
  });

  it('scopes the constraint per user, not globally', async () => {
    const userA = await createUser();
    const userB = await createUser();

    await createSession(userA.id, { status: 'ACTIVE' });
    await createSession(userB.id, { status: 'ACTIVE' });

    expect(await prismaTest.journeySession.count()).toBe(2);
  });
});
