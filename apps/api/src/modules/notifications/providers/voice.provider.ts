import {
  NotificationProvider,
  NotificationRequest,
  NotificationResponse,
} from './notification-provider.interface';

export class VoiceProvider implements NotificationProvider {
  readonly providerName = 'Voice';

  async send(
    request: NotificationRequest,
  ): Promise<NotificationResponse> {
    console.log('======== VOICE ========');
    console.log(`Recipient : ${request.recipient}`);
    console.log(`Message   : ${request.message}`);
    console.log('=======================');

    return {
      success: true,
      provider: this.providerName,
      messageId: `voice-${Date.now()}`,
    };
  }
}