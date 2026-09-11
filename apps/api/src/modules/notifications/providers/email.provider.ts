import { httpFailure } from "../delivery-policy";
import type {
  NotificationProvider,
  NotificationRequest,
  NotificationResponse,
} from "./notification-provider.interface";

export class EmailProvider implements NotificationProvider {
  readonly providerName = "Email";

  async send(request: NotificationRequest): Promise<NotificationResponse> {
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.RESEND_FROM_ADDRESS;

    if (!apiKey || !fromAddress) {
      console.warn(
        `[EmailProvider] RESEND_API_KEY/FROM_ADDRESS not set — nothing sent`,
      );
      return {
        success: false,
        provider: this.providerName,
        error: "Email provider not configured",
        failureCategory: "AUTHENTICATION",
        retryable: false,
      };
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(25_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [request.recipient],
          subject: request.subject ?? "OPA Alert",
          text: request.message,
        }),
      });

      if (!res.ok) {
        return {
          success: false,
          provider: this.providerName,
          error: "Email provider rejected request",
          ...httpFailure(res.status),
        };
      }

      const result = await res.json();
      return {
        success: true,
        provider: this.providerName,
        messageId: typeof result?.id === "string" ? result.id : undefined,
      };
    } catch {
      return {
        success: false,
        provider: this.providerName,
        error: "Email outcome uncertain",
        uncertain: true,
        failureCategory: "NETWORK",
        retryable: false,
      };
    }
  }
}
