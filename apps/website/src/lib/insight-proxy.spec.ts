import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/operator-context", () => ({ getOperatorContext: vi.fn() }));
vi.mock("@/lib/console-api", () => ({ consoleApi: vi.fn() }));
vi.mock("@/lib/institutional-session", () => ({
  institutionalTokens: vi.fn(),
}));
vi.mock("@/lib/super-admin-api", () => ({
  upstream: vi.fn(),
  AdminFailure: class extends Error {
    constructor(public status: number) {
      super();
    }
  },
}));
import { getOperatorContext } from "./operator-context";
import { consoleApi } from "./console-api";
import { institutionalTokens } from "./institutional-session";
import { upstream } from "./super-admin-api";
import { GET as operator } from "@/app/api/operator/reports/route";
import { GET as institutional } from "@/app/api/institutional/reports/route";
const reportFixture = () => ({
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
const facility = "11111111-1111-4111-8111-111111111111",
  query = "from=2026-01-01&to=2026-02-01";
beforeEach(() => {
  vi.mocked(getOperatorContext).mockResolvedValue({
    state: "READY",
    context: {
      userId: "actor",
      role: "FACILITY_OPERATOR",
      firstName: "Masked",
      lastName: "",
      facility: {
        id: facility,
        name: "A",
        type: "OTHER",
        isActive: true,
        isVerified: true,
      },
    },
  });
  vi.mocked(consoleApi).mockResolvedValue({
    status: 200,
    data: reportFixture(),
  });
  vi.mocked(institutionalTokens).mockResolvedValue({
    accessToken: crypto.randomUUID(),
    refreshToken: undefined,
  });
  vi.mocked(upstream).mockImplementation(async (path) =>
    path === "/institutional/context"
      ? { actor: { id: "actor", role: "FACILITY_ADMIN" } }
      : reportFixture(),
  );
});
describe("bounded reporting proxies", () => {
  it("operator uses only current authoritative facility and projects fields", async () => {
    const response = await operator(
      new Request("http://localhost/api/operator/reports?" + query),
    );
    expect(response.status).toBe(200);
    expect(consoleApi).toHaveBeenCalledWith(
      expect.stringContaining("facilityId=" + facility),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["&facilityId=foreign", "&path=/admin", "&from=2026-01-02"])(
    "rejects browser scope or arbitrary/duplicate parameters %s",
    async (suffix) => {
      expect(
        (
          await operator(
            new Request(
              "http://localhost/api/operator/reports?" + query + suffix,
            ),
          )
        ).status,
      ).toBe(400);
      expect(consoleApi).not.toHaveBeenCalled();
    },
  );
  it("propagates authority denial and outages without session changes", async () => {
    vi.mocked(consoleApi).mockResolvedValue({ status: 403 });
    expect(
      (await operator(new Request("http://localhost/?" + query))).status,
    ).toBe(403);
    vi.mocked(consoleApi).mockResolvedValue({ status: 503 });
    expect(
      (await operator(new Request("http://localhost/?" + query))).status,
    ).toBe(503);
  });
  it("institutional requires matching actor context and bounded facility selection", async () => {
    const response = await institutional(
      new Request(
        "http://localhost/api/institutional/reports?" +
          query +
          "&facilityId=" +
          facility,
        { headers: { "x-institutional-actor": "actor:FACILITY_ADMIN" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenLastCalledWith(
      expect.stringContaining("/internal/insight/overview?"),
      expect.any(String),
    );
  });
  it("denies stale actor before querying reports", async () => {
    expect(
      (
        await institutional(
          new Request(
            "http://localhost/?" + query + "&facilityId=" + facility,
            { headers: { "x-institutional-actor": "old:FACILITY_ADMIN" } },
          ),
        )
      ).status,
    ).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("does not treat Technical Support audit access as aggregate reporting authority", async () => {
    vi.mocked(upstream).mockResolvedValue({
      actor: { id: "actor", role: "TECHNICAL_SUPPORT" },
    });
    expect(
      (
        await institutional(
          new Request(
            "http://localhost/?" + query + "&facilityId=" + facility,
            { headers: { "x-institutional-actor": "actor:TECHNICAL_SUPPORT" } },
          ),
        )
      ).status,
    ).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
