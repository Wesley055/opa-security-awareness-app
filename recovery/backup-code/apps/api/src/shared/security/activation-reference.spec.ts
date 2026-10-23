import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "crypto";
import {
  activationReference,
  resolveActivationReference,
} from "./activation-reference";
import { protectIdentity } from "./enrollment-identity";
const config = new ConfigService({
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
});
it("round trips a bounded opaque reference without exposing its database ID", () => {
  const id = randomUUID(),
    reference = activationReference(config, id);
  expect(reference).not.toContain(id);
  expect(reference.length).toBeLessThan(512);
  expect(resolveActivationReference(config, reference)).toBe(id);
});
it.each(["", "bad", "v1.a.b.c", "x".repeat(513)])(
  "rejects malformed references safely: %s",
  (value) => {
    expect(() => resolveActivationReference(config, value)).toThrow(
      "Invitation unavailable",
    );
  },
);
it("rejects ciphertext substitution from another purpose", () => {
  expect(() =>
    resolveActivationReference(
      config,
      protectIdentity(config, { purpose: "OTHER", requestId: randomUUID() }),
    ),
  ).toThrow();
});
it("rejects a modified reference", () => {
  const ref = activationReference(config, randomUUID());
  expect(() =>
    resolveActivationReference(config, ref.slice(0, -8) + "AAAAAAAA"),
  ).toThrow();
});
it("preserves previously delivered UUID navigation without granting authorization", () => {
  const id = randomUUID();
  expect(resolveActivationReference(config, id)).toBe(id);
});
