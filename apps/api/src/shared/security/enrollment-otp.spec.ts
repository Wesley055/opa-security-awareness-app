import { createHash } from "crypto";
import {
  enrollmentCodeDigest,
  enrollmentCodeMatches,
  generateEnrollmentOtp,
  normalizeEnrollmentCode,
} from "./activation-code";
import { enrollmentExpiryText } from "../../modules/admin-provisioning/identity-delivery";

const KEY = "ab".repeat(32);
const OTHER = "cd".repeat(32);

describe("enrollment one-time codes", () => {
  it("are exactly 4 digits, including leading zeros", () => {
    for (let i = 0; i < 2000; i++) expect(generateEnrollmentOtp()).toMatch(/^\d{4}$/);
  });

  it("forgive spaces, dashes and full-width digits when typed", () => {
    expect(normalizeEnrollmentCode(" 04 21 ")).toBe("0421");
    expect(normalizeEnrollmentCode("04-21")).toBe("0421");
    expect(normalizeEnrollmentCode("０４２１")).toBe("0421");
  });

  it("are stored as a keyed digest that depends on the server secret", () => {
    const d = enrollmentCodeDigest("0421", KEY);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(d).not.toBe(createHash("sha256").update("0421").digest("hex"));
    expect(enrollmentCodeDigest("0421", OTHER)).not.toBe(d);
  });

  it("match only the right code and the right secret", () => {
    const d = enrollmentCodeDigest("0421", KEY);
    expect(enrollmentCodeMatches("0421", d, KEY)).toBe(true);
    expect(enrollmentCodeMatches(" 0421 ", d, KEY)).toBe(true);
    expect(enrollmentCodeMatches("0422", d, KEY)).toBe(false);
    expect(enrollmentCodeMatches("0421", d, OTHER)).toBe(false);
    expect(enrollmentCodeMatches("0421", null, KEY)).toBe(false);
    expect(enrollmentCodeMatches("0421", "not-a-digest", KEY)).toBe(false);
  });

  it("still accept long codes issued before this change, until they expire", () => {
    const legacy = "Zq3s9V-long_base64url_token_from_before_xyz12";
    const stored = createHash("sha256").update(legacy).digest("hex");
    expect(enrollmentCodeMatches(legacy, stored, KEY)).toBe(true);
    expect(enrollmentCodeMatches("0421", stored, KEY)).toBe(false);
  });

  it("show expiry in Nigerian time", () => {
    expect(enrollmentExpiryText(new Date("2026-10-18T13:30:00Z"))).toBe("18 Oct, 14:30 WAT");
  });
});
