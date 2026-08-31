import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';
import { VoiceProvider } from './providers/voice.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { NotificationDispatchWorker } from './notification-dispatch.worker';

@Module({
  controllers: [NotificationController],
  providers: [
    NotificationService,
    SmsProvider,
    WhatsAppProvider,
    PushProvider,
    EmailProvider,
    VoiceProvider,
    NotificationDispatchWorker,
  ],
  // SmsProvider is exported as TRANSPORT, not as notification policy. The
  // invitation worker in AdminProvisioningModule sends account invitations
  // over SMS; that is not incident notification, and the provider stays
  // here because this is where transport infrastructure belongs.
  exports: [NotificationService, EmailProvider, SmsProvider],
})
export class NotificationModule {}