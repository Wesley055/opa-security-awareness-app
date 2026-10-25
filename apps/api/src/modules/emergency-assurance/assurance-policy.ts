import type { Prisma, PrismaClient } from "@prisma/client";
import { replyHint } from "../journey/safewalk-consent";

/**
 * Emergency assurance (owner approval 24 Oct, Providus Bank question):
 * the SOS alert itself is never delayed or changed. Afterwards, OPA asks each
 * alerted contact to reply OK, reminds and then calls if NOBODY has confirmed,
 * and separately alerts Facility Admins if security has not acknowledged.
 * A contact confirming never stops security escalation, and security
 * acknowledging never cancels the contact steps.
 */
export const ASSURANCE_WINDOW_MS = 30 * 60_000;

const minutes = (name: string, fallback: number, min: number, max: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
};
export const timings = () => ({
  reminderMs: minutes("ASSURANCE_REMINDER_MINUTES", 3, 1, 30) * 60_000,
  voiceMs: minutes("ASSURANCE_VOICE_MINUTES", 5, 2, 60) * 60_000,
  securityAckMs: minutes("SECURITY_ACK_ESCALATION_MINUTES", 2, 1, 30) * 60_000,
});

export const contactAssuranceEnabled = () => process.env.EMERGENCY_ASSURANCE_ENABLED === "true";
export const securityEscalationEnabled = () => process.env.SECURITY_ESCALATION_ENABLED === "true";
export const voiceConfigured = () =>
  !!process.env.AFRICASTALKING_VOICE_NUMBER && !!process.env.AFRICASTALKING_VOICE_CALLBACK_URL && process.env.ASSURANCE_VOICE_ENABLED === "true";

export const ACTIVE_STATUSES = ["OPEN", "ACKNOWLEDGED"] as const;

export function askText(firstName: string): string {
  return `OPA: you have just been sent an emergency alert about ${firstName}. Reply ${replyHint("OK")} when you have seen it.`;
}

export function reminderText(firstName: string, trackingUrl: string | null): string {
  return `OPA REMINDER: ${firstName} may still need help.${trackingUrl ? ` Live location: ${trackingUrl}` : ""} Reply ${replyHint("OK")} when you have seen it.`;
}

export function confirmedText(active: boolean): string {
  return active ? "OPA: thank you. Your confirmation has been recorded." : "OPA: thank you. This alert has already ended.";
}

export function securityEscalationText(facilityName: string, minutesWaited: number): string {
  return `OPA: an SOS at ${facilityName.slice(0, 60)} has not been acknowledged for ${minutesWaited} minutes. Open the Command Center now.`;
}

export function voiceScript(firstName: string): string {
  return `This is an OPA emergency alert. ${firstName} may be in danger. Check your text messages for their live location. Press 1 if you have seen this alert.`;
}

export function ackWord(body: string): boolean {
  return /^(ok|okay|seen|k)[.!]*$/i.test(body.trim());
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Records an OK reply from a contact's number against every alert sent to
 * that number in the last 30 minutes. Returns null when there is none.
 */
export async function applyAssuranceReply(db: Db, phoneHash: string, now: Date, via: "SMS_REPLY" | "VOICE_KEYPRESS" = "SMS_REPLY"): Promise<{ confirmed: number; active: boolean } | null> {
  const rows = await db.incidentContactAssurance.findMany({
    where: { phoneHash, createdAt: { gt: new Date(now.getTime() - ASSURANCE_WINDOW_MS) } },
    select: { id: true, confirmedAt: true, closedAt: true },
  });
  if (!rows.length) return null;
  const pending = rows.filter((r) => !r.confirmedAt).map((r) => r.id);
  if (pending.length) await db.incidentContactAssurance.updateMany({ where: { id: { in: pending }, confirmedAt: null }, data: { confirmedAt: now, confirmedVia: via } });
  return { confirmed: pending.length, active: rows.some((r) => !r.closedAt) };
}
