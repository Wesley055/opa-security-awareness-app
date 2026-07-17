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
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const username = process.env.AFRICASTALKING_USERNAME;

    if (!apiKey || !username) {
      console.warn(
        `[SmsProvider] AFRICASTALKING_API_KEY/USERNAME not set — logging instead of sending to ${request.recipient}`,
      );
      return {
        success: false,
        provider: this.providerName,
        error: 'SMS provider not configured',
      };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AfricasTalking = require('africastalking');
      const sms = AfricasTalking({ apiKey, username }).SMS;

      const result = await sms.send({
        to: [this.normalizePhone(request.recipient)],
        message: request.message,
        from: process.env.AFRICASTALKING_SENDER_ID || undefined,
      });

      return {
        success: true,
        provider: this.providerName,
        messageId: result?.SMSMessageData?.Recipients?.[0]?.messageId,
      };
    } catch (error) {
      console.error(`[SmsProvider] Send failed:`, error);
      return {
        success: false,
        provider: this.providerName,
        error: error instanceof Error ? error.message : 'Unknown SMS error',
      };
    }
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits;
    if (digits.startsWith('0')) return '+234' + digits.slice(1);
    if (digits.startsWith('234')) return '+' + digits;
    return '+234' + digits;
  }
}