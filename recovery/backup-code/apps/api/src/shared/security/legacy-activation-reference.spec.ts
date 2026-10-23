import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import {
  legacyActivationReference,
  matchesLegacyActivationReference,
} from "./activation-reference";
const config = new ConfigService({
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
});
it("binds the resident link to the same stored OTP verifier", () => {
  const hash = randomBytes(32).toString("hex"),
    ref = legacyActivationReference(config, hash);
  expect(ref).not.toContain(hash);
  expect(matchesLegacyActivationReference(config, ref, hash)).toBe(true);
  expect(
    matchesLegacyActivationReference(
      config,
      ref,
      randomBytes(32).toString("hex"),
    ),
  ).toBe(false);
});
it("rejects malformed resident link references", () =>
  expect(matchesLegacyActivationReference(config, "bad", "a".repeat(64))).toBe(
    false,
  ));
