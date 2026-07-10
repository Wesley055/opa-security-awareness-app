import {
  NotificationProvider,
  NotificationRequest,
  NotificationResponse,
} from './notification-provider.interface';

export class PushProvider implements NotificationProvider {
  readonly providerName = 'Push';

  async send(
    request: NotificationRequest,
  ): Promise<NotificationResponse> {
    console.log('========= PUSH =========');
    console.log(`Recipient : ${request.recipient}`);
    console.log(`Message   : ${request.message}`);
    console.log('========================');

    return {
      success: true,
      provider: this.providerName,
      messageId: `push-${Date.now()}`,
    };
  }
}