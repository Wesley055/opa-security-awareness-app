import {
  NotificationProvider,
  NotificationRequest,
  NotificationResponse,
} from './notification-provider.interface';

export class SmsProvider implements NotificationProvider {
  readonly providerName = 'SMS';

  async send(
    request: NotificationRequest,
  ): Promise<NotificationResponse> {
    console.log('========== SMS ==========');
    console.log(`Recipient : ${request.recipient}`);
    console.log(`Message   : ${request.message}`);
    console.log('=========================');

    return {
      success: true,
      provider: this.providerName,
      messageId: `sms-${Date.now()}`,
    };
  }
}