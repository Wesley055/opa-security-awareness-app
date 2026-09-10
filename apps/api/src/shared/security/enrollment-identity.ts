import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "crypto";
import type { ConfigService } from "@nestjs/config";
function key(config: ConfigService): Buffer {
  const value = config.getOrThrow<string>("ENROLLMENT_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Invalid enrollment encryption key configuration");
  return Buffer.from(value, "hex");
}
export function protectIdentity(config: ConfigService, value: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(config), iv);
  cipher.setAAD(Buffer.from("OPA:enrollment:v1"));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function revealIdentity<T>(config: ConfigService, value: string): T {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted)
    throw new Error("Invalid protected enrollment");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(config),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from("OPA:enrollment:v1"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}
export function enrollmentDigest(config: ConfigService, value: string): string {
  return createHmac("sha256", key(config))
    .update("OPA:enrollment:idempotency:v1:")
    .update(value)
    .digest("hex");
}
