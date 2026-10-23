import { ConfigService } from "@nestjs/config";
import {
  protectIdentity,
  revealIdentity,
  enrollmentDigest,
} from "./enrollment-identity";
describe("enrollment identity encryption", () => {
  const config = new ConfigService({
    ENROLLMENT_ENCRYPTION_KEY: "ab".repeat(32),
  });
  it("authenticates ciphertext, randomizes repeated identifiers and round trips", () => {
    const input = { email: "test@example.test", phoneNumber: "+2348012345678" };
    const one = protectIdentity(config, input),
      two = protectIdentity(config, input);
    expect(one).not.toBe(two);
    expect(one).not.toContain(input.email);
    expect(revealIdentity(config, one)).toEqual(input);
    const parts = one.split(".");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => revealIdentity(config, parts.join("."))).toThrow();
  });
  it("fails closed for missing/invalid keys and binds idempotency to scope", () => {
    expect(() => protectIdentity(new ConfigService(), {})).toThrow();
    expect(() =>
      protectIdentity(
        new ConfigService({ ENROLLMENT_ENCRYPTION_KEY: "bad" }),
        {},
      ),
    ).toThrow();
    expect(enrollmentDigest(config, "a:request")).not.toBe(
      enrollmentDigest(config, "b:request"),
    );
  });
});
