import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';
import { VoiceProvider } from './providers/voice.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';

@Module({
  controllers: [NotificationController],
  providers: [
    NotificationService,
    SmsProvider,
    WhatsAppProvider,
    PushProvider,
    EmailProvider,
    VoiceProvider,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}