import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { base64ToBytes, encodeOfflineSos } from './offline-sos-sms';

// Mirrors deriveDeviceKey() on the server for the shared test vector.
function deviceKey(secret: Uint8Array, keyId: string, userId: string, credentialVersion: number) {
  return hmac(sha256, secret, new TextEncoder().encode(`opa-sms-key:v1:${keyId}:${userId}:${credentialVersion}`));
}

const sos = {
  activationId: '7a0f9a54-3b8e-4c47-9a39-2f8a6f1c2d11',
  latitude: 6.4856628,
  longitude: 3.3630737,
  accuracy: 12.4,
  pressedAt: new Date('2026-10-24T03:00:00Z'),
  silent: true,
  keyId: 'ABCDEFGH',
};

it('matches the shared test vector in apps/api sms-codec.spec.ts', () => {
  const key = deviceKey(new Uint8Array(32).fill(7), 'ABCDEFGH', '11111111-1111-4111-8111-111111111111', 0);
  expect(encodeOfflineSos(sos, key)).toBe('OPA1 eg-aVDuOTEeaOS-KbxwtEQ 6.48566,3.36307 12 tne5o0 S ABCDEFGH ZNmMXypwqmlFKmEl');
});

it('fits one SMS and uses only GSM-7 safe characters', () => {
  const text = encodeOfflineSos({ ...sos, latitude: -89.123456, longitude: -179.654321, accuracy: 99999 }, new Uint8Array(32));
  expect(text.length).toBeLessThanOrEqual(160);
  expect(text).toMatch(/^[A-Za-z0-9 ,.\-_]+$/);
});

it('sends "-" when the phone had no GPS fix', () => {
  expect(encodeOfflineSos({ ...sos, latitude: null, longitude: null }, new Uint8Array(32)).split(' ').slice(2, 4)).toEqual(['-', '-']);
});

it('decodes standard base64 keys from the server', () => {
  expect(Array.from(base64ToBytes('AAEC/w=='))).toEqual([0, 1, 2, 255]);
});
