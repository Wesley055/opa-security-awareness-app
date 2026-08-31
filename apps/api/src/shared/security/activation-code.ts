import { randomBytes } from "crypto";

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
