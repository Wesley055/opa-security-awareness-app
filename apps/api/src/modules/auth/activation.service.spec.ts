import { UnauthorizedException } from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { ActivationService } from './activation.service';

describe('ActivationService', () => {
  const prisma = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const config = {
    getOrThrow: jest.fn(() => 10),
  };

  const service = new ActivationService(prisma as never, config as never);

  const RAW_TOKEN = 'a-raw-activation-token';
  const TOKEN_HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');

  const pendingSeat = () => ({
    id: 'operator-1',
    email: 'operator@example.com',
    isActive: true,
    role: UserRole.FACILITY_OPERATOR,
    accountStatus: AccountStatus.PENDING_ACTIVATION,
    activationTokenHash: TOKEN_HASH,
    activationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.$executeRaw.mockResolvedValue(undefined);
    prisma.user.update.mockResolvedValue({
      id: 'operator-1',
      email: 'operator@example.com',
      role: UserRole.FACILITY_OPERATOR,
      accountStatus: AccountStatus.ACTIVE,
    });
  });

  it('activates a pending seat and clears the token', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'operator-1' })
      .mockResolvedValueOnce(pendingSeat());

    await service.activate({
      token: RAW_TOKEN,
      password: 'AnOperatorPassword1!',
    });

    const data = prisma.user.update.mock.calls[0][0].data;

    expect(data.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(data.activatedAt).toBeInstanceOf(Date);

    // Nulling the hash is what makes the token single-use. If this ever
    // stops happening the same link works forever.
    expect(data.activationTokenHash).toBeNull();
    expect(data.activationExpiresAt).toBeNull();
  });

  it('stores a bcrypt hash and never the raw password', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'operator-1' })
      .mockResolvedValueOnce(pendingSeat());

    await service.activate({
      token: RAW_TOKEN,
      password: 'AnOperatorPassword1!',
    });

    const data = prisma.user.update.mock.calls[0][0].data;

    expect(data.passwordHash).not.toBe('AnOperatorPassword1!');
    expect(data.passwordHash.startsWith('$2')).toBe(true);
    await expect(
      bcrypt.compare('AnOperatorPassword1!', data.passwordHash),
    ).resolves.toBe(true);
  });

  it('looks the token up by hash, never by raw value', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'operator-1' })
      .mockResolvedValueOnce(pendingSeat());

    await service.activate({
      token: RAW_TOKEN,
      password: 'AnOperatorPassword1!',
    });

    const where = prisma.user.findUnique.mock.calls[0][0].where;
    expect(where.activationTokenHash).toBe(TOKEN_HASH);
    expect(JSON.stringify(where)).not.toContain(RAW_TOKEN);
  });

  it('rejects an unknown token without opening a transaction', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.activate({ token: 'nope', password: 'AnOperatorPassword1!' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'operator-1' })
      .mockResolvedValueOnce({
        ...pendingSeat(),
        activationExpiresAt: new Date(Date.now() - 1000),
      });

    await expect(
      service.activate({
        token: RAW_TOKEN,
        password: 'AnOperatorPassword1!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an account that is already ACTIVE', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'operator-1' })
      .mockResolvedValueOnce({
        ...pendingSeat(),
        accountStatus: AccountStatus.ACTIVE,
      });

    await expect(
      service.activate({
        token: RAW_TOKEN,
        password: 'AnOperatorPassword1!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a suspended seat', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'operator-1' })
      .mockResolvedValueOnce({ ...pendingSeat(), isActive: false });

    await expect(
      service.activate({
        token: RAW_TOKEN,
        password: 'AnOperatorPassword1!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('activates a pending provisioned resident', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'resident-1' })
      .mockResolvedValueOnce({
        ...pendingSeat(),
        id: 'resident-1',
        email: 'resident@example.com',
        role: UserRole.USER,
      });

    prisma.user.update.mockResolvedValueOnce({
      id: 'resident-1',
      email: 'resident@example.com',
      role: UserRole.USER,
      accountStatus: AccountStatus.ACTIVE,
    });

    const result = await service.activate({
      token: RAW_TOKEN,
      password: 'AResidentPassword1!',
    });

    expect(result.role).toBe(UserRole.USER);

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(data.activationTokenHash).toBeNull();
    expect(data.activationExpiresAt).toBeNull();
    expect(data.activatedAt).toBeInstanceOf(Date);
  });

  it('refuses to activate a role outside the provisioned account set', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'admin-1' })
      .mockResolvedValueOnce({
        ...pendingSeat(),
        id: 'admin-1',
        role: UserRole.ADMIN,
      });

    await expect(
      service.activate({
        token: RAW_TOKEN,
        password: 'AnAdminPassword1!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects when the token changed before the deciding locked read', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'operator-1' })
      .mockResolvedValueOnce({
        ...pendingSeat(),
        activationTokenHash: 'different-token-hash',
      });

    await expect(
      service.activate({
        token: RAW_TOKEN,
        password: 'AnOperatorPassword1!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // THE CONCURRENCY CASE, AND IT IS THE REASON THE RE-READ EXISTS.
  it('rejects a second activation whose token was cleared under the lock', async () => {
    prisma.user.findUnique
      // The pre-lock lookup still finds the row: this request read the
      // token hash before the winner nulled it.
      .mockResolvedValueOnce({ id: 'operator-1' })
      // Under the lock, the winner has already committed.
      .mockResolvedValueOnce({
        ...pendingSeat(),
        accountStatus: AccountStatus.ACTIVE,
        activationTokenHash: null,
        activationExpiresAt: null,
      });

    await expect(
      service.activate({
        token: RAW_TOKEN,
        password: 'ADifferentPassword1!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('takes the user lock before re-reading the seat', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'operator-1' })
      .mockResolvedValueOnce(pendingSeat());

    await service.activate({
      token: RAW_TOKEN,
      password: 'AnOperatorPassword1!',
    });

    const lockOrder = prisma.$executeRaw.mock.invocationCallOrder[0];
    const reReadOrder = prisma.user.findUnique.mock.invocationCallOrder[1];
    const updateOrder = prisma.user.update.mock.invocationCallOrder[0];

    if (
      lockOrder === undefined ||
      reReadOrder === undefined ||
      updateOrder === undefined
    ) {
      throw new Error('Expected a lock, a re-read and an update.');
    }

    // The pre-lock lookup may precede the lock; the DECIDING read must not.
    expect(lockOrder).toBeLessThan(reReadOrder);
    expect(reReadOrder).toBeLessThan(updateOrder);
  });
});
