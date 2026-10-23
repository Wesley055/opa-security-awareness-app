import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "crypto";
import {
  enrollmentOtpDigest,
  matchesEnrollmentOtp,
  newEnrollmentOtp,
} from "./enrollment-otp";
const config = new ConfigService({
  ENROLLMENT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
});
it("generates a six-digit OTP and stores a keyed transaction-bound verifier", () => {
  const id = randomUUID(),
    code = newEnrollmentOtp(config, id, "SMS", null),
    digest = enrollmentOtpDigest(config, id, "SMS", code);
  expect(code).toMatch(/^\d{6}$/);
  expect(digest).not.toContain(code);
  expect(matchesEnrollmentOtp(config, id, "SMS", code, digest)).toBe(true);
  expect(matchesEnrollmentOtp(config, id, "EMAIL", code, digest)).toBe(false);
  expect(matchesEnrollmentOtp(config, randomUUID(), "SMS", code, digest)).toBe(
    false,
  );
});
it("rejects a wrong OTP and a cleared verifier", () => {
  const id = randomUUID(),
    digest = enrollmentOtpDigest(config, id, "SMS", "123456");
  expect(matchesEnrollmentOtp(config, id, "SMS", "654321", digest)).toBe(false);
  expect(matchesEnrollmentOtp(config, id, "SMS", "123456", null)).toBe(false);
});
it("resend supersedes the old code", () => {
  const id = randomUUID(),
    old = enrollmentOtpDigest(config, id, "SMS", "123456"),
    next = newEnrollmentOtp(config, id, "SMS", old);
  expect(next).not.toBe("123456");
  expect(
    matchesEnrollmentOtp(
      config,
      id,
      "SMS",
      "123456",
      enrollmentOtpDigest(config, id, "SMS", next),
    ),
  ).toBe(false);
});
