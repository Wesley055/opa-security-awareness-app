import type { NotificationChannel } from "@prisma/client";

/** Presentation masking only. Protected snapshots are never resolved for this view. */
export function maskDeliveryRecipient(
  channel: NotificationChannel,
  recipient: string,
): string {
  if (channel === "EMAIL") {
    const at = recipient.indexOf("@");
    return at > 0 ? `${recipient[0]}••••@••••` : "••••";
  }
  if (channel === "SMS" || channel === "WHATSAPP" || channel === "VOICE") {
    const digits = recipient.replace(/\D/g, "");
    return digits.length >= 7 ? `••••${digits.slice(-4)}` : "••••";
  }
  return "••••";
}
