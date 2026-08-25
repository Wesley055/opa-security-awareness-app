import { BadRequestException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetService', () => {
  const genericMessage =
    'If an eligible OPA account exists for that email, password reset instructions have been sent.';

  const emailProvider = {
    send: jest.fn(),
  };

  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'BCRYPT_ROUNDS') {
        return 4;
      }
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };

  const tx = {
    $executeRaw: jest.fn(),
    passwordResetToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  const service = new PasswordResetService(
    prisma as never,
    config as never,
    emailProvider as never,
  );

  const activeUser = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'ada@example.com',
    isActive: true,
    accountStatus: AccountStatus.ACTIVE,
    passwordHash: 'existing-hash',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.user.findUnique.mockResolvedValue(activeUser);
    emailProvider.send.mockResolvedValue({
      success: true,
      provider: 'Email',
      messageId: 'email-1',
    });

    tx.$executeRaw.mockResolvedValue(0);
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    tx.passwordResetToken.create.mockResolvedValue({ id: 'reset-1' });
    tx.user.update.mockResolvedValue({ id: activeUser.id });
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
  });

  it('returns the same generic response for an unknown account and sends nothing', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.requestReset({
      email: 'missing@example.com',
    });

    expect(result).toEqual({ message: genericMessage });
    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns the same generic response for a suspended account and sends nothing', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      isActive: false,
    });

    const result = await service.requestReset({
      email: 'ada@example.com',
    });

    expect(result).toEqual({ message: genericMessage });
    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stores only a SHA-256 token hash and consumes previous live reset tokens', async () => {
    let createdData:
      | { userId: string; tokenHash: string; expiresAt: Date }
      | undefined;

    tx.passwordResetToken.create.mockImplementation(async ({ data }) => {
      createdData = data;
      return { id: 'reset-1', ...data };
    });

    const result = await service.requestReset({
      email: 'ADA@EXAMPLE.COM',
    });

    expect(result).toEqual({ message: genericMessage });

    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: activeUser.id,
        consumedAt: null,
      },
      data: {
        consumedAt: expect.any(Date),
      },
    });

    expect(createdData).toBeDefined();
    expect(createdData?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createdData?.expiresAt).toBeInstanceOf(Date);

    expect(emailProvider.send).toHaveBeenCalledTimes(1);
    const request = emailProvider.send.mock.calls[0][0];
    expect(request.recipient).toBe(activeUser.email);

    const rawToken = request.message
      .split('\n')
      .find((line: string) => /^[a-f0-9]{64}$/.test(line));

    expect(rawToken).toBeDefined();
    expect(rawToken).not.toBe(createdData?.tokenHash);
    expect(
      createHash('sha256').update(rawToken as string).digest('hex'),
    ).toBe(createdData?.tokenHash);
  });

  it('invalidates the newly created token when email delivery fails', async () => {
    emailProvider.send.mockResolvedValue({
      success: false,
      provider: 'Email',
      error: 'provider unavailable',
    });

    await service.requestReset({
      email: 'ada@example.com',
    });

    const created = tx.passwordResetToken.create.mock.calls[0][0].data;

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: created.tokenHash,
        consumedAt: null,
      },
      data: {
        consumedAt: expect.any(Date),
      },
    });
  });

  it('rejects an unknown reset token before bcrypt or transaction work', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);

    await expect(
      service.confirmReset({
        token: 'a'.repeat(64),
        password: 'NewStrongPassword123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an expired token under the per-user lock', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: activeUser.id,
    });

    tx.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: activeUser.id,
      tokenHash: createHash('sha256')
        .update('b'.repeat(64))
        .digest('hex'),
      expiresAt: new Date(Date.now() - 60_000),
      consumedAt: null,
      user: {
        id: activeUser.id,
        isActive: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    await expect(
      service.confirmReset({
        token: 'b'.repeat(64),
        password: 'NewStrongPassword123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects an already-consumed token', async () => {
    const rawToken = 'c'.repeat(64);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: activeUser.id,
    });

    tx.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: activeUser.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
      user: {
        id: activeUser.id,
        isActive: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    await expect(
      service.confirmReset({
        token: rawToken,
        password: 'NewStrongPassword123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('updates the password, increments credentialVersion, and consumes all live reset tokens', async () => {
    const rawToken = 'd'.repeat(64);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: activeUser.id,
    });

    tx.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: activeUser.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      user: {
        id: activeUser.id,
        isActive: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    const result = await service.confirmReset({
      token: rawToken,
      password: 'NewStrongPassword123!',
    });

    expect(result.message).toMatch(/password has been reset/i);

    expect(tx.user.update).toHaveBeenCalledWith({
      where: {
        id: activeUser.id,
      },
      data: {
        passwordHash: expect.any(String),
        credentialVersion: {
          increment: 1,
        },
      },
    });

    const update = tx.user.update.mock.calls[0][0];
    expect(update.data.passwordHash).not.toBe('NewStrongPassword123!');
    await expect(
      bcrypt.compare('NewStrongPassword123!', update.data.passwordHash),
    ).resolves.toBe(true);

    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: activeUser.id,
        consumedAt: null,
      },
      data: {
        consumedAt: expect.any(Date),
      },
    });
  });

  it('cannot successfully consume the same token twice', async () => {
    const rawToken = 'e'.repeat(64);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: activeUser.id,
    });

    tx.passwordResetToken.findUnique
      .mockResolvedValueOnce({
        id: 'reset-1',
        userId: activeUser.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
        user: {
          id: activeUser.id,
          isActive: true,
          accountStatus: AccountStatus.ACTIVE,
        },
      })
      .mockResolvedValueOnce({
        id: 'reset-1',
        userId: activeUser.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        user: {
          id: activeUser.id,
          isActive: true,
          accountStatus: AccountStatus.ACTIVE,
        },
      });

    await expect(
      service.confirmReset({
        token: rawToken,
        password: 'NewStrongPassword123!',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/password has been reset/i),
      }),
    );

    await expect(
      service.confirmReset({
        token: rawToken,
        password: 'AnotherStrongPassword123!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });
});