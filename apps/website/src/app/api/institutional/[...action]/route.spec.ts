import { randomUUID } from "node:crypto";
import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  upstream: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: mocks.get,
    set: mocks.set,
    delete: mocks.remove,
  }),
}));
vi.mock("@/lib/super-admin-api", () => ({
  upstream: mocks.upstream,
  AdminFailure: class extends Error {
    constructor(public status: number) {
      super("denied");
    }
  },
}));
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const params = (action: string) => ({
  params: Promise.resolve({ action: action.split("/") }),
});
beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.get.mockImplementation((name) =>
    name === "opa_institutional_access" ? { value: randomUUID() } : undefined,
  );
  mocks.upstream.mockResolvedValue({
    actor: { id, role: "TECHNICAL_SUPPORT" },
    facilities: [],
  });
});
describe("institutional HTTP boundary", () => {
  it("denies cross-origin writes without an upstream operation", async () => {
    const r = await POST(
      new Request("https://opa.test/api/institutional/admin/invitations", {
        method: "POST",
        headers: { origin: "https://foreign.test" },
        body: "{}",
      }),
      params("admin/invitations"),
    );
    expect(r.status).toBe(403);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("ignores unrelated cookies", async () => {
    mocks.get.mockImplementation((name) =>
      name === "opa_super_admin_access" ? { value: randomUUID() } : undefined,
    );
    const r = await GET(
      new Request("https://opa.test/api/institutional/context"),
      params("context"),
    );
    expect(r.status).toBe(401);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("requires matching current actor before forwarding an operation", async () => {
    const r = await POST(
      new Request(
        "https://opa.test/api/institutional/facilities/" + id + "/invitations",
        {
          method: "POST",
          headers: {
            origin: "https://opa.test",
            "x-institutional-actor": "stale:ADMIN",
          },
          body: "{}",
        },
      ),
      params("facilities/" + id + "/invitations"),
    );
    expect(r.status).toBe(403);
    expect(mocks.upstream).toHaveBeenCalledTimes(1);
  });
  it("never forwards a forbidden method/path", async () => {
    const r = await POST(
      new Request(
        "https://opa.test/api/institutional/incidents/" + id + "/delete",
        { method: "POST", headers: { origin: "https://opa.test" }, body: "{}" },
      ),
      params("incidents/" + id + "/delete"),
    );
    expect(r.status).toBe(404);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("projects context without plaintext identifiers", async () => {
    mocks.upstream.mockResolvedValue({
      actor: {
        id,
        role: "TECHNICAL_SUPPORT",
        email: randomUUID() + "@example.test",
      },
      facilities: [],
      accessToken: randomUUID(),
    });
    const r = await GET(
      new Request("https://opa.test/api/institutional/context"),
      params("context"),
    );
    expect(await r.json()).toEqual({
      actor: { id, role: "TECHNICAL_SUPPORT" },
      facilities: [],
    });
  });
  it("rejects oversized login bodies before authentication", async () => {
    const r = await POST(
      new Request("https://opa.test/api/institutional/login", {
        method: "POST",
        headers: { origin: "https://opa.test" },
        body: JSON.stringify({
          email: randomUUID() + "@example.test",
          password: randomUUID().repeat(600),
        }),
      }),
      params("login"),
    );
    expect(r.status).toBe(413);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
});
