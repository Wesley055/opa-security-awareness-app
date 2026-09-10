// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => store }));
import { setAdminSession, clearAdminSession } from "./super-admin-session";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("uses separate HttpOnly secure strict cookies in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await setAdminSession("test-access", "test-refresh");
  expect(store.set).toHaveBeenNthCalledWith(
    1,
    "opa_super_admin_access",
    "test-access",
    {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 900,
    },
  );
  expect(store.set).toHaveBeenNthCalledWith(
    2,
    "opa_super_admin_refresh",
    "test-refresh",
    {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 2592000,
    },
  );
});
it("does not delete Viewer cookies on Super Admin logout", async () => {
  await clearAdminSession();
  expect(store.delete.mock.calls).toEqual([
    ["opa_super_admin_access"],
    ["opa_super_admin_refresh"],
  ]);
});
