import {
  NotificationProvider,
  NotificationRequest,
  NotificationResponse,
} from './notification-provider.interface';

export class WhatsAppProvider implements NotificationProvider {
  readonly providerName = 'WhatsApp';

  async send(
    request: NotificationRequest,
  ): Promise<NotificationResponse> {
    console.log('====== WHATSAPP ======');
    console.log(`Recipient : ${request.recipient}`);
    console.log(`Message   : ${request.message}`);
    console.log('======================');

    return {
      success: true,
      provider: this.providerName,
      messageId: `wa-${Date.now()}`,
    };
  }
}