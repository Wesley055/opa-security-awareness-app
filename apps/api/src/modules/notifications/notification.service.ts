import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  NotificationChannel as PrismaNotificationChannel,
  NotificationStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  buildEmergencyMessage,
  isNotificationPayloadV1,
} from './notification-payload';
import {
  NotificationChannel,
  SendNotificationDto,
} from './dto/send-notification.dto';
import { EmailProvider } from './providers/email.provider';
import type {
  NotificationProvider,
  NotificationResponse,
} from './providers/notification-provider.interface';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';
import { VoiceProvider } from './providers/voice.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';

@Injectable()
export class NotificationService {
  private readonly providers: Record<
    NotificationChannel,
    NotificationProvider
  >;

  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsProvider: SmsProvider,
    private readonly whatsAppProvider: WhatsAppProvider,
    private readonly pushProvider: PushProvider,
    private readonly emailProvider: EmailProvider,
    private readonly voiceProvider: VoiceProvider,
  ) {
    this.providers = {
      [NotificationChannel.SMS]: this.smsProvider,
      [NotificationChannel.WHATSAPP]: this.whatsAppProvider,
      [NotificationChannel.PUSH]: this.pushProvider,
      [NotificationChannel.EMAIL]: this.emailProvider,
      [NotificationChannel.VOICE]: this.voiceProvider,
    };
  }

  async send(
    dto: SendNotificationDto,
  ): Promise<NotificationResponse> {
    const provider = this.providers[dto.channel];

    if (!provider) {
      throw new BadRequestException(
        `Unsupported notification channel: ${dto.channel}`,
      );
    }

    const recipient = dto.recipient.trim();
    const message = dto.message.trim();

    if (!recipient) {
      throw new BadRequestException(
        'Notification recipient cannot be empty.',
      );
    }

    if (!message) {
      throw new BadRequestException(
        'Notification message cannot be empty.',
      );
    }

    return provider.send({
      recipient,
      subject: dto.subject?.trim(),
      message,
    });
  }

  async sendEmergencyAlert(params: {
    notificationId?: string;
    incidentId: string;
    contactId?: string;
    contactName: string;
    contactType: string;
    recipient: string;
    channel: NotificationChannel;
    personName: string;
    location: string;
    trackingUrl: string;
  }): Promise<NotificationResponse> {
    const message = buildEmergencyMessage({
      personName: params.personName,
      location: params.location,
      trackingUrl: params.trackingUrl,
    });

      // If the orchestrator pre-created a durable QUEUED row (outbox
      // pattern), update THAT row to SENDING instead of creating a second
      // one. Falls back to create() for any legacy caller without an id.
      const notification = params.notificationId
        ? await this.prisma.incidentNotification.update({
            where: { id: params.notificationId },
            data: {
              status: NotificationStatus.SENDING,
              attemptCount: { increment: 1 },
            },
          })
        : await this.prisma.incidentNotification.create({
            data: {
              incidentId: params.incidentId,
              contactId: params.contactId,
              contactName: params.contactName.trim(),
              contactType: params.contactType.trim(),
              recipient: params.recipient.trim(),
              channel: this.toPrismaChannel(params.channel),
              status: NotificationStatus.SENDING,
              attemptCount: 1,
            },
          });

    try {
      const result = await this.send({
        channel: params.channel,
        recipient: params.recipient,
        subject: 'OPA Emergency Alert',
        message,
      });

      if (result.success) {
        await this.prisma.incidentNotification.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.SENT,
            provider: result.provider,
            providerMessageId: result.messageId,
            sentAt: new Date(),
            failedAt: null,
            lastError: null,
          },
        });
      } else {
        await this.prisma.incidentNotification.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.FAILED,
            provider: result.provider,
            providerMessageId: result.messageId,
            failedAt: new Date(),
            lastError:
              this.getResponseError(result) ??
              'Notification provider reported failure.',
          },
        });
      }

      return result;
    } catch (error) {
      await this.prisma.incidentNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.FAILED,
          failedAt: new Date(),
          lastError:
            error instanceof Error
              ? error.message
              : 'Unknown provider error',
        },
      });

      throw error;
    }
  }

  private toPrismaChannel(
    channel: NotificationChannel,
  ): PrismaNotificationChannel {
    switch (channel) {
      case NotificationChannel.SMS:
        return PrismaNotificationChannel.SMS;

      case NotificationChannel.WHATSAPP:
        return PrismaNotificationChannel.WHATSAPP;

      case NotificationChannel.PUSH:
        return PrismaNotificationChannel.PUSH;

      case NotificationChannel.EMAIL:
        return PrismaNotificationChannel.EMAIL;

      case NotificationChannel.VOICE:
        return PrismaNotificationChannel.VOICE;

      default:
        throw new BadRequestException(
          `Unsupported notification channel: ${channel}`,
        );
    }
  }

  private getResponseError(
    result: NotificationResponse,
  ): string | undefined {
    if (
      'error' in result &&
      typeof result.error === 'string'
    ) {
      return result.error;
    }

    return undefined;
  }

  /**
   * Dispatch a notification row that the worker has ALREADY claimed.
   *
   * Contract (Phase 2c-2):
   *  - The row must already be SENDING (claimNextQueued did the atomic
   *    QUEUED -> SENDING transition and the attemptCount increment).
   *  - This method NEVER creates a row and NEVER increments attemptCount.
   *  - Everything needed to deliver is read from the durable payload, so no
   *    Incident/User lookups happen here.
   *  - It does not rethrow: a failing notification is marked FAILED and the
   *    caller (the worker batch loop) continues with the next row.
   */
  async dispatchNotification(
    notificationId: string,
  ): Promise<NotificationResponse | null> {
    const notification =
      await this.prisma.incidentNotification.findUnique({
        where: { id: notificationId },
      });

    if (!notification) {
      this.logger.warn(
        `dispatchNotification: notification ${notificationId} not found.`,
      );
      return null;
    }

    if (notification.status !== NotificationStatus.SENDING) {
      this.logger.warn(
        `dispatchNotification: ${notificationId} is ${notification.status}, expected SENDING. Skipping.`,
      );
      return null;
    }

    if (!isNotificationPayloadV1(notification.payload)) {
      await this.prisma.incidentNotification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.FAILED,
          failedAt: new Date(),
          lastError: 'Missing or unsupported notification payload.',
        },
      });
      this.logger.error(
        `dispatchNotification: ${notificationId} has no dispatchable payload.`,
      );
      return null;
    }

    const payload = notification.payload;

    try {
      const result = await this.send({
        channel: payload.channel,
        recipient: payload.recipient,
        subject: payload.subject,
        message: payload.message,
      });

      if (result.success) {
        await this.prisma.incidentNotification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.SENT,
            provider: result.provider,
            providerMessageId: result.messageId,
            sentAt: new Date(),
            failedAt: null,
            lastError: null,
          },
        });
      } else {
        await this.prisma.incidentNotification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.FAILED,
            provider: result.provider,
            providerMessageId: result.messageId,
            failedAt: new Date(),
            lastError:
              this.getResponseError(result) ??
              'Notification provider reported failure.',
          },
        });
      }

      return result;
    } catch (error) {
      await this.prisma.incidentNotification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.FAILED,
          failedAt: new Date(),
          lastError:
            error instanceof Error
              ? error.message
              : 'Unknown provider error',
        },
      });
      return null;
    }
  }
}
