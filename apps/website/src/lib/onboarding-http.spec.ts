import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  upstream: vi.fn(),
  requireAdmin: vi.fn(),
  access: vi.fn(),
  refresh: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./super-admin-api", () => ({
  AdminFailure: class extends Error {
    constructor(public status: number) {
      super("API failure");
    }
  },
  requireAdmin: mocks.requireAdmin,
  upstream: mocks.upstream,
}));
vi.mock("./onboarding-session", () => ({
  onboardingAccess: mocks.access,
  onboardingRefresh: mocks.refresh,
  setOnboardingSession: mocks.save,
  clearOnboardingSession: mocks.clear,
}));
import { onboardingProxy } from "./onboarding-proxy";
const id = "00000000-0000-4000-8000-000000000001";
describe("onboarding HTTP boundary", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.access.mockResolvedValue("support-token");
    mocks.requireAdmin.mockResolvedValue({ access: "admin-token" });
  });
  it("rejects cross-origin writes before contacting the API", async () => {
    const response = await onboardingProxy(
      new Request("https://opa.test/api/onboarding/operators", {
        method: "POST",
        headers: { origin: "https://attacker.test" },
        body: "{}",
      }),
      ["operators"],
      false,
    );
    expect(response.status).toBe(403);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("uses the support cookie only for bounded requests and projects the response", async () => {
    mocks.upstream.mockResolvedValue({
      facilities: [{ id, name: "Assigned", phoneNumber: "private" }],
    });
    const response = await onboardingProxy(
      new Request("https://opa.test/api/onboarding/facilities"),
      ["facilities"],
      false,
    );
    expect(mocks.upstream).toHaveBeenCalledWith(
      "/onboarding/facilities",
      "support-token",
      undefined,
      undefined,
    );
    expect(await response.json()).toEqual({
      facilities: [{ id, name: "Assigned" }],
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("requires the independent ADMIN gate for employee offboarding", async () => {
    mocks.upstream.mockResolvedValue({ revokedCount: 2 });
    const response = await onboardingProxy(
      new Request("https://opa.test/api/onboarding-admin/offboard", {
        method: "POST",
        headers: {
          origin: "https://opa.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "Offboarding" }),
      }),
      ["employees", id, "revoke-all"],
      true,
    );
    expect(response.status).toBe(200);
    expect(mocks.requireAdmin).toHaveBeenCalled();
    expect(mocks.upstream).toHaveBeenCalledWith(
      `/admin/onboarding/employees/${id}/revoke-all`,
      "admin-token",
      { reason: "Offboarding" },
      undefined,
    );
  });
  it("does not establish a support session without a current facility grant", async () => {
    mocks.upstream
      .mockResolvedValueOnce({ accessToken: "access", refreshToken: "refresh" })
      .mockResolvedValueOnce({ facilities: [] });
    const response = await onboardingProxy(
      new Request("https://opa.test/api/onboarding/login", {
        method: "POST",
        headers: { origin: "https://opa.test" },
        body: JSON.stringify({
          email: randomUUID() + "@example.test",
          password: randomBytes(24).toString("base64url") + "aA1!",
        }),
      }),
      ["login"],
      false,
    );
    expect(response.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("Token");
  });
});
