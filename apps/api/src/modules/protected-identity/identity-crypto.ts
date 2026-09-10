import { toE164 } from "../../shared/phone/normalize-phone-number";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "crypto";

export type IdentifierKind =
  "EMAIL" | "PHONE" | "NOTIFICATION_SNAPSHOT" | "INVITATION_SNAPSHOT";
export interface CryptoContext {
  tenantId: string;
  subjectUserId: string;
  sourceId: string;
  kind: IdentifierKind;
}
export interface SealedValue {
  formatVersion: 1;
  normalizationVersion: 1;
  encryptionKeyVersion: string;
  ciphertext: string;
  nonce: string;
  tag: string;
}

/** Implement this port with a remote cryptographic service when one actually exists. */
export abstract class IdentityCrypto {
  abstract seal(value: string, context: CryptoContext): Promise<SealedValue>;
  abstract open(value: SealedValue, context: CryptoContext): Promise<string>;
  abstract lookup(
    value: string,
    context: Pick<CryptoContext, "tenantId" | "kind">,
  ): Promise<{ digest: string; lookupKeyVersion: string }>;
}

const FAILED = "Protected identity operation unavailable.";
const VERSION = /^[a-zA-Z0-9_-]{1,40}$/;
const MAX_BYTES = 65536;

/** Local adapter: caller supplies independent 256-bit keys. No defaults or generated production keys. */
export class LocalIdentityCrypto extends IdentityCrypto {
  private readonly encryptionKeys: ReadonlyMap<string, Buffer>;
  private readonly lookupKey: Buffer;
  constructor(
    encryptionKeys: ReadonlyMap<string, Buffer>,
    private readonly activeEncryptionVersion: string,
    lookupKey: Buffer,
    private readonly activeLookupVersion: string,
  ) {
    super();
    if (
      !VERSION.test(activeEncryptionVersion) ||
      !VERSION.test(activeLookupVersion) ||
      !encryptionKeys.has(activeEncryptionVersion) ||
      lookupKey.length !== 32 ||
      [...encryptionKeys].some(
        ([version, key]) =>
          !VERSION.test(version) || key.length !== 32 || key.equals(lookupKey),
      )
    ) {
      throw new Error(FAILED);
    }
    this.encryptionKeys = new Map(
      [...encryptionKeys].map(([version, key]) => [version, Buffer.from(key)]),
    );
    this.lookupKey = Buffer.from(lookupKey);
  }

  async seal(value: string, context: CryptoContext): Promise<SealedValue> {
    if (Buffer.byteLength(value, "utf8") > MAX_BYTES) throw new Error(FAILED);
    const nonce = randomBytes(12);
    const key = this.encryptionKeys.get(this.activeEncryptionVersion)!;
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(this.aad(context, this.activeEncryptionVersion));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return {
      formatVersion: 1,
      normalizationVersion: 1,
      encryptionKeyVersion: this.activeEncryptionVersion,
      ciphertext: ciphertext.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  async open(value: SealedValue, context: CryptoContext): Promise<string> {
    try {
      if (value.formatVersion !== 1 || value.normalizationVersion !== 1)
        throw new Error(FAILED);
      const key = this.encryptionKeys.get(value.encryptionKeyVersion);
      if (!key) throw new Error(FAILED);
      const nonce = this.decode(value.nonce, 12);
      const tag = this.decode(value.tag, 16);
      const ciphertext = this.decode(value.ciphertext);
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(this.aad(context, value.encryptionKeyVersion));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error(FAILED);
    }
  }

  async lookup(
    value: string,
    context: Pick<CryptoContext, "tenantId" | "kind">,
  ) {
    if (!context.tenantId || !["EMAIL", "PHONE"].includes(context.kind))
      throw new Error(FAILED);
    return {
      lookupKeyVersion: this.activeLookupVersion,
      digest: createHmac("sha256", this.lookupKey)
        .update(
          JSON.stringify([
            "opa-pii-lookup",
            1,
            this.activeLookupVersion,
            context.tenantId,
            context.kind,
            normalizeIdentifier(context.kind, value),
          ]),
        )
        .digest("hex"),
    };
  }

  private aad(context: CryptoContext, keyVersion: string): Buffer {
    if (
      !context.tenantId ||
      !context.subjectUserId ||
      !context.sourceId ||
      ![
        "EMAIL",
        "PHONE",
        "NOTIFICATION_SNAPSHOT",
        "INVITATION_SNAPSHOT",
      ].includes(context.kind)
    )
      throw new Error(FAILED);
    return Buffer.from(
      JSON.stringify([
        "opa-pii",
        1,
        1,
        keyVersion,
        context.tenantId,
        context.subjectUserId,
        context.sourceId,
        context.kind,
      ]),
    );
  }

  private decode(value: string, length?: number): Buffer {
    if (typeof value !== "string" || value.length > MAX_BYTES * 2)
      throw new Error(FAILED);
    const decoded = Buffer.from(value, "base64");
    if (
      decoded.length > MAX_BYTES ||
      decoded.toString("base64") !== value ||
      (length !== undefined && decoded.length !== length)
    )
      throw new Error(FAILED);
    return decoded;
  }
}

/** v1 follows existing case-insensitive email policy; no plus/dot rewriting. Phone must already be E.164. */
export function normalizeIdentifier(
  kind: IdentifierKind,
  value: string,
): string {
  if (typeof value !== "string" || value.length > 320) throw new Error(FAILED);
  const trimmed = value.trim();
  if (kind === "EMAIL" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed))
    return trimmed.toLowerCase();
  if (kind === "PHONE" && /^\+[1-9]\d{6,14}$/.test(trimmed)) {
    try {
      return toE164(trimmed);
    } catch {
      throw new Error(FAILED);
    }
  }
  throw new Error(FAILED);
}

/** Allowlist projection: no ciphertext, HMAC, recipient suffix, domain, or message crosses ordinary boundaries. */
export function maskedIdentity(row: { id: string; kind: string }) {
  return { id: row.id, kind: row.kind, value: "[protected]" };
}
