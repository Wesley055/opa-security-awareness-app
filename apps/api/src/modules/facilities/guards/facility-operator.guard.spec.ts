import { ForbiddenException } from '@nestjs/common';
import { FacilityOperatorGuard } from './facility-operator.guard';

describe('FacilityOperatorGuard', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
  };

  const guard = new FacilityOperatorGuard(prisma as never);

  const context = (
    tokenRole = 'USER',
    facilityId = 'facility-a',
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            sub: 'user-1',
            email: 'operator@example.com',
            role: tokenRole,
          },
          params: { facilityId },
        }),
      }),
    }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('allows an operator assigned to the requested facility', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_OPERATOR',
      facilityId: 'facility-a',
      isActive: true,
    });

    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it('denies an operator assigned to another facility', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_OPERATOR',
      facilityId: 'facility-b',
      isActive: true,
    });

    await expect(
      guard.canActivate(context('FACILITY_OPERATOR')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies USER even when facilityId matches', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'USER',
      facilityId: 'facility-a',
      isActive: true,
    });

    // The token also says USER. Passing a privileged token role here would
    // make this a duplicate of the stale-JWT test below rather than a test
    // of an ordinary resident.
    await expect(
      guard.canActivate(context('USER')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows ADMIN across facilities', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ADMIN',
      facilityId: null,
      isActive: true,
    });

    await expect(
      guard.canActivate(context('USER', 'facility-b')),
    ).resolves.toBe(true);
  });

  it('uses database truth over a stale privileged JWT', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'USER',
      facilityId: 'facility-a',
      isActive: true,
    });

    await expect(
      guard.canActivate(context('FACILITY_OPERATOR')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // SUSPENSION. Before 13C-6-2 this guard did not read isActive at all, so
  // a suspended operator kept their facility's live emergency queue until
  // their access token expired.
  it('denies a suspended operator whose facility matches', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'FACILITY_OPERATOR',
      facilityId: 'facility-a',
      isActive: false,
    });

    await expect(
      guard.canActivate(context('FACILITY_OPERATOR')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a suspended ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ADMIN',
      facilityId: null,
      isActive: false,
    });

    // AdminGuard already refuses a suspended administrator. If this guard
    // let one through, the two would disagree about the same account.
    await expect(
      guard.canActivate(context('ADMIN', 'facility-b')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when the user row no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(context('FACILITY_OPERATOR')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});