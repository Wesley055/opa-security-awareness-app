import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
  };

  const guard = new AdminGuard(prisma as never);

  function context(tokenRole = 'USER') {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            sub: 'admin-1',
            email: 'admin@example.com',
            role: tokenRole,
          },
        }),
      }),
    } as never;
  }

  beforeEach(() => jest.clearAllMocks());

  it('allows a current active ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ADMIN',
      isActive: true,
    });

    await expect(guard.canActivate(context('USER'))).resolves.toBe(true);
  });

  it('rejects a stale ADMIN JWT after database demotion', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'USER',
      isActive: true,
    });

    await expect(
      guard.canActivate(context('ADMIN')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an administratively disabled ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: 'ADMIN',
      isActive: false,
    });

    await expect(
      guard.canActivate(context('ADMIN')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a missing account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(context('ADMIN')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
