import { NotificationStatus } from '@prisma/client';
import { NotificationChannel } from './dto/send-notification.dto';
import { NotificationService } from './notification.service';
import {
  buildNotificationPayload,
  NOTIFICATION_PAYLOAD_VERSION,
} from './notification-payload';

describe('NotificationService.dispatchNotification', () => {
  const prisma = {
    incidentNotification: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };

  const smsProvider = { send: jest.fn() };
  const whatsAppProvider = { send: jest.fn() };
  const pushProvider = { send: jest.fn() };
  const emailProvider = { send: jest.fn() };
  const voiceProvider = { send: jest.fn() };

  let service: NotificationService;

  const validPayload = buildNotificationPayload({
    channel: NotificationChannel.SMS,
    recipient: '+2348012345678',
    personName: 'Test User',
    location: 'https://maps.google.com/?q=6.6,3.3',
    trackingUrl: 'https://opasafety.com/incidents/incident-1',
  });

  const claimedRow = {
    id: 'notif-1',
    status: NotificationStatus.SENDING,
    payload: validPayload,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(
      prisma as never,
      smsProvider as never,
      whatsAppProvider as never,
      pushProvider as never,
      emailProvider as never,
      voiceProvider as never,
    );
    prisma.incidentNotification.update.mockResolvedValue({});
  });

  it('returns null when the notification does not exist', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue(null);

    const result = await service.dispatchNotification('missing');

    expect(result).toBeNull();
    expect(smsProvider.send).not.toHaveBeenCalled();
    expect(prisma.incidentNotification.update).not.toHaveBeenCalled();
  });

  it('skips rows that are not SENDING (not claimed by this worker)', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue({
      ...claimedRow,
      status: NotificationStatus.QUEUED,
    });

    const result = await service.dispatchNotification('notif-1');

    expect(result).toBeNull();
    expect(smsProvider.send).not.toHaveBeenCalled();
    expect(prisma.incidentNotification.update).not.toHaveBeenCalled();
  });

  it('fails the row when the payload is missing (legacy row)', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue({
      ...claimedRow,
      payload: null,
    });

    const result = await service.dispatchNotification('notif-1');

    expect(result).toBeNull();
    expect(smsProvider.send).not.toHaveBeenCalled();
    expect(prisma.incidentNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: expect.objectContaining({
          status: NotificationStatus.FAILED,
        }),
      }),
    );
  });

  it('fails the row when the payload version is unsupported', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue({
      ...claimedRow,
      payload: {
        ...validPayload,
        version: NOTIFICATION_PAYLOAD_VERSION + 1,
      },
    });

    const result = await service.dispatchNotification('notif-1');

    expect(result).toBeNull();
    expect(smsProvider.send).not.toHaveBeenCalled();
  });

  it('marks the row SENT on provider success and never increments attemptCount', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue(claimedRow);
    smsProvider.send.mockResolvedValue({
      success: true,
      provider: 'MockProvider',
      messageId: 'message-123',
    });

    const result = await service.dispatchNotification('notif-1');

    expect(result).toEqual(
      expect.objectContaining({ success: true, messageId: 'message-123' }),
    );

    const updateArgs = prisma.incidentNotification.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'notif-1' });
    expect(updateArgs.data.status).toBe(NotificationStatus.SENT);
    expect(updateArgs.data.providerMessageId).toBe('message-123');
    expect(updateArgs.data).not.toHaveProperty('attemptCount');
  });

  it('marks the row FAILED when the provider reports failure', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue(claimedRow);
    smsProvider.send.mockResolvedValue({
      success: false,
      provider: 'MockProvider',
      messageId: undefined,
    });

    await service.dispatchNotification('notif-1');

    const updateArgs = prisma.incidentNotification.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe(NotificationStatus.FAILED);
    expect(updateArgs.data.failedAt).toBeInstanceOf(Date);
    expect(updateArgs.data).not.toHaveProperty('attemptCount');
  });

  it('marks the row FAILED and does NOT rethrow when the provider throws', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue(claimedRow);
    smsProvider.send.mockRejectedValue(new Error('provider exploded'));

    const result = await service.dispatchNotification('notif-1');

    expect(result).toBeNull();
    const updateArgs = prisma.incidentNotification.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe(NotificationStatus.FAILED);
    expect(updateArgs.data.lastError).toBe('provider exploded');
  });

  it('never creates a notification row', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue(claimedRow);
    smsProvider.send.mockResolvedValue({
      success: true,
      provider: 'MockProvider',
      messageId: 'message-123',
    });

    await service.dispatchNotification('notif-1');

    expect(prisma.incidentNotification.create).not.toHaveBeenCalled();
  });

  it('fails the row when a required dispatch field is missing', async () => {
    const { recipient, ...withoutRecipient } = validPayload;
    prisma.incidentNotification.findUnique.mockResolvedValue({
      ...claimedRow,
      payload: withoutRecipient,
    });

    const result = await service.dispatchNotification('notif-1');

    expect(result).toBeNull();
    expect(smsProvider.send).not.toHaveBeenCalled();
    expect(prisma.incidentNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1' },
        data: expect.objectContaining({
          status: NotificationStatus.FAILED,
        }),
      }),
    );
  });

  it('fails the row when a required dispatch field is empty', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue({
      ...claimedRow,
      payload: { ...validPayload, message: '   ' },
    });

    const result = await service.dispatchNotification('notif-1');

    expect(result).toBeNull();
    expect(smsProvider.send).not.toHaveBeenCalled();
  });

  it('persists provider metadata on success', async () => {
    prisma.incidentNotification.findUnique.mockResolvedValue(claimedRow);
    smsProvider.send.mockResolvedValue({
      success: true,
      provider: 'MockProvider',
      messageId: 'message-123',
    });

    await service.dispatchNotification('notif-1');

    const updateArgs = prisma.incidentNotification.update.mock.calls[0][0];
    expect(updateArgs.data.provider).toBe('MockProvider');
    expect(updateArgs.data.providerMessageId).toBe('message-123');
    expect(updateArgs.data.sentAt).toBeInstanceOf(Date);
  });
});
