import {
  NotificationProvider,
  NotificationRequest,
  NotificationResponse,
} from './notification-provider.interface';

export class EmailProvider implements NotificationProvider {
  readonly providerName = 'Email';

  async send(
    request: NotificationRequest,
  ): Promise<NotificationResponse> {
    console.log('======== EMAIL ========');
    console.log(`Recipient : ${request.recipient}`);
    console.log(`Subject   : ${request.subject ?? 'OPA Alert'}`);
    console.log(`Message   : ${request.message}`);
    console.log('=======================');

    return {
      success: true,
      provider: this.providerName,
      messageId: `email-${Date.now()}`,
    };
  }
}