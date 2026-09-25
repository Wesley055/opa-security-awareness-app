import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./super-admin-api", () => ({
  AdminFailure: class extends Error {},
  requireAdmin: vi.fn(),
  upstream: vi.fn(),
}));
vi.mock("./onboarding-session", () => ({}));
import { onboardingPath, projectOnboarding } from "./onboarding-proxy";
const id = "00000000-0000-4000-8000-000000000001";
describe("onboarding proxy allowlist", () => {
  it.each([
    "residents",
    "incidents",
    "evidence",
    "safewalk",
    "protected-identities",
    "sso",
    "reports",
    "employees",
    "../admin/facilities",
    `facilities/${id}/members`,
  ])("denies support access to %s", (path) => {
    expect(onboardingPath(path.split("/"), "GET", false)).toBeNull();
    expect(onboardingPath(path.split("/"), "POST", false)).toBeNull();
  });
  it("allows only staff creation and bounded lifecycle", () => {
    expect(onboardingPath(["operators"], "POST", false)).toBe(
      "/onboarding/operators",
    );
    expect(onboardingPath(["facility-admins"], "POST", false)).toBe(
      "/onboarding/facility-admins",
    );
    expect(
      onboardingPath(
        ["facilities", id, "invitations", id, "revoke"],
        "POST",
        false,
      ),
    ).toContain("/onboarding/facilities/");
    expect(onboardingPath(["facilities"], "POST", false)).toBeNull();
  });
  it("keeps grant lifecycle on ADMIN-only upstream", () => {
    expect(onboardingPath(["employees", id, "revoke-all"], "POST", true)).toBe(
      `/admin/onboarding/employees/${id}/revoke-all`,
    );
    expect(
      onboardingPath(["employees", id, "revoke-all"], "POST", false),
    ).toBeNull();
  });
  it("removes protected identity and tokens recursively", () => {
    expect(
      projectOnboarding({
        users: [
          {
            id,
            email: "secret",
            phoneNumber: "secret",
            firstName: "secret",
            passwordHash: "secret",
          },
        ],
        invitations: [
          {
            id,
            identityCiphertext: "secret",
            emailTokenHash: "secret",
            deliveries: [{ status: "QUEUED", recipient: "secret" }],
          },
        ],
      }),
    ).toEqual({
      users: [{ id }],
      invitations: [{ id, deliveries: [{ status: "QUEUED" }] }],
    });
  });
});
