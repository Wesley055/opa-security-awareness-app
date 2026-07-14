import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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

  it('rejects invalid login credentials', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'user-id',
      email: 'ada@example.com',
      passwordHash: await bcrypt.hash('CorrectPassword123!', 10),
      isActive: true,
    });
    const service = new AuthService(usersService as never, jwtService as unknown as JwtService, config as never);
    await expect(service.login({ email: 'ada@example.com', password: 'WrongPassword123!' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});