import { NotificationStatus } from '@prisma/client';
import { NotificationDispatchWorker } from './notification-dispatch.worker';

describe('NotificationDispatchWorker', () => {
  const prisma = {
    incidentNotification: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const notificationService = {
    dispatchNotification: jest.fn(),
  };

  let worker: NotificationDispatchWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new NotificationDispatchWorker(
      prisma as never,
      notificationService as never,
    );
  });

  // The claim method is private; reach it through a narrow cast rather than
  // widening its visibility purely for tests.
  const claim = () =>
    (worker as unknown as {
      claimNextQueued: () => Promise<unknown>;
    }).claimNextQueued();

  it('returns null and does not attempt a claim when the queue is empty', async () => {
    prisma.incidentNotification.findFirst.mockResolvedValue(null);

    const result = await claim();

    expect(result).toBeNull();
    expect(prisma.incidentNotification.findFirst).toHaveBeenCalledWith({
      where: { status: NotificationStatus.QUEUED },
      orderBy: { queuedAt: 'asc' },
    });
    expect(prisma.incidentNotification.updateMany).not.toHaveBeenCalled();
  });

  it('returns the candidate when the atomic claim updates exactly one row', async () => {
    const candidate = { id: 'notif-1', status: NotificationStatus.QUEUED };
    prisma.incidentNotification.findFirst.mockResolvedValue(candidate);
    prisma.incidentNotification.updateMany.mockResolvedValue({ count: 1 });

    const result = await claim();

    expect(result).toBe(candidate);
    expect(prisma.incidentNotification.updateMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', status: NotificationStatus.QUEUED },
      data: {
        status: NotificationStatus.SENDING,
        attemptCount: { increment: 1 },
        failedAt: null,
        lastError: null,
      },
    });
  });

  it('returns null when another worker already claimed the row (count 0)', async () => {
    const candidate = { id: 'notif-2', status: NotificationStatus.QUEUED };
    prisma.incidentNotification.findFirst.mockResolvedValue(candidate);
    prisma.incidentNotification.updateMany.mockResolvedValue({ count: 0 });

    const result = await claim();

    expect(result).toBeNull();
    // The conditional update must still have been attempted (that is how we
    // detect we lost the race).
    expect(prisma.incidentNotification.updateMany).toHaveBeenCalledWith({
      where: { id: 'notif-2', status: NotificationStatus.QUEUED },
      data: {
        status: NotificationStatus.SENDING,
        attemptCount: { increment: 1 },
        failedAt: null,
        lastError: null,
      },
    });
  });

  it('propagates a query failure', async () => {
    prisma.incidentNotification.findFirst.mockRejectedValue(
      new Error('db unavailable'),
    );

    await expect(claim()).rejects.toThrow('db unavailable');
  });
});
