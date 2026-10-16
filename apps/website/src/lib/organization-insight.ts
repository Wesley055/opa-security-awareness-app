// Allowlisted Head Office transport: aggregate figures only. Never forward
// arbitrary API fields, identities, evidence or locations to the browser.
export type Latency = { meanMs: number | null; known: number; unknown: number };
export type BranchSummary = {
  facilityId: string;
  name: string;
  region: string | null;
  openNow: number;
  incidentCount: number;
  unresolved: number;
  staleUnresolved: number;
  acknowledgement: Latency;
  resolution: Latency;
  delivered: number;
  providerAccepted: number;
  failed: number;
  openActions: number;
  overdueActions: number;
};
export type HeadOfficeSummary = {
  organization: { id: string; name: string };
  region: string | null;
  regions: string[];
  observedAt: string;
  totals: Omit<BranchSummary, "facilityId" | "name" | "region"> & {
    branches: number;
  };
  branches: BranchSummary[];
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
const text = (v: unknown, max = 160): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw Error("Invalid label");
  return v;
};
const latency = (v: unknown): Latency => {
  const r = row(v);
  return {
    meanMs: r.meanMs === null ? null : count(r.meanMs),
    known: count(r.known),
    unknown: count(r.unknown),
  };
};
function figures(r: Record<string, unknown>) {
  const outcomes = row(r.notificationOutcomes),
    actions = row(r.correctiveActions);
  return {
    openNow: count(r.openNow),
    incidentCount: count(r.incidentCount),
    unresolved: count(r.unresolved),
    staleUnresolved: count(r.staleUnresolved),
    acknowledgement: latency(r.acknowledgementLatency),
    resolution: latency(r.resolutionLatency),
    delivered: count(outcomes.DELIVERED ?? 0),
    providerAccepted: count(outcomes.PROVIDER_ACCEPTED ?? 0),
    failed: count(outcomes.FAILED ?? 0),
    openActions: count(actions.open),
    overdueActions: count(actions.overdue),
  };
}
export function parseHeadOffice(value: unknown): HeadOfficeSummary {
  const data = row(value),
    organization = row(data.organization),
    totals = row(data.totals);
  if (data.schemaVersion !== 1 || !Array.isArray(data.branches))
    throw Error("Unsupported Head Office contract");
  return {
    organization: { id: text(organization.id, 64), name: text(organization.name) },
    region: data.region === null ? null : text(data.region, 80),
    regions: Array.isArray(data.regions)
      ? data.regions.map((r) => text(r, 80))
      : [],
    observedAt: text(data.observedAt, 40),
    totals: { branches: count(totals.branches), ...figures(totals) },
    branches: data.branches.map((b) => {
      const r = row(b);
      return {
        facilityId: text(r.facilityId, 64),
        name: text(r.name),
        region: r.region === null ? null : text(r.region, 80),
        ...figures(r),
      };
    }),
  };
}
