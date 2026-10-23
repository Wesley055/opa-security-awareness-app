import { randomBytes } from "crypto";
import {
  LocalIdentityCrypto,
  maskedIdentity,
  normalizeIdentifier,
} from "./identity-crypto";
import type { CryptoContext } from "./identity-crypto";

const context: CryptoContext = {
  tenantId: "tenant-a",
  subjectUserId: "user-a",
  sourceId: "source-a",
  kind: "EMAIL",
};
const value = "private.person@example.test";
const enc = randomBytes(32);
const lookupKey = randomBytes(32);
const crypto = () =>
  new LocalIdentityCrypto(
    new Map([["enc-1", enc]]),
    "enc-1",
    lookupKey,
    "lookup-1",
  );

describe("protected identity cryptography", () => {
  it("encrypts identifiers without plaintext in the stored envelope", async () => {
    const sealed = await crypto().seal(value, context);
    expect(JSON.stringify(sealed)).not.toContain(value);
    expect(await crypto().open(sealed, context)).toBe(value);
  });
  it("uses fresh nonces and ciphertext for equal plaintext", async () => {
    const [a, b] = await Promise.all([
      crypto().seal(value, context),
      crypto().seal(value, context),
    ]);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it.each(["tenantId", "subjectUserId", "sourceId", "kind"] as const)(
    "authenticates the %s binding",
    async (field) => {
      const sealed = await crypto().seal(value, context);
      await expect(
        crypto().open(sealed, {
          ...context,
          [field]: field === "kind" ? "PHONE" : "foreign",
        }),
      ).rejects.toThrow("Protected identity operation unavailable.");
    },
  );
  it.each(["ciphertext", "tag", "nonce", "encryptionKeyVersion"] as const)(
    "fails closed for damaged %s",
    async (field) => {
      const sealed = await crypto().seal(value, context);
      await expect(
        crypto().open({ ...sealed, [field]: "damaged" }, context),
      ).rejects.toThrow("Protected identity operation unavailable.");
    },
  );
  it("rejects unknown format and normalization versions", async () => {
    const sealed = await crypto().seal(value, context);
    for (const key of ["formatVersion", "normalizationVersion"]) {
      await expect(
        crypto().open({ ...sealed, [key]: 2 }, context),
      ).rejects.toThrow();
    }
  });
  it("supports old encryption keys during staged rotation", async () => {
    const sealed = await crypto().seal(value, context);
    const rotated = new LocalIdentityCrypto(
      new Map([
        ["enc-1", enc],
        ["enc-2", randomBytes(32)],
      ]),
      "enc-2",
      lookupKey,
      "lookup-1",
    );
    expect(await rotated.open(sealed, context)).toBe(value);
    expect((await rotated.seal(value, context)).encryptionKeyVersion).toBe(
      "enc-2",
    );
  });
  it("normalizes equivalent emails to deterministic HMACs", async () => {
    expect(
      await crypto().lookup(" Private.Person@EXAMPLE.test ", context),
    ).toEqual(await crypto().lookup(value, context));
  });
  it("separates HMACs across tenants, kinds and key versions", async () => {
    const a = await crypto().lookup(value, context);
    expect(
      await crypto().lookup(value, { ...context, tenantId: "tenant-b" }),
    ).not.toEqual(a);
    const rotated = new LocalIdentityCrypto(
      new Map([["enc-1", enc]]),
      "enc-1",
      randomBytes(32),
      "lookup-2",
    );
    expect(await rotated.lookup(value, context)).not.toEqual(a);
    await expect(
      crypto().lookup(value, { ...context, kind: "PHONE" }),
    ).rejects.toThrow();
  });
  it("does not collapse plus tags or dots", () => {
    expect(normalizeIdentifier("EMAIL", "A.B+tag@example.test")).toBe(
      "a.b+tag@example.test",
    );
  });
  it("requires explicit E.164 and does not guess a phone region", () => {
    expect(normalizeIdentifier("PHONE", " +14155552671 ")).toBe("+14155552671");
    expect(() => normalizeIdentifier("PHONE", "4155552671")).toThrow();
  });
  it.each(["NOTIFICATION_SNAPSHOT", "INVITATION_SNAPSHOT"] as const)(
    "encrypts the complete %s including recipient and bearer message",
    async (kind) => {
      const snapshot = JSON.stringify({
        recipient: "+14155552671",
        message: "Secret code 12345678",
        trackingUrl: "https://example.test/secret",
      });
      const sealed = await crypto().seal(snapshot, { ...context, kind });
      expect(JSON.stringify(sealed)).not.toContain("12345678");
      expect(await crypto().open(sealed, { ...context, kind })).toBe(snapshot);
      await expect(
        crypto().lookup(snapshot, { ...context, kind }),
      ).rejects.toThrow();
    },
  );
  it("rejects missing or shared encryption and HMAC keys", () => {
    expect(
      () => new LocalIdentityCrypto(new Map(), "enc-1", lookupKey, "lookup-1"),
    ).toThrow();
    expect(
      () =>
        new LocalIdentityCrypto(
          new Map([["enc-1", enc]]),
          "enc-1",
          enc,
          "lookup-1",
        ),
    ).toThrow();
  });
  it("projects only masked fields for APIs and ordinary external events", () => {
    expect(
      maskedIdentity({
        ...context,
        id: "opaque-id",
        ciphertext: "secret",
        value,
      } as { id: string; kind: string }),
    ).toEqual({ id: "opaque-id", kind: "EMAIL", value: "[protected]" });
  });
  it("never logs plaintext, including failure paths", async () => {
    const spies = [
      jest.spyOn(console, "log"),
      jest.spyOn(console, "warn"),
      jest.spyOn(console, "error"),
    ];
    try {
      const sealed = await crypto().seal(value, context);
      await crypto().open(sealed, context);
      await expect(
        crypto().open({ ...sealed, tag: value }, context),
      ).rejects.toThrow();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("keeps distinct identifiers distinct", async () => {
    expect(await crypto().lookup(value, context)).not.toEqual(
      await crypto().lookup("another.person@example.test", context),
    );
  });
  it("rejects the wrong key even when the key version label matches", async () => {
    const sealed = await crypto().seal(value, context);
    const wrong = new LocalIdentityCrypto(
      new Map([["enc-1", randomBytes(32)]]),
      "enc-1",
      lookupKey,
      "lookup-1",
    );
    await expect(wrong.open(sealed, context)).rejects.toThrow(
      "Protected identity operation unavailable.",
    );
  });
});
