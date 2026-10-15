import { assessResponse, policyEvidence } from "./insight.compliance";
import type { Source } from "./insight.projection";
const at = new Date("2026-01-01T00:00:00Z");
const policy = policyEvidence(
  {
    version: 7,
    acknowledgementSeconds: 60,
    dispatchSeconds: 120,
    unattendedSeconds: 180,
    closureSeconds: 600,
    progressSeconds: 120,
  },
  new Date(+at - 1000),
  "policy-audit",
)!;
const source = (): Source => ({
  id: "incident",
  facilityId: "facility",
  trigger: "SOS_BUTTON",
  status: "OPEN",
  createdAt: at,
  updatedAt: at,
  resolvedAt: null,
  latitude: null,
  longitude: null,
  journeySession: null,
  evidence: [],
  notifications: [],
  timelineEvents: [],
});
function event(
  type: string,
  seconds: number,
  sequence = 1,
  writer = "COMMAND_CENTER",
) {
  return {
    id: `event-${sequence}`,
    sequence,
    type,
    source: writer,
    actorUserId: "actor",
    payload: { newStatus: "RESOLVED" },
    occurredAt: new Date(+at + seconds * 1000),
    recordedAt: new Date(+at + seconds * 1000),
  };
}
describe("institutional response controls", () => {
  it("uses the evidenced facility threshold and policy version, including the exact boundary", () => {
    const row = source();
    row.timelineEvents = [event("OPERATOR_ACKNOWLEDGED", 60)];
    const result = assessResponse(row, policy, new Date(+at + 120000));
    expect(result.policy?.version).toBe(7);
    expect(
      result.findings.find((f) => f.control === "ACKNOWLEDGEMENT"),
    ).toMatchObject({
      status: "COMPLIANT",
      observedSeconds: 60,
      thresholdSeconds: 60,
    });
    const strict = { ...policy, acknowledgementSeconds: 59 };
    expect(
      assessResponse(row, strict, new Date(+at + 120000)).findings[0]?.status,
    ).toBe("NON_COMPLIANT");
  });
  it("never turns missing evidence or missing policy into false compliance or a breach", () => {
    const result = assessResponse(source(), policy, new Date(+at + 86400000));
    expect(
      result.findings.slice(0, 5).every((f) => f.status === "INDETERMINATE"),
    ).toBe(true);
    const row = source();
    row.timelineEvents = [event("OPERATOR_ACKNOWLEDGED", 1)];
    expect(
      assessResponse(row, null, new Date(+at + 120000)).findings[0]?.status,
    ).toBe("INDETERMINATE");
    expect(result.complianceClaim).toBeNull();
    expect(result.regulatoryMappings).toEqual([]);
    expect(policyEvidence({ version: 1 }, at, "bad")).toBeNull();
  });
  it("ignores mobile assertions, future records, and post-closure operator actions", () => {
    const row = source();
    row.timelineEvents = [
      event("OPERATOR_ACKNOWLEDGED", 1, 1, "MOBILE"),
      event("OPERATOR_ACKNOWLEDGED", 120, 2),
    ];
    expect(
      assessResponse(row, policy, new Date(+at + 60000)).findings[0]?.status,
    ).toBe("INDETERMINATE");
    row.status = "RESOLVED";
    row.resolvedAt = new Date(+at + 10000);
    expect(
      assessResponse(row, policy, new Date(+at + 180000)).findings[0]?.status,
    ).toBe("INDETERMINATE");
  });
  it("requires matching authoritative closure state and timestamp", () => {
    const row = source();
    row.status = "RESOLVED";
    row.resolvedAt = new Date(+at + 300000);
    row.timelineEvents = [event("INCIDENT_RESOLVED", 300, 1, "MOBILE")];
    expect(
      assessResponse(row, policy, new Date(+at + 400000)).findings.find(
        (f) => f.control === "CLOSURE_PROVENANCE",
      )?.status,
    ).toBe("COMPLIANT");
    row.resolvedAt = new Date(+at + 301000);
    expect(
      assessResponse(row, policy, new Date(+at + 400000)).findings.find(
        (f) => f.control === "CLOSURE_PROVENANCE",
      )?.status,
    ).toBe("INDETERMINATE");
  });
  it("starts dispatch timing at acknowledgement and distinguishes recorded late progress from absent progress", () => {
    const row = source();
    row.timelineEvents = [
      event("OPERATOR_ACKNOWLEDGED", 30, 1),
      event("OPERATOR_DISPATCHED", 100, 2),
      event("OPERATOR_RESPONSE_PROGRESS", 230, 3),
    ];
    const result = assessResponse(row, policy, new Date(+at + 240000));
    expect(result.findings.find((f) => f.control === "DISPATCH")).toMatchObject(
      { status: "COMPLIANT", observedSeconds: 70 },
    );
    expect(
      result.findings.find((f) => f.control === "RESPONSE_PROGRESS")?.status,
    ).toBe("NON_COMPLIANT");
    row.timelineEvents.pop();
    expect(
      assessResponse(row, policy, new Date(+at + 240000)).findings.find(
        (f) => f.control === "RESPONSE_PROGRESS",
      )?.status,
    ).toBe("INDETERMINATE");
  });
  it("marks cancelled response obligations not applicable", () => {
    const row = source();
    row.status = "CANCELLED";
    expect(
      assessResponse(row, policy, new Date(+at + 240000)).findings.every(
        (f) => f.status === "NOT_APPLICABLE",
      ),
    ).toBe(true);
  });
});
