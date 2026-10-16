// Test fixture only: a valid Head Office API response.
const latency = { meanMs: 120000, known: 1, unknown: 1 };
const branch = (id: string, region: string | null) => ({
  facilityId: id,
  name: "Branch " + id,
  region,
  openNow: 1,
  incidentCount: 2,
  unresolved: 1,
  staleUnresolved: 0,
  acknowledgementLatency: latency,
  resolutionLatency: { meanMs: null, known: 0, unknown: 2 },
  notificationOutcomes: { DELIVERED: 3, PROVIDER_ACCEPTED: 1, FAILED: 0 },
  correctiveActions: { open: 1, overdue: 1 },
});
export const headOfficeFixture = () => ({
  schemaVersion: 1,
  organization: { id: "bank", name: "Demo Bank" },
  region: null,
  regions: ["FCT", "Lagos"],
  observedAt: "2026-10-16T12:00:00.000Z",
  totals: { branches: 2, ...branch("total", null) },
  branches: [branch("lagos", "Lagos"), branch("abuja", "FCT")],
});
