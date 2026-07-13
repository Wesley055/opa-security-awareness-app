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
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.RESEND_FROM_ADDRESS;

    if (!apiKey || !fromAddress) {
      console.warn(
        `[EmailProvider] RESEND_API_KEY/FROM_ADDRESS not set — logging instead of sending to ${request.recipient}`,
      );
      return {
        success: false,
        provider: this.providerName,
        error: 'Email provider not configured',
      };
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [request.recipient],
          subject: request.subject ?? 'OPA Alert',
          text: request.message,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        return {
          success: false,
          provider: this.providerName,
          error: result?.message ?? `Resend API error (${res.status})`,
        };
      }

      return {
        success: true,
        provider: this.providerName,
        messageId: result?.id,
      };
    } catch (error) {
      return {
        success: false,
        provider: this.providerName,
        error: error instanceof Error ? error.message : 'Unknown email error',
      };
    }
  }
}