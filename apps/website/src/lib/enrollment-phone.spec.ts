import { describe, it, expect } from "vitest";
import { normalizeEnrollmentPhone } from "./enrollment-phone";
describe("enrollment phone input", () => {
  it.each([
    ["07079390471", "+2347079390471"],
    ["2347079390471", "+2347079390471"],
    ["+234 707 939 0471", "+2347079390471"],
    ["+447911123456", "+447911123456"],
  ])("normalizes %s", (input, expected) =>
    expect(normalizeEnrollmentPhone(input)).toBe(expected),
  );
  it.each([
    "+23407079390471",
    "23407079390471",
    "0707939047",
    "+234707939047",
    "",
    "call 07079390471",
  ])("rejects malformed %s", (input) =>
    expect(() => normalizeEnrollmentPhone(input)).toThrow(),
  );
});
