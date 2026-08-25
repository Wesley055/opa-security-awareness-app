import { UnauthorizedException } from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  const jwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const configService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '30d',
      };
      return values[key];
    }),
  };

  const prisma = {
    user: { findUnique: jest.fn() },
  };

  const service = new RefreshTokenService(
    jwtService as never,
    configService as never,
    prisma as never,
  );

  const activeRow = {
    id: 'user-1',
    email: 'ada@example.com',
    role: UserRole.USER,
    isActive: true,
    accountStatus: AccountStatus.ACTIVE,
    credentialVersion: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      email: 'ada@example.com',
      role: UserRole.USER,
      credentialVersion: 0,
      tokenType: 'refresh',
    });
    jwtService.sign
      .mockReturnValueOnce('new-access')
      .mockReturnValueOnce('new-refresh');
    prisma.user.findUnique.mockResolvedValue(activeRow);
  });

  it('issues a new pair for an active, activated account', async () => {
    const result = await service.rotate('a-refresh-token');

    expect(result.accessToken).toBe('new-access');
    expect(result.refreshToken).toBe('new-refresh');
  });

  it('reads the account rather than trusting the signature alone', async () => {
    await service.rotate('a-refresh-token');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        accountStatus: true,
        credentialVersion: true,
      },
    });
  });

  // THE ONE THAT DEFINES THE FIX. Before this, suspension stopped login()
  // and nothing else: the holder kept rotating for 30 days, and each
  // rotation extended the window.
  it('refuses to rotate a refresh token issued before the credential version changed', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      email: 'ada@example.com',
      role: UserRole.USER,
      credentialVersion: 0,
      tokenType: 'refresh',
    });

    prisma.user.findUnique.mockResolvedValue({
      ...activeRow,
      credentialVersion: 1,
    });

    await expect(
      service.rotate('a-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(jwtService.sign).not.toHaveBeenCalled();
  });
  it('refuses to rotate for a suspended account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...activeRow,
      isActive: false,
    });

    await expect(
      service.rotate('a-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('refuses to rotate for a seat that was never activated', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...activeRow,
      accountStatus: AccountStatus.PENDING_ACTIVATION,
    });

    await expect(
      service.rotate('a-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('refuses to rotate for a user row that no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.rotate('a-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  // THE STALE CLAIM IS IGNORED, NOT REJECTED. A demoted admin's old token
  // still carries ADMIN; rotating it must succeed and must not carry the
  // stale role forward.
  it('mints the new pair from the database role, not the token claim', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      email: 'stale@example.com',
      role: UserRole.ADMIN,
      tokenType: 'refresh',
    });
    prisma.user.findUnique.mockResolvedValue({
      ...activeRow,
      role: UserRole.USER,
      email: 'ada@example.com',
    });

    await service.rotate('a-refresh-token');

    const accessPayload = jwtService.sign.mock.calls[0][0];
    const refreshPayload = jwtService.sign.mock.calls[1][0];

    expect(accessPayload.role).toBe(UserRole.USER);
    expect(refreshPayload.role).toBe(UserRole.USER);

    // The email is taken from the row too, so a changed address does not
    // persist in tokens until the user logs out.
    expect(accessPayload.email).toBe('ada@example.com');
  });

  it('rejects a token that is not a refresh token', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'user-1',
      email: 'ada@example.com',
      tokenType: 'access',
    });

    await expect(
      service.rotate('an-access-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // The wrong token type is refused before any database work.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unverifiable token without reading the database', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad signature');
    });

    await expect(
      service.rotate('garbage'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('gives the same message for a suspended account as for a bad token', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...activeRow,
      isActive: false,
    });

    const suspended = await service
      .rotate('a-refresh-token')
      .catch((error: Error) => error.message);

    jest.clearAllMocks();
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad signature');
    });

    const garbage = await service
      .rotate('garbage')
      .catch((error: Error) => error.message);

    // Distinguishing them would tell an unauthenticated caller that an
    // account exists and has been suspended.
    expect(suspended).toBe(garbage);
  });
});