import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

export const ACTIVATION_CODE_LENGTH = 8;
export const ACTIVATION_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateActivationCode(): string {
  const bytes = randomBytes(ACTIVATION_CODE_LENGTH);

  return Array.from(bytes, (byte) =>
    ACTIVATION_CODE_ALPHABET.charAt(byte & 31),
  ).join("");
}

export function normalizeActivationCredential(value: string): string {
  const trimmed = value.trim();

  const compact = trimmed
    .replace(/[\s-]+/g, "")
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");

  if (
    compact.length === ACTIVATION_CODE_LENGTH &&
    /^[0-9A-HJKMNP-TV-Z]{8}$/.test(compact)
  ) {
    return compact;
  }

  // Preserve previously issued base64url activation tokens exactly.
  return trimmed;
}

/**
 * The stored form of an activation credential.
 *
 * ONE IMPLEMENTATION, DELIBERATELY. This was duplicated: AdminProvisioning
 * hashed a credential when minting it, ActivationService hashed the
 * incoming guess when looking it up. Two implementations of the digest
 * that decides whether an unauthenticated caller may set a password is one
 * too many - if they ever diverged, no seat could be activated at all.
 *
 * TAKES AN ALREADY-CANONICAL CREDENTIAL. Normalisation is a separate step
 * and stays the caller's responsibility, because only the caller knows
 * whether it holds a value it generated or a value a human typed.
 *
 * SHA-256 rather than a password KDF. A resident's code carries about 40
 * bits and an operator's token 256, so the resident credential is NOT
 * high-entropy and this hash alone does not provide strong resistance to
 * offline guessing. Online activation is additionally constrained by
 * single-use semantics, a 24-hour expiry, and /auth/activate rate limiting.
 * If the threat model or credential design changes, revisit this choice.
 */
export function hashActivationCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

/**
 * Enrollment one-time codes: 4 digits per channel, by design easy to type.
 *
 * Security comes from the combination, not one code: enrollment requires the
 * email code AND the phone code in the same attempt (10^8 combinations), with
 * at most 5 attempts per invitation and a 24-hour expiry. Issuing a new code
 * overwrites the stored digest, so earlier codes stop working.
 *
 * Stored as an HMAC keyed by a server secret, never a bare hash: a bare hash
 * of a 4-digit code is reversed instantly by anyone who can read the table.
 */
export const ENROLLMENT_OTP_LENGTH = 4;

export function generateEnrollmentOtp(): string {
  return randomInt(0, 10 ** ENROLLMENT_OTP_LENGTH)
    .toString()
    .padStart(ENROLLMENT_OTP_LENGTH, "0");
}

/** Spaces, dashes and full-width digits are forgiven; anything else stays as typed. */
export function normalizeEnrollmentCode(value: string): string {
  const compact = value
    .trim()
    .replace(/[\s-]+/g, "")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  return /^\d+$/.test(compact) ? compact : value.trim();
}

export function enrollmentCodeDigest(code: string, secretHex: string): string {
  const key = createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update("opa-enrollment-otp-v1")
    .digest();
  return createHmac("sha256", key).update(normalizeEnrollmentCode(code)).digest("hex");
}

/**
 * Constant-time check of a typed code against a stored digest. Accepts the
 * keyed digest (new codes) and, until they expire, the legacy unkeyed digest
 * of the long base64url codes issued before this change.
 */
export function enrollmentCodeMatches(raw: string, digest: string | null, secretHex: string): boolean {
  if (!digest || !/^[0-9a-f]{64}$/.test(digest)) return false;
  const stored = Buffer.from(digest, "hex");
  const keyed = Buffer.from(enrollmentCodeDigest(raw, secretHex), "hex");
  const legacy = Buffer.from(hashActivationCredential(normalizeActivationCredential(raw)), "hex");
  const a = timingSafeEqual(keyed, stored);
  const b = timingSafeEqual(legacy, stored);
  return a || b;
}
