// Allowlisted aggregate transport: never forward arbitrary API fields.
export type InsightSummary = {
  incidentCount: number;
  unresolved: number;
  staleUnresolved: number;
  resolutionMeanMs: number | null;
  resolutionKnown: number;
  resolutionUnknown: number;
  evidencePresent: number;
  evidencePossible: number;
  missingEvidence: number;
  missingClosureProvenance: number;
  actions: Record<string, number>;
  delivery: Record<string, number>;
  byTrigger: Record<string, number>;
  bySource: Record<string, number>;
  byMode: Record<string, number>;
  byDay: Record<string, number>;
};
const row = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const count = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
    throw Error("Invalid aggregate");
  return v;
};
function counts(value: unknown, keys?: string[]): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Missing aggregate breakdown");
  return Object.fromEntries(
    Object.entries(row(value)).map(([k, v]) => {
      if (keys ? !keys.includes(k) : !/^\d{4}-\d{2}-\d{2}$/.test(k))
        throw Error("Invalid aggregate label");
      return [k, count(v)];
    }),
  );
}
export function parseInsight(value: unknown): InsightSummary {
  const data = row(value),
    m = row(data.metrics),
    coverage = row(m.evidenceCompleteness),
    resolution = row(m.resolutionLatency);
  if (data.schemaVersion !== 1 || !m.notificationOutcomes)
    throw Error("Unsupported reporting contract");
  return {
    incidentCount: count(m.incidentCount),
    unresolved: count(m.unresolved),
    staleUnresolved: count(m.staleUnresolved),
    resolutionMeanMs:
      resolution.meanMs === null ? null : count(resolution.meanMs),
    resolutionKnown: count(resolution.known),
    resolutionUnknown: count(resolution.unknown),
    evidencePresent: count(coverage.present),
    evidencePossible: count(coverage.possible),
    missingEvidence: count(m.missingEvidence),
    missingClosureProvenance: count(m.missingClosureProvenance),
    actions: counts(data.correctiveActions, [
      "total",
      "open",
      "completed",
      "verified",
      "overdue",
    ]),
    delivery: counts(m.notificationOutcomes, [
      "QUEUED",
      "ATTEMPTING",
      "PROVIDER_ACCEPTED",
      "DELIVERED",
      "FAILED",
      "UNKNOWN",
    ]),
    byTrigger: counts(m.byTrigger, [
      "SOS_BUTTON",
      "VOICE_HELP_HELP",
      "TRUSTED_CONTACT",
      "SYSTEM_TEST",
      "UNKNOWN",
    ]),
    bySource: counts(m.byActivationSource, [
      "MANUAL",
      "LOCK_SCREEN",
      "VOICE",
      "UNKNOWN",
    ]),
    byMode: counts(m.byActivationMode, ["STANDARD", "SILENT", "UNKNOWN"]),
    byDay: counts(m.byDayUtc),
  };
}
export function validReportWindow(from: string, to: string): boolean {
  const a = Date.parse(from),
    b = Date.parse(to);
  return (
    Number.isFinite(a) && Number.isFinite(b) && a < b && b - a <= 366 * 86400000
  );
}
