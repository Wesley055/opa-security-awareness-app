import { BadRequestException, Injectable } from '@nestjs/common';
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

  constructor(
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

  async send(dto: SendNotificationDto): Promise<NotificationResponse> {
    const provider = this.providers[dto.channel];

    if (!provider) {
      throw new BadRequestException(
        `Unsupported notification channel: ${dto.channel}`,
      );
    }

    const message = dto.message.trim();

    if (!message) {
      throw new BadRequestException('Notification message cannot be empty.');
    }

    return provider.send({
      recipient: dto.recipient.trim(),
      subject: dto.subject?.trim(),
      message,
    });
  }

  async sendEmergencyAlert(params: {
    recipient: string;
    channel: NotificationChannel;
    personName: string;
    location: string;
    trackingUrl: string;
  }): Promise<NotificationResponse> {
    const message =
      `OPA ALERT: ${params.personName} may be in danger. ` +
      `Location: ${params.location}. ` +
      `Track live: ${params.trackingUrl}`;

    return this.send({
      channel: params.channel,
      recipient: params.recipient,
      subject: 'OPA Emergency Alert',
      message,
    });
  }
}