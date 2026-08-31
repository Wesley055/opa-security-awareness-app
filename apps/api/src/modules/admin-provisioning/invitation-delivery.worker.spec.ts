import {
  AccountStatus,
  NotificationStatus,
  UserRole,
} from '@prisma/client';
import { InvitationDeliveryWorker } from './invitation-delivery.worker';

describe('InvitationDeliveryWorker', () => {
  const prisma = {
    $transaction: jest.fn(),
    accountInvitationDelivery: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
  };

  const smsProvider = {
    send: jest.fn(),
  };

  let worker: InvitationDeliveryWorker;

  const dueDelivery = {
    id: 'delivery-1',
    userId: 'resident-1',
    facilityId: 'facility-1',
    invitedByUserId: 'admin-1',
    channel: 'SMS',
    status: NotificationStatus.SENDING,
    recipient: '+2348024662124',
    provider: null,
    providerMessageId: null,
    attemptCount: 1,
    lastError: null,
    queuedAt: new Date('2026-08-31T10:00:00.000Z'),
    nextAttemptAt: new Date('2026-08-31T10:00:00.000Z'),
    lastAttemptAt: new Date('2026-08-31T10:00:01.000Z'),
    sentAt: null,
    failedAt: null,
    createdAt: new Date('2026-08-31T10:00:00.000Z'),
    updatedAt: new Date('2026-08-31T10:00:01.000Z'),
    facility: {
      name: 'Ikeja Gardens',
      isActive: true,
    },
    user: {
      id: 'resident-1',
      role: UserRole.USER,
      isActive: true,
      accountStatus: AccountStatus.PENDING_ACTIVATION as AccountStatus,
      facilityId: 'facility-1',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );

    prisma.accountInvitationDelivery.updateMany.mockResolvedValue({ count: 0 });
    prisma.accountInvitationDelivery.findFirst.mockResolvedValue(null);

    worker = new InvitationDeliveryWorker(
      prisma as never,
      smsProvider as never,
    );
  });

  async function queueOneClaim(
    overrides: Partial<typeof dueDelivery> = {},
  ): Promise<void> {
    const delivery = {
      ...dueDelivery,
      ...overrides,
      facility: {
        ...dueDelivery.facility,
        ...(overrides.facility ?? {}),
      },
      user: {
        ...dueDelivery.user,
        ...(overrides.user ?? {}),
      },
    };

    prisma.accountInvitationDelivery.findFirst
      .mockResolvedValueOnce({
        id: delivery.id,
      })
      .mockResolvedValueOnce(null);

    prisma.accountInvitationDelivery.updateMany
      .mockResolvedValueOnce({ count: 0 }) // stale recovery
      .mockResolvedValueOnce({ count: 1 }); // optimistic claim

    prisma.accountInvitationDelivery.findUnique.mockResolvedValue(delivery);
    prisma.user.update.mockResolvedValue({ id: 'resident-1' });
  }

  it('claims a due row, mints the credential only after claim, and sends the settled SMS contract', async () => {
    await queueOneClaim();

    smsProvider.send.mockResolvedValue({
      success: true,
      provider: 'SMS',
      messageId: 'provider-1',
    });

    await worker.tick();

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'resident-1' },
      data: {
        activationTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        activationExpiresAt: expect.any(Date),
      },
    });

    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    const request = smsProvider.send.mock.calls[0][0];

    expect(request.recipient).toBe('+2348024662124');
    expect(request.message).toMatch(
      /^OPA: Ikeja Gardens has added you to emergency protection\.\n\nYour code: [0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}\n\nOpen OPA and enter this code\. Expires in 24 hours\.$/,
    );
    expect(request.message.length).toBeLessThanOrEqual(160);

    expect(prisma.accountInvitationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        status: NotificationStatus.SENT,
        provider: 'SMS',
        providerMessageId: 'provider-1',
        sentAt: expect.any(Date),
        failedAt: null,
        lastError: null,
      }),
    });
  });

  it('sanitizes non-GSM facility characters and shortens only at word boundaries', async () => {
    await queueOneClaim({
      facility: {
        name: 'Ikeja Gardens Residents Association Phase 2 Extension Ã°Å¸ÂÂ¡',
        isActive: true,
      },
    });

    smsProvider.send.mockResolvedValue({
      success: true,
      provider: 'SMS',
      messageId: 'provider-2',
    });

    await worker.tick();

    const message = smsProvider.send.mock.calls[0][0].message as string;

    expect(message).not.toContain('Ã°Å¸ÂÂ¡');
    expect(message.length).toBeLessThanOrEqual(160);
    expect(message).toMatch(/^OPA: Ikeja Gardens/);
    expect(message).not.toMatch(/Extens[^i]/);
  });

  it('requeues a retryable provider failure with backoff', async () => {
    await queueOneClaim();

    smsProvider.send.mockResolvedValue({
      success: false,
      provider: 'SMS',
      error: 'temporary network error',
    });

    await worker.tick();

    expect(prisma.accountInvitationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        status: NotificationStatus.QUEUED,
        provider: 'SMS',
        nextAttemptAt: expect.any(Date),
        failedAt: null,
        lastError: 'temporary network error',
      }),
    });
  });

  it('fails immediately for an invalid phone response', async () => {
    await queueOneClaim();

    smsProvider.send.mockResolvedValue({
      success: false,
      provider: 'SMS',
      error: "Africa's Talking status: InvalidPhoneNumber",
    });

    await worker.tick();

    expect(prisma.accountInvitationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        status: NotificationStatus.FAILED,
        failedAt: expect.any(Date),
        lastError: "Africa's Talking status: InvalidPhoneNumber",
      }),
    });
  });

  it('fails after the fifth unsuccessful attempt instead of requeueing forever', async () => {
    await queueOneClaim({ attemptCount: 5 });

    smsProvider.send.mockResolvedValue({
      success: false,
      provider: 'SMS',
      error: 'temporary network error',
    });

    await worker.tick();

    expect(prisma.accountInvitationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        status: NotificationStatus.FAILED,
        failedAt: expect.any(Date),
        lastError: 'temporary network error',
      }),
    });
  });

  it('recovers stale SENDING rows before claiming new work', async () => {
    prisma.accountInvitationDelivery.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await worker.tick();

    expect(
      prisma.accountInvitationDelivery.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        status: NotificationStatus.SENDING,
        lastAttemptAt: { lte: expect.any(Date) },
      },
      data: {
        status: NotificationStatus.QUEUED,
        nextAttemptAt: expect.any(Date),
        lastError: 'Recovered stale sending attempt.',
      },
    });
  });

  it('fails a claimed row without sending when resident eligibility changed', async () => {
    await queueOneClaim({
      user: {
        ...dueDelivery.user,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    await worker.tick();

    expect(smsProvider.send).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.accountInvitationDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: NotificationStatus.FAILED,
        failedAt: expect.any(Date),
        lastError: 'Resident is no longer eligible for activation.',
      },
    });
  });
});