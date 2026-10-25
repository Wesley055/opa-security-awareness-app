import type { PrismaClient } from "@prisma/client";
import { msisdnHash } from "../emergency-delivery/delivery-identity";
import { toE164 } from "../../shared/phone/normalize-phone-number";
import { applyAssuranceReply, voiceScript } from "./assurance-policy";

export interface VoiceCallback { isActive?: string; destinationNumber?: string; callerNumber?: string; dtmfDigits?: string; direction?: string }

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/**
 * Africa's Talking voice callback for an assurance call. Speaks the alert,
 * and records "1" as the contact confirming. No incident detail is spoken
 * beyond the person's first name.
 */
export async function voiceResponse(prisma: PrismaClient, body: VoiceCallback, now = new Date()): Promise<string> {
  const empty = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  const key = process.env.PII_LOOKUP_KEY;
  const number = body.direction === "Inbound" ? body.callerNumber : body.destinationNumber;
  if (!key || !number || body.isActive === "0") return empty;
  let hash: string;
  try {
    hash = msisdnHash(key, toE164(number));
  } catch {
    return empty;
  }
  if (body.dtmfDigits === "1") {
    await applyAssuranceReply(prisma, hash, now, "VOICE_KEYPRESS");
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you. Your confirmation has been recorded.</Say></Response>';
  }
  const row = await prisma.incidentContactAssurance.findFirst({
    where: { phoneHash: hash, voiceCallAt: { gt: new Date(now.getTime() - 15 * 60_000) }, closedAt: null },
    orderBy: { voiceCallAt: "desc" },
    select: { incident: { select: { user: { select: { firstName: true } } } } },
  });
  if (!row) return empty;
  const callback = xmlEscape(process.env.AFRICASTALKING_VOICE_CALLBACK_URL ?? "");
  const say = xmlEscape(voiceScript(row.incident.user.firstName || "Your contact"));
  return `<?xml version="1.0" encoding="UTF-8"?><Response><GetDigits timeout="15" finishOnKey="#" numDigits="1" callbackUrl="${callback}"><Say>${say}</Say></GetDigits><Say>${say}</Say></Response>`;
}
