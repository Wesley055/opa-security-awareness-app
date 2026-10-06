import { describe, it, expect } from "vitest";
import { parseSafeWalkProtection } from "./safewalk-protection";
import { emergencyFixture, facility } from "@/test/safewalk-emergency";
describe("SafeWalk bounded presentation contract", () => {
  it("projects only emergency facts and discards private fields", () => {
    const input = {
      ...emergencyFixture(),
      destination: "PRIVATE_DESTINATION",
      guardians: ["PRIVATE_GUARDIAN"],
      phone: "PRIVATE_PHONE",
    };
    expect(
      JSON.stringify(parseSafeWalkProtection(input, facility)),
    ).not.toContain("PRIVATE_");
  });
  it("rejects mismatched facility", () =>
    expect(() =>
      parseSafeWalkProtection(emergencyFixture(), "foreign"),
    ).toThrow());
  it("rejects unknown provenance/telemetry labels", () => {
    const input = emergencyFixture();
    input.incidents[0].trackingState = "PRIVATE_DESTINATION";
    expect(() => parseSafeWalkProtection(input)).toThrow();
  });
  it("rejects malformed response instead of reporting an empty queue", () =>
    expect(() => parseSafeWalkProtection({})).toThrow());
  it("accepts authoritative empty state", () =>
    expect(
      parseSafeWalkProtection({ ...emergencyFixture(), incidents: [] })
        .incidents,
    ).toEqual([]));
});
