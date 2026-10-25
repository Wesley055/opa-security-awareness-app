import type { Prisma, PrismaClient } from "@prisma/client";
import { msisdnHash } from "../emergency-delivery/delivery-identity";
import { toE164 } from "../../shared/phone/normalize-phone-number";

/** How long an invitation can be answered with YES. */
export const CONSENT_INVITE_VALID_MS = 7 * 24 * 60 * 60 * 1000;

export function safeWalkEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SAFEWALK_ESCALATION_ENABLED === "true";
}

/** Keyed hash of a contact's number, or null when it cannot be normalised. */
export function contactPhoneHash(phoneNumber: string): string | null {
  const key = process.env.PII_LOOKUP_KEY;
  if (!key) return null;
  try {
    return msisdnHash(key, toE164(phoneNumber));
  } catch {
    return null;
  }
}

/** "OPA YES" on a shared short code; the keyword is configured, not assumed. */
export function replyHint(word: "YES" | "STOP"): string {
  const keyword = (process.env.AFRICASTALKING_SMS_KEYWORD ?? "").trim().toUpperCase();
  return keyword ? `${keyword} ${word}` : word;
}

export function inviteText(ownerFirstName: string): string {
  return (
    `OPA SafeWalk: ${ownerFirstName} chose you as a SafeWalk contact. ` +
    `If they don't confirm arriving safely, OPA will text you. ` +
    `Reply ${replyHint("YES")} to agree or ${replyHint("STOP")} to refuse.`
  );
}

export function consentReplyText(word: "YES" | "STOP"): string {
  return word === "YES"
    ? `OPA SafeWalk: thank you. You'll only get a text if a journey isn't confirmed. Reply ${replyHint("STOP")} at any time.`
    : "OPA SafeWalk: you will not get SafeWalk texts. Nothing else changes.";
}

/** YES / STOP after the keyword is removed; anything else is not a consent reply. */
export function consentWord(body: string): "YES" | "STOP" | null {
  const word = body.trim().toUpperCase().replace(/[.!]+$/, "");
  if (word === "YES" || word === "Y") return "YES";
  if (word === "STOP" || word === "NO" || word === "UNSUBSCRIBE") return "STOP";
  return null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Applies a contact's reply. YES only answers a recent PENDING invitation;
 * STOP withdraws every SafeWalk consent held by that number and cancels any
 * text not yet sent. Returns null when the number has no SafeWalk invitation.
 */
export async function applyConsentReply(db: Db, phoneHash: string, word: "YES" | "STOP", now: Date): Promise<"CONSENTED" | "DECLINED" | null> {
  if (word === "YES") {
    const changed = await db.safeWalkContactConsent.updateMany({
      // A contact who said STOP can change their mind from the same number.
      where: {
        phoneHash,
        OR: [{ status: "PENDING", invitedAt: { gt: new Date(now.getTime() - CONSENT_INVITE_VALID_MS) } }, { status: "DECLINED" }],
      },
      data: { status: "CONSENTED", respondedAt: now },
    });
    return changed.count ? "CONSENTED" : null;
  }
  const consents = await db.safeWalkContactConsent.findMany({
    where: { phoneHash, status: { in: ["PENDING", "CONSENTED"] } },
    select: { id: true },
  });
  if (!consents.length) return null;
  const ids = consents.map((c) => c.id);
  await db.safeWalkContactConsent.updateMany({ where: { id: { in: ids } }, data: { status: "DECLINED", respondedAt: now } });
  await db.safeWalkContactNotice.updateMany({
    where: { consentId: { in: ids }, status: { in: ["SELECTED", "QUEUED"] } },
    data: { status: "CANCELLED", cancelledAt: now },
  });
  return "DECLINED";
}
