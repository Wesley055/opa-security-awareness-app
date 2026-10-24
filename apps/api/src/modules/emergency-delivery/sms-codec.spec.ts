import { decodeSms, deriveDeviceKey, encodeOfflineSos, macMatches } from "./sms-codec";

const key = deriveDeviceKey(Buffer.alloc(32, 7), "ABCDEFGH", "11111111-1111-4111-8111-111111111111", 0);
const sos = {
  activationId: "7a0f9a54-3b8e-4c47-9a39-2f8a6f1c2d11",
  latitude: 6.4856628,
  longitude: 3.3630737,
  accuracy: 12.4,
  pressedAt: new Date("2026-10-24T03:00:00Z"),
  silent: true,
  keyId: "ABCDEFGH",
};

describe("offline SOS SMS v1", () => {
  it("round-trips, fits one SMS and verifies", () => {
    const text = encodeOfflineSos(sos, key);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toMatch(/^[A-Za-z0-9 ,.\-_]+$/);
    const d = decodeSms(text);
    expect(d.kind).toBe("SIGNED_FORMAT");
    if (d.kind !== "SIGNED_FORMAT") return;
    expect(d.sos).toEqual({ ...sos, latitude: 6.48566, longitude: 3.36307, accuracy: 12 });
    expect(macMatches(key, d.fields, d.mac)).toBe(true);
  });

  // Shared test vector: apps/mobile-app/src/services/offline-sos-sms.spec.ts must produce the same string.
  it("matches the shared test vector used by the mobile app", () => {
    expect(encodeOfflineSos(sos, key)).toBe("OPA1 eg-aVDuOTEeaOS-KbxwtEQ 6.48566,3.36307 12 tne5o0 S ABCDEFGH ZNmMXypwqmlFKmEl");
  });

  it("rejects any change to a signed field", () => {
    const text = encodeOfflineSos(sos, key).replace("6.48566", "6.48567");
    const d = decodeSms(text);
    expect(d.kind === "SIGNED_FORMAT" && macMatches(key, d.fields, d.mac)).toBe(false);
  });

  it("rejects a key from another account or an older credential version", () => {
    const d = decodeSms(encodeOfflineSos(sos, key));
    if (d.kind !== "SIGNED_FORMAT") throw new Error();
    expect(macMatches(deriveDeviceKey(Buffer.alloc(32, 7), "ABCDEFGH", "22222222-2222-4222-8222-222222222222", 0), d.fields, d.mac)).toBe(false);
    expect(macMatches(deriveDeviceKey(Buffer.alloc(32, 7), "ABCDEFGH", "11111111-1111-4111-8111-111111111111", 1), d.fields, d.mac)).toBe(false);
  });

  it("encodes a press with no GPS fix", () => {
    const d = decodeSms(encodeOfflineSos({ ...sos, latitude: null, longitude: null, accuracy: 30 }, key));
    expect(d.kind === "SIGNED_FORMAT" && d.sos).toMatchObject({ latitude: null, longitude: null, accuracy: null });
  });

  it.each(["SOS", "opa sos", "Help me", "OPA SOS please"])("treats %p as a hand-typed SOS", (t) => {
    expect(decodeSms(t).kind).toBe("PLAIN_SOS");
  });

  it.each(["hello", "OPA1 bad", "OPA1 x y z t m k mac", ""])("does not recognise %p", (t) => {
    expect(decodeSms(t).kind).toBe("UNRECOGNISED");
  });
});
