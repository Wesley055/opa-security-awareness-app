import { describe, it, expect } from "vitest";
import { parseInsight, validReportWindow } from "./insight-contract";
export const reportFixture = () => ({
  schemaVersion: 1,
  metrics: {
    incidentCount: 2,
    unresolved: 1,
    staleUnresolved: 1,
    resolutionLatency: { meanMs: 60000, known: 1, unknown: 0 },
    evidenceCompleteness: { present: 4, possible: 10 },
    missingEvidence: 1,
    missingClosureProvenance: 0,
    notificationOutcomes: { PROVIDER_ACCEPTED: 1, DELIVERED: 1 },
    byTrigger: { SOS_BUTTON: 2 },
    byActivationSource: { MANUAL: 2 },
    byActivationMode: { SILENT: 2 },
    byDayUtc: { "2026-01-01": 2 },
  },
  correctiveActions: {
    total: 2,
    open: 1,
    completed: 0,
    verified: 1,
    overdue: 1,
  },
});
describe("reporting contract", () => {
  it("projects known counts and never copies arbitrary identity fields", () => {
    const data = { ...reportFixture(), email: "private@example.test" };
    expect(JSON.stringify(parseInsight(data))).not.toContain("private");
    expect(parseInsight(data).delivery).toEqual({
      PROVIDER_ACCEPTED: 1,
      DELIVERED: 1,
    });
  });
  it("rejects absent metrics instead of inventing zero", () =>
    expect(() => parseInsight({ schemaVersion: 1 })).toThrow());
  it("rejects arbitrary breakdown labels", () => {
    const data = reportFixture();
    data.metrics.byActivationSource = { "private@example.test": 1 } as never;
    expect(() => parseInsight(data)).toThrow();
  });
  it("accepts exactly 366 days and rejects reversed or longer windows", () => {
    expect(validReportWindow("2024-01-01", "2025-01-01")).toBe(true);
    expect(validReportWindow("2024-01-01", "2025-01-02")).toBe(false);
    expect(validReportWindow("2025-01-01", "2024-01-01")).toBe(false);
    expect(validReportWindow("invalid", "2024-01-01")).toBe(false);
  });
});
