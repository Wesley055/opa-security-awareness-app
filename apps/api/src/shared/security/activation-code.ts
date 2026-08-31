import { createHash, randomBytes } from "crypto";

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
