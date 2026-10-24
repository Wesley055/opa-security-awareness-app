import { createHmac } from "node:crypto";

/** Phone numbers in delivery logs are stored only as a keyed hash (PII_LOOKUP_KEY). */
export function msisdnHash(lookupKey: string, e164: string): string {
  return createHmac("sha256", lookupKey).update(`opa-msisdn:v1:${e164}`).digest("hex");
}

export function smsFallbackEnabled(): boolean {
  return process.env.SMS_FALLBACK_ENABLED === "true";
}

export function ussdEnabled(): boolean {
  return process.env.USSD_ENABLED === "true";
}

/** Secret callback path segment shared with Africa's Talking; constant-time compare. */
export function callbackTokenMatches(given: string | undefined): boolean {
  const expected = process.env.AFRICASTALKING_CALLBACK_TOKEN ?? "";
  if (expected.length < 32 || !given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** Optional source allowlist (comma-separated IPs from Africa's Talking). Empty = not enforced. */
export function callbackSourceAllowed(ip: string | undefined): boolean {
  const list = (process.env.AFRICASTALKING_CALLBACK_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  return !!ip && list.includes(ip.replace(/^::ffff:/, ""));
}
