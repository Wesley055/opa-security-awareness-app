import type { ConfigService } from "@nestjs/config";
import { randomInt, timingSafeEqual } from "crypto";
import { enrollmentDigest } from "./enrollment-identity";
import { hashActivationCredential } from "./activation-code";
export type ProofChannel = "EMAIL" | "SMS";
export function enrollmentOtpDigest(
  config: ConfigService,
  id: string,
  channel: ProofChannel,
  code: string,
): string {
  return enrollmentDigest(
    config,
    JSON.stringify(["OPA_CONTACT_OTP_V1", id, channel, code]),
  );
}
export function matchesEnrollmentOtp(
  config: ConfigService,
  id: string,
  channel: ProofChannel,
  value: string,
  expected: string | null,
): boolean {
  if (!expected) return false;
  const code = value.trim();
  // Previously delivered high-entropy proofs remain valid until their original expiry.
  const actual = /^\d{6}$/.test(code)
    ? enrollmentOtpDigest(config, id, channel, code)
    : hashActivationCredential(code);
  const a = Buffer.from(actual, "hex"),
    b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function newEnrollmentOtp(
  config: ConfigService,
  id: string,
  channel: ProofChannel,
  previous: string | null,
): string {
  let code: string;
  do {
    code = randomInt(0, 1000000).toString().padStart(6, "0");
  } while (matchesEnrollmentOtp(config, id, channel, code, previous));
  return code;
}
