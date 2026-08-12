import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const usersService = {
    findByEmail: jest.fn(),
    findByPhone: jest.fn(),
    create: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const config = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        BCRYPT_ROUNDS: 10,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '30d',
      };
      return values[key];
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValueOnce('access').mockResolvedValueOnce('refresh');
  });

  it('registers a user with a hashed password', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.findByPhone.mockResolvedValue(null);
    usersService.create.mockResolvedValue({
      id: 'user-id',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Okafor',
      role: 'USER',
    });
    const service = new AuthService(usersService as never, jwtService as unknown as JwtService, config as never);
    const result = await service.register({
      email: 'Ada@Example.com',
      phoneNumber: '+2348012345678',
      password: 'StrongPassword123!',
      firstName: 'Ada',
      lastName: 'Okafor',
    });
    expect(usersService.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com' }));
    expect(usersService.create.mock.calls[0][0].passwordHash).not.toBe('StrongPassword123!');
    expect(result.accessToken).toBe('access');
  });

  it('rejects duplicate email registration', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 'existing' });
    const service = new AuthService(usersService as never, jwtService as unknown as JwtService, config as never);
    await expect(
      service.register({
        email: 'ada@example.com',
        phoneNumber: '+2348012345678',
        password: 'StrongPassword123!',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects duplicate phone number registration', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.findByPhone.mockResolvedValue({ id: 'existing' });
    const service = new AuthService(usersService as never, jwtService as unknown as JwtService, config as never);
    await expect(
      service.register({
        email: 'newemail@example.com',
        phoneNumber: '+2348012345678',
        password: 'StrongPassword123!',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // THE POSITIVE CASE, AND IT IS LOAD-BEARING.
  //
  // Before this, the suite held four tests and every one of them asserted
  // a failure. The lifecycle work adds three more. A login() that rejected
  // EVERY account would pass all seven. A rejection test can only show a
  // check is present; it takes an acceptance test to show it is selective.
  it('issues tokens for an active, activated account with the right password', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'user-id',
      email: 'ada@example.com',
      passwordHash: await bcrypt.hash('CorrectPassword123!', 10),
      isActive: true,
      accountStatus: AccountStatus.ACTIVE,
      firstName: 'Ada',
      lastName: 'Okafor',
      role: 'USER',
    });

    const service = new AuthService(
      usersService as never,
      jwtService as unknown as JwtService,
      config as never,
    );

    const result = await service.login({
      email: 'ada@example.com',
      password: 'CorrectPassword123!',
    });

    expect(result.accessToken).toBe('access');
    expect(result.refreshToken).toBe('refresh');
    expect(result.user.email).toBe('ada@example.com');
  });

  it('rejects a pending-activation seat before password comparison', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'operator-id',
      email: 'operator@example.com',
      passwordHash: null,
      isActive: true,
      accountStatus: AccountStatus.PENDING_ACTIVATION,
    });

    // NO SPY. bcrypt is a native module and its compare export is
    // non-configurable, so jest.spyOn cannot redefine it.
    //
    // The assertion below still proves the guard fires FIRST: passwordHash
    // is null here, and bcrypt.compare(password, null) rejects with its own
    // error. Getting UnauthorizedException rather than a bcrypt failure is
    // only possible if the lifecycle check returned before the comparison.
    const service = new AuthService(
      usersService as never,
      jwtService as unknown as JwtService,
      config as never,
    );

    await expect(
      service.login({
        email: 'operator@example.com',
        password: 'Anything123!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an administratively disabled but activated account', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'user-id',
      email: 'ada@example.com',
      passwordHash: await bcrypt.hash('CorrectPassword123!', 10),
      isActive: false,
      accountStatus: AccountStatus.ACTIVE,
    });

    const service = new AuthService(
      usersService as never,
      jwtService as unknown as JwtService,
      config as never,
    );

    // The correct password, refused on suspension alone.
    await expect(
      service.login({
        email: 'ada@example.com',
        password: 'CorrectPassword123!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an activated account that has no password hash', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'user-id',
      email: 'ada@example.com',
      passwordHash: null,
      isActive: true,
      accountStatus: AccountStatus.ACTIVE,
    });

    const service = new AuthService(
      usersService as never,
      jwtService as unknown as JwtService,
      config as never,
    );

    // A state no code path should produce, which is exactly why it is
    // pinned: it must be a 401, not a bcrypt exception.
    await expect(
      service.login({
        email: 'ada@example.com',
        password: 'CorrectPassword123!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid login credentials', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'user-id',
      email: 'ada@example.com',
      passwordHash: await bcrypt.hash('CorrectPassword123!', 10),
      isActive: true,
      // Without this the lifecycle check below rejects on undefined, and
      // this test passes without ever reaching bcrypt.compare - green, and
      // no longer a test of credentials at all.
      accountStatus: AccountStatus.ACTIVE,
    });
    const service = new AuthService(usersService as never, jwtService as unknown as JwtService, config as never);
    await expect(service.login({ email: 'ada@example.com', password: 'WrongPassword123!' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});