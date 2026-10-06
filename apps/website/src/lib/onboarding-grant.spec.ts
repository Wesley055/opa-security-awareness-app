import { describe, it, expect } from "vitest";
import { grantExpiry } from "./onboarding-grant";
describe("bounded grant duration", () => {
  const now = Date.UTC(2026, 8, 26, 12);
  it.each([
    ["4h", 4],
    ["8h", 8],
    ["24h", 24],
    ["3d", 72],
  ] as const)("calculates %s", (value, hours) =>
    expect(Date.parse(grantExpiry(value, "", now))).toBe(now + hours * 3600000),
  );
  it("requires a future custom time", () => {
    expect(() => grantExpiry("custom", "", now)).toThrow();
    expect(() =>
      grantExpiry("custom", new Date(now).toISOString(), now),
    ).toThrow();
    expect(grantExpiry("custom", new Date(now + 1000).toISOString(), now)).toBe(
      new Date(now + 1000).toISOString(),
    );
  });
});
