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
import { upstream, AdminFailure } from "./super-admin-api";
import { GET as operator } from "@/app/api/operator/safewalk/route";
import { GET as institutional } from "@/app/api/institutional/safewalk/route";
import {
  emergencyFixture,
  facility,
  supportCase,
} from "@/test/safewalk-emergency";
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
    data: emergencyFixture(),
  });
  vi.mocked(institutionalTokens).mockResolvedValue({
    accessToken: crypto.randomUUID(),
    refreshToken: undefined,
  });
  vi.mocked(upstream).mockImplementation(async (path) =>
    path === "/institutional/context"
      ? { actor: { id: "actor", role: "TECHNICAL_SUPPORT" } }
      : emergencyFixture(),
  );
});
describe("SafeWalk fixed read proxies", () => {
  it("uses current Operator facility and no-store", async () => {
    const result = await operator(
      new Request("http://localhost/api/operator/safewalk"),
    );
    expect(result.status).toBe(200);
    expect(consoleApi).toHaveBeenCalledWith(
      "/institutional/facilities/" + facility + "/safewalk-emergencies",
    );
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    "facilityId=foreign",
    "url=https://elsewhere",
    "destination=private",
  ])("rejects operator-controlled scope/URL %s", async (query) => {
    expect(
      (await operator(new Request("http://localhost/?" + query))).status,
    ).toBe(400);
    expect(consoleApi).not.toHaveBeenCalled();
  });
  it("retains denied and degraded statuses without mutating sessions", async () => {
    vi.mocked(consoleApi).mockResolvedValue({ status: 403 });
    expect((await operator(new Request("http://localhost/"))).status).toBe(403);
    vi.mocked(consoleApi).mockResolvedValue({ status: 503 });
    expect((await operator(new Request("http://localhost/"))).status).toBe(503);
  });
  it("forwards only exact facility and current Support case to guarded endpoint", async () => {
    const result = await institutional(
      new Request(
        "http://localhost/?facilityId=" +
          facility +
          "&caseReference=" +
          supportCase,
        { headers: { "x-institutional-actor": "actor:TECHNICAL_SUPPORT" } },
      ),
    );
    expect(result.status).toBe(200);
    expect(upstream).toHaveBeenLastCalledWith(
      "/institutional/facilities/" +
        facility +
        "/safewalk-emergencies?caseReference=" +
        supportCase,
      expect.any(String),
    );
  });
  it("denies stale actor context before emergency read", async () => {
    expect(
      (
        await institutional(
          new Request("http://localhost/?facilityId=" + facility, {
            headers: { "x-institutional-actor": "old:ADMIN" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("does not override upstream case or tenant denial", async () => {
    vi.mocked(upstream).mockImplementation(async (path) => {
      if (path === "/institutional/context")
        return { actor: { id: "actor", role: "TECHNICAL_SUPPORT" } };
      throw new AdminFailure(403);
    });
    expect(
      (
        await institutional(
          new Request("http://localhost/?facilityId=" + facility, {
            headers: { "x-institutional-actor": "actor:TECHNICAL_SUPPORT" },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("rejects unknown and duplicate institutional parameters", async () => {
    for (const suffix of ["&url=other", "&facilityId=" + facility])
      expect(
        (
          await institutional(
            new Request("http://localhost/?facilityId=" + facility + suffix),
          )
        ).status,
      ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
