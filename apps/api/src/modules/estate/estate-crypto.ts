import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from "crypto";

/**
 * EstateFlow secrets. Same server key as enrollment, separate labels, so a
 * visitor ciphertext or code digest can never be confused with another kind.
 */
const AAD = Buffer.from("OPA:visitor:v1");

function key(secretHex: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(secretHex)) throw new Error("Invalid visitor key configuration");
  return Buffer.from(secretHex, "hex");
}

export type VisitorIdentity = { name: string; phone?: string };

export function protectVisitor(secretHex: string, value: VisitorIdentity): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secretHex), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function revealVisitor(secretHex: string, value: string): VisitorIdentity {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid protected visitor");
  const decipher = createDecipheriv("aes-256-gcm", key(secretHex), Buffer.from(iv, "base64url"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8"),
  ) as VisitorIdentity;
}

export const VISITOR_CODE_LENGTH = 6;

export function generateVisitorCode(): string {
  return randomInt(0, 10 ** VISITOR_CODE_LENGTH).toString().padStart(VISITOR_CODE_LENGTH, "0");
}

/** Spaces and dashes forgiven: guards may hear "482-913". Null if not 6 digits. */
export function normalizeVisitorCode(value: string): string | null {
  const compact = String(value ?? "").replace(/[\s-]+/g, "");
  return /^\d{6}$/.test(compact) ? compact : null;
}

/** Scoped to the estate: the same digits at another estate never match. */
export function visitorCodeDigest(secretHex: string, facilityId: string, code: string): string {
  return createHmac("sha256", key(secretHex)).update(`OPA:visitor-code:v1:${facilityId}:${code}`).digest("hex");
}
