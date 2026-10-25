import { outboundDenial } from "../notifications/outbound-environment";

/** "14:02" in Nigerian time, for the reply a person reads on a phone with no internet. */
export function watClock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

export function receiptText(at: Date): string {
  return `OPA: alert received ${watClock(at)} WAT. Help is being notified. Stay safe.`;
}

/** Sends one text from the two-way short code, so the person can reply. Never throws. */
export async function sendFromShortcode(to: string, message: string, linkId?: string): Promise<"SENT" | "SKIPPED" | "FAILED"> {
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME;
  const from = process.env.AFRICASTALKING_SHORTCODE;
  if (!apiKey || !username || !from) return "SKIPPED";
  try {
    if (await outboundDenial("SMS", to)) return "SKIPPED";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AfricasTalking = require("africastalking");
    const result = await AfricasTalking({ apiKey, username }).SMS.send({
      to: [to],
      from,
      message,
      ...(linkId ? { linkId } : {}),
    });
    return result?.SMSMessageData?.Recipients?.[0]?.status === "Success" ? "SENT" : "FAILED";
  } catch {
    return "FAILED";
  }
}

/** Sends the receipt from the two-way short code. Never throws: the alert already exists. */
export async function sendReceipt(to: string, at: Date, linkId?: string): Promise<"SENT" | "SKIPPED" | "FAILED"> {
  if (process.env.SMS_FALLBACK_REPLY === "false") return "SKIPPED";
  return sendFromShortcode(to, receiptText(at), linkId);
}
