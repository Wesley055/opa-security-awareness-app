import type {
  NotificationProvider,
  NotificationRequest,
  NotificationResponse,
} from "./notification-provider.interface";

export class SmsProvider implements NotificationProvider {
  /** Guards the one-time mode log below. Process-wide, deliberately. */
  private static modeLogged = false;

  readonly providerName = "SMS";

  async send(request: NotificationRequest): Promise<NotificationResponse> {
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const username = process.env.AFRICASTALKING_USERNAME;

    if (!apiKey || !username) {
      console.warn(
        `[SmsProvider] AFRICASTALKING_API_KEY/USERNAME not set — nothing sent`,
      );
      return {
        success: false,
        provider: this.providerName,
        error: "SMS provider not configured",
        failureCategory: "AUTHENTICATION",
        retryable: false,
      };
    }

    // WHICH MODE ARE WE IN? Logged once per process, because not knowing has
    // cost real time: every local SMS between 6 and 8 August went to the
    // SANDBOX SIMULATOR - accepted, never carried, never charged, and absent
    // from the production sending log. Two separate defects were diagnosed
    // before anyone checked the username.
    //
    // A test whose outcome depends on a message arriving is not evidence
    // unless the environment is recorded alongside the result.
    if (!SmsProvider.modeLogged) {
      SmsProvider.modeLogged = true;
      const mode =
        username === "sandbox"
          ? "SANDBOX (simulator - NOTHING IS DELIVERED)"
          : "PRODUCTION";
      console.log(`[SmsProvider] mode=${mode}`);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AfricasTalking = require("africastalking");
      const sms = AfricasTalking({ apiKey, username }).SMS;

      const result = await sms.send({
        to: [request.recipient],
        message: request.message,
        from: process.env.AFRICASTALKING_SENDER_ID || undefined,
      });

      // AFRICA'S TALKING REPORTS PER-RECIPIENT FAILURE INSIDE A SUCCESSFUL
      // HTTP RESPONSE. sms.send() does NOT throw when a message is rejected -
      // the outcome is in SMSMessageData.Recipients[n].status, as a string.
      //
      // This code previously returned success:true whenever the call did not
      // throw, reading Recipients[0] only for its messageId. The 6 August
      // production sending log shows the consequence: one number returning
      // "Failed" while OPA recorded the notification as SENT. A false
      // delivery record is worse than a missing one - ADR-015 section 6b.
      const recipient = result?.SMSMessageData?.Recipients?.[0] as
        | { status?: string; messageId?: string; statusCode?: number }
        | undefined;

      // FAIL CLOSED. "Success" is the ONLY status treated as a successful
      // send. Failed, InsufficientBalance, UserInBlacklist, an unrecognised
      // string, a missing status, an empty Recipients array or a malformed
      // response ALL return success:false. An unknown provider state must
      // never become a successful delivery record.
      if (recipient?.status !== "Success") {
        const reported = recipient?.status ?? "no recipient status returned";
        const known = [
          "Failed",
          "InsufficientBalance",
          "UserInBlacklist",
          "CouldNotSend",
          "InvalidPhoneNumber",
        ].includes(reported);
        console.warn(`[SmsProvider] Acceptance not established`);
        return {
          success: false,
          provider: this.providerName,
          messageId: recipient?.messageId,
          failureCategory:
            reported === "InvalidPhoneNumber"
              ? "INVALID_RECIPIENT"
              : reported === "UserInBlacklist"
                ? "REJECTED"
                : reported === "InsufficientBalance"
                  ? "AUTHENTICATION"
                  : reported === "CouldNotSend"
                    ? "PROVIDER_UNAVAILABLE"
                    : "UNKNOWN_PROVIDER_ERROR",
          uncertain: !known,
          retryable: reported === "CouldNotSend",
          // Bounded diagnostic; the ledger stores the neutral category.
          error: `Africa's Talking status: ${known ? reported : "UNKNOWN_PROVIDER_ERROR"}`,
        };
      }

      // SEND-TIME PROVIDER SUCCESS != FINAL DELIVERY CONFIRMATION.
      //
      // "Success" here means Africa's Talking ACCEPTED the message for
      // delivery. The carrier has not confirmed anything yet; that final
      // status arrives later through a delivery-report callback, and OPA has
      // no endpoint to receive one. Do not read a SENT row as proof that a
      // handset received the message.
      return {
        success: true,
        provider: this.providerName,
        messageId: recipient.messageId,
      };
    } catch {
      console.error("[SmsProvider] Send outcome uncertain");
      return {
        success: false,
        provider: this.providerName,
        error: "SMS outcome uncertain",
        uncertain: true,
        failureCategory: "NETWORK",
        retryable: false,
      };
    }
  }
}
