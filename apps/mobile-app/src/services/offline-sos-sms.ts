import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

/**
 * OPA offline SOS message, version 1. MUST stay identical to
 * apps/api/src/modules/emergency-delivery/sms-codec.ts (shared test vector
 * in both spec files).
 *
 *   OPA1 <id> <lat,lng|-> <acc|-> <t> <m> <k> <mac>
 */
export const SMS_PREFIX = 'OPA1';

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
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += B64URL[a >> 2];
    out += B64URL[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += B64URL[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += B64URL[c & 63];
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  const std = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0, bits = 0;
  for (const ch of clean) {
    const v = std.indexOf(ch);
    if (v < 0) throw new Error('invalid base64');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function uuidBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

export function smsMac(deviceKey: Uint8Array, fields: string[]): string {
  const mac = hmac(sha256, deviceKey, new TextEncoder().encode(fields.join(' ')));
  return base64url(mac.subarray(0, 12));
}

export function encodeOfflineSos(sos: OfflineSos, deviceKey: Uint8Array): string {
  if (!UUID.test(sos.activationId)) throw new Error('activationId must be a UUID v4');
  const hasFix = sos.latitude !== null && sos.longitude !== null;
  const fields = [
    SMS_PREFIX,
    base64url(uuidBytes(sos.activationId)),
    hasFix ? `${sos.latitude!.toFixed(5)},${sos.longitude!.toFixed(5)}` : '-',
    sos.accuracy !== null && hasFix ? String(Math.min(Math.round(sos.accuracy), 99999)) : '-',
    Math.floor(sos.pressedAt.getTime() / 1000).toString(36),
    sos.silent ? 'S' : 'N',
    sos.keyId,
  ];
  return [...fields, smsMac(deviceKey, fields)].join(' ');
}
