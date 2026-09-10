import { BadRequestException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetService', () => {
  const genericMessage =
    'If an eligible OPA account exists for that email, password reset instructions will be sent.';

  const emailProvider = {
    send: jest.fn(),
  };

  const config = {
    get: jest.fn<string | undefined, [string]>(() => undefined),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'ENROLLMENT_ENCRYPTION_KEY') return 'ab'.repeat(32);
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
    accountInvitationDelivery: { create: jest.fn() },
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

  it.each([null, { ...activeUser }, { ...activeUser, isActive: false }])('durably queues identical reset work without querying identity or calling a provider (%p)', async (candidate) => {
    prisma.user.findUnique.mockResolvedValue(candidate);
    const result = await service.requestReset({ email: 'ADA@EXAMPLE.COM' });
    expect(result).toEqual({ message: genericMessage });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(prisma.accountInvitationDelivery.create).toHaveBeenCalledTimes(1);
    const data = prisma.accountInvitationDelivery.create.mock.calls[0][0].data;
    expect(data).toEqual({ purpose: 'PASSWORD_RESET', channel: 'EMAIL', recipient: '', status: 'QUEUED', requestCiphertext: expect.any(String) });
    expect(JSON.stringify(data)).not.toContain('example.com');
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
