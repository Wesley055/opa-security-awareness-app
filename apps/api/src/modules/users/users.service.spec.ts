import { UsersService } from './users.service';

/**
 * Coverage for findById's PROJECTION, which is now a published contract:
 * GET /users/me returns it, and the operator console reads it through the
 * same-origin bridge.
 *
 * THESE ASSERT ON THE ARGUMENTS, NOT THE RESULT. What matters is which
 * columns leave the database - a test that mocked a return value would
 * prove nothing about the select, which is the only thing that can leak.
 *
 * NOT ALL REJECTIONS. Two of these confirm the shape IS what the console
 * needs; two confirm it is NOT wider than intended. A suite of only
 * negative assertions cannot tell a correct projection from an empty one.
 */
describe('UsersService.findById', () => {
  function makePrisma() {
    return {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
  }

  function selectArg(prisma: ReturnType<typeof makePrisma>) {
    return prisma.user.findUnique.mock.calls[0][0].select;
  }

  it('queries by id', async () => {
    const prisma = makePrisma();
    await new UsersService(prisma as never).findById('user-1');

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
      id: 'user-1',
    });
  });

  it('still selects the fields the incident orchestrator reads', async () => {
    // incident-orchestrator.service.ts builds a display name from these two.
    // If a future narrowing drops them, the orchestrator breaks at runtime
    // and its own fixtures would not notice - they return a hand-written
    // object rather than this method's real shape.
    const prisma = makePrisma();
    await new UsersService(prisma as never).findById('user-1');

    const select = selectArg(prisma);
    expect(select.firstName).toBe(true);
    expect(select.lastName).toBe(true);
    expect(select.facilityId).toBe(true);
  });

  it('selects exactly five facility fields and no others', async () => {
    // toEqual rather than individual checks: this fails if a field is
    // missing AND if one is added, which is the half that matters. The
    // absent fields are absent on purpose - address and coordinates would
    // put an estate's location into an identity response.
    const prisma = makePrisma();
    await new UsersService(prisma as never).findById('user-1');

    expect(selectArg(prisma).facility.select).toEqual({
      id: true,
      name: true,
      type: true,
      isActive: true,
      isVerified: true,
    });
  });

  it('never selects the password hash', async () => {
    // This response reaches the browser through the operator console bridge.
    const prisma = makePrisma();
    await new UsersService(prisma as never).findById('user-1');

    expect(selectArg(prisma).passwordHash).toBeUndefined();
  });
});