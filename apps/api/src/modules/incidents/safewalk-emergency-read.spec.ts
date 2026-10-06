import { safeWalkEmergencyProvenance } from "./safewalk-emergency-read";
describe("stored SafeWalk emergency provenance", () => {
  it("does not infer emergency from a private journey or mismatched link", () => {
    expect(safeWalkEmergencyProvenance("i", null)).toBeNull();
    expect(
      safeWalkEmergencyProvenance("i", {
        purpose: "SAFEWALK",
        safeWalkEmergencyIncidentId: null,
        safeWalkEmergencyAt: null,
      }),
    ).toBeNull();
    expect(
      safeWalkEmergencyProvenance("i", {
        purpose: "SAFEWALK",
        safeWalkEmergencyIncidentId: "other",
        safeWalkEmergencyAt: new Date(),
      }),
    ).toBeNull();
  });
  it("projects only explicitly linked emergency source and timestamp", () => {
    const at = new Date("2026-10-04T00:00:00Z");
    expect(
      safeWalkEmergencyProvenance("i", {
        purpose: "SAFEWALK",
        safeWalkEmergencyIncidentId: "i",
        safeWalkEmergencyAt: at,
      }),
    ).toEqual({
      source: "SAFEWALK_EXPLICIT",
      emergencyStartedAt: at.toISOString(),
    });
  });
});
