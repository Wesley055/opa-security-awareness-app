import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * OPA offline SOS message, version 1. One GSM-7 SMS, readable only by OPA:
 *
 *   OPA1 <id> <lat,lng|-> <acc|-> <t> <m> <k> <mac>
 *
 *   id   activation UUID, 16 bytes base64url (22 chars), the SAME id the
 *        internet route uses, so both copies reconcile onto one incident
 *   lat,lng  5 decimals (about 1 m), or "-" when the phone had no fix
 *   acc  accuracy in whole metres, or "-"
 *   t    press time, Unix seconds, base 36
 *   m    S = silent, N = standard
 *   k    device key id (8 chars, base32)
 *   mac  HMAC-SHA256 over the canonical fields with the device key,
 *        first 12 bytes, base64url (16 chars)
 *
 * The mobile app carries an identical copy of this file; shared test
 * vectors keep the two in step.
 */
export const SMS_PREFIX = "OPA1";

export interface OfflineSos {
  activationId: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  pressedAt: Date;
  silent: boolean;
  keyId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function uuidToB64(id: string): string {
  return Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url");
}
function b64ToUuid(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  const hex = Buffer.from(value, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID.test(id) ? id : null;
}

function canonical(fields: string[]): string {
  return fields.join(" ");
}

export function smsMac(deviceKey: Buffer, fields: string[]): string {
  return createHmac("sha256", deviceKey).update(canonical(fields)).digest().subarray(0, 12).toString("base64url");
}

export function encodeOfflineSos(sos: OfflineSos, deviceKey: Buffer): string {
  if (!UUID.test(sos.activationId)) throw new Error("activationId must be a UUID v4");
  const hasFix = sos.latitude !== null && sos.longitude !== null;
  const fields = [
    SMS_PREFIX,
    uuidToB64(sos.activationId),
    hasFix ? `${sos.latitude!.toFixed(5)},${sos.longitude!.toFixed(5)}` : "-",
    sos.accuracy !== null && hasFix ? String(Math.min(Math.round(sos.accuracy), 99999)) : "-",
    Math.floor(sos.pressedAt.getTime() / 1000).toString(36),
    sos.silent ? "S" : "N",
    sos.keyId,
  ];
  return canonical([...fields, smsMac(deviceKey, fields)]);
}

export type DecodedSms =
  | { kind: "SIGNED_FORMAT"; sos: OfflineSos; fields: string[]; mac: string }
  | { kind: "PLAIN_SOS" }
  | { kind: "UNRECOGNISED" };

/** Parses without trusting: the caller still checks the sender, the key and the MAC. */
export function decodeSms(text: string): DecodedSms {
  const parts = text.trim().split(/\s+/);
  if (parts[0] === SMS_PREFIX && parts.length === 8) {
    const [, id64, loc, acc, t36, m, keyId, mac] = parts as [string, string, string, string, string, string, string, string];
    const activationId = b64ToUuid(id64);
    const seconds = /^[0-9a-z]{1,8}$/.test(t36) ? parseInt(t36, 36) : NaN;
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (loc !== "-") {
      const match = /^(-?\d{1,2}\.\d{1,6}),(-?\d{1,3}\.\d{1,6})$/.exec(loc);
      if (!match) return { kind: "UNRECOGNISED" };
      latitude = Number(match[1]!);
      longitude = Number(match[2]!);
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { kind: "UNRECOGNISED" };
    }
    const accuracy = acc === "-" ? null : /^\d{1,5}$/.test(acc) ? Number(acc) : NaN;
    if (
      !activationId ||
      Number.isNaN(seconds) ||
      Number.isNaN(accuracy as number) ||
      (m !== "S" && m !== "N") ||
      !/^[A-Z2-7]{8}$/.test(keyId) ||
      !/^[A-Za-z0-9_-]{16}$/.test(mac)
    )
      return { kind: "UNRECOGNISED" };
    return {
      kind: "SIGNED_FORMAT",
      sos: { activationId, latitude, longitude, accuracy, pressedAt: new Date(seconds * 1000), silent: m === "S", keyId },
      fields: parts.slice(0, 7),
      mac,
    };
  }
  // A person typing by hand to the short code ("SOS", "OPA SOS", "HELP").
  if (/^(opa\s+)?(sos|help)\b/i.test(text.trim())) return { kind: "PLAIN_SOS" };
  return { kind: "UNRECOGNISED" };
}

export function macMatches(deviceKey: Buffer, fields: string[], mac: string): boolean {
  const expected = Buffer.from(smsMac(deviceKey, fields));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * The per-device key is derived, never stored: it depends on the server
 * secret, the key id, the account and its credential version, so a password
 * change or sign-out-everywhere invalidates every SMS key at once.
 */
export function deriveDeviceKey(secret: Buffer, keyId: string, userId: string, credentialVersion: number): Buffer {
  return createHmac("sha256", secret).update(`opa-sms-key:v1:${keyId}:${userId}:${credentialVersion}`).digest();
}
