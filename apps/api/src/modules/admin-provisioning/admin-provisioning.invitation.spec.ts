import { ConflictException } from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import { AdminProvisioningService } from './admin-provisioning.service';

describe('AdminProvisioningService invitation visibility + resend', () => {
  let service: AdminProvisioningService;

  const prisma: any = {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
    },
    accountInvitationDelivery: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(undefined),
        user: prisma.user,
        accountInvitationDelivery: prisma.accountInvitationDelivery,
      };
      return callback(tx);
    });

    service = new AdminProvisioningService(prisma);
  });

  it('returns bounded minimal history and derives a five-minute resend cooldown', async () => {
    const queuedAt = new Date(Date.now() - 60_000);
    const rawError = 'X'.repeat(400);

    prisma.user.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      role: UserRole.USER,
      facilityId: '22222222-2222-2222-2222-222222222222',
      isActive: true,
      accountStatus: AccountStatus.PENDING_ACTIVATION,
      activatedAt: null,
    });

    prisma.accountInvitationDelivery.findMany.mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        channel: 'SMS',
        status: 'FAILED',
        attemptCount: 1,
        lastError: rawError,
        queuedAt,
        nextAttemptAt: queuedAt,
        lastAttemptAt: queuedAt,
        sentAt: null,
        failedAt: queuedAt,
        createdAt: queuedAt,
        recipient: '+2348000000000',
        providerMessageId: 'must-not-leak',
      },
    ]);

    const result = await service.getResidentInvitation(
      '11111111-1111-1111-1111-111111111111',
    );

    expect(prisma.accountInvitationDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
    expect(result.canResend).toBe(false);
    expect(result.resendAvailableAt).toBeInstanceOf(Date);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]!.lastError).toHaveLength(300);
    expect(result.history[0]!).not.toHaveProperty('recipient');
    expect(result.history[0]!).not.toHaveProperty('providerMessageId');
  });

  it('creates a new queued delivery under the per-user lock without rotating credentials', async () => {
    const oldTime = new Date(Date.now() - 6 * 60_000);

    prisma.user.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      role: UserRole.USER,
      facilityId: '22222222-2222-2222-2222-222222222222',
      phoneNumber: '+2348000000000',
      isActive: true,
      accountStatus: AccountStatus.PENDING_ACTIVATION,
    });

    prisma.accountInvitationDelivery.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        lastAttemptAt: oldTime,
        queuedAt: oldTime,
        createdAt: oldTime,
      });

    prisma.accountInvitationDelivery.create.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      channel: 'SMS',
      status: 'QUEUED',
      queuedAt: new Date(),
      nextAttemptAt: new Date(),
    });

    const result = await service.resendResidentInvitation(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '11111111-1111-1111-1111-111111111111',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.accountInvitationDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: '11111111-1111-1111-1111-111111111111',
          invitedByUserId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          channel: 'SMS',
          status: 'QUEUED',
        }),
      }),
    );
    expect(result.delivery.status).toBe('QUEUED');

    const createData =
      prisma.accountInvitationDelivery.create.mock.calls[0][0].data;
    expect(createData).not.toHaveProperty('activationTokenHash');
    expect(createData).not.toHaveProperty('activationExpiresAt');
  });

  it('refuses resend while another invitation is queued or sending', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      role: UserRole.USER,
      facilityId: '22222222-2222-2222-2222-222222222222',
      phoneNumber: '+2348000000000',
      isActive: true,
      accountStatus: AccountStatus.PENDING_ACTIVATION,
    });

    prisma.accountInvitationDelivery.findFirst.mockResolvedValueOnce({
      id: '33333333-3333-3333-3333-333333333333',
      status: 'QUEUED',
    });

    await expect(
      service.resendResidentInvitation(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.accountInvitationDelivery.create).not.toHaveBeenCalled();
  });

  it('enforces the five-minute resend cooldown after a terminal delivery', async () => {
    const recent = new Date(Date.now() - 4 * 60_000);

    prisma.user.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      role: UserRole.USER,
      facilityId: '22222222-2222-2222-2222-222222222222',
      phoneNumber: '+2348000000000',
      isActive: true,
      accountStatus: AccountStatus.PENDING_ACTIVATION,
    });

    prisma.accountInvitationDelivery.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        lastAttemptAt: recent,
        queuedAt: recent,
        createdAt: recent,
      });

    await expect(
      service.resendResidentInvitation(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.accountInvitationDelivery.create).not.toHaveBeenCalled();
  });

  it('refuses resend for an already-active resident', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      role: UserRole.USER,
      facilityId: '22222222-2222-2222-2222-222222222222',
      phoneNumber: '+2348000000000',
      isActive: true,
      accountStatus: AccountStatus.ACTIVE,
    });

    await expect(
      service.resendResidentInvitation(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.accountInvitationDelivery.create).not.toHaveBeenCalled();
  });
});
