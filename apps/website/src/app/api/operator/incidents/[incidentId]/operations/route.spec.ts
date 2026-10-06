import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), upstream: vi.fn() }));
vi.mock("@/lib/operator-session", () => ({ getAccessToken: mocks.token }));
vi.mock("@/lib/super-admin-api", () => ({
  upstream: mocks.upstream,
  AdminFailure: class extends Error {
    constructor(public status: number) {
      super();
    }
  },
}));
import { AdminFailure } from "@/lib/super-admin-api";
import { POST } from "./route";
const id = "6d08a466-e685-4123-a06e-c281e389a221";
const payload = {
  type: "ACKNOWLEDGED",
  note: "Response received",
  correlationId: id,
};
function call(
  body: unknown = payload,
  origin: string = "http://localhost:3001",
  incidentId = id,
) {
  return POST(
    new Request(
      "http://localhost:3001/api/operator/incidents/" + id + "/operations",
      { method: "POST", headers: { origin }, body: JSON.stringify(body) },
    ),
    { params: Promise.resolve({ incidentId }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.token.mockResolvedValue(crypto.randomUUID());
  mocks.upstream.mockResolvedValue({});
});
describe("bounded Operator operations bridge", () => {
  it.each(["SEEN", "ACKNOWLEDGED", "DISPATCHED", "RESPONSE_PROGRESS", "ESCALATION"])(
    "forwards only canonical %s operation",
    async (type) => {
      expect((await call({ ...payload, type })).status).toBe(200);
      expect(mocks.upstream).toHaveBeenCalledWith(
        "/incidents/" + id + "/operations",
        expect.any(String),
        { ...payload, type },
      );
    },
  );
  it.each(["RESOLVED", "CANCELLED", "DELETE", "ASSIGN_ADMIN"])(
    "rejects prohibited %s",
    async (type) => {
      expect((await call({ ...payload, type })).status).toBe(400);
      expect(mocks.upstream).not.toHaveBeenCalled();
    },
  );
  it.each([401, 403, 404, 409])(
    "preserves backend denial %s",
    async (status) => {
      mocks.upstream.mockRejectedValue(new AdminFailure(status));
      expect((await call()).status).toBe(status);
    },
  );
  it("rejects cross-origin writes", async () => {
    expect((await call(payload, "https://other.example")).status).toBe(403);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("rejects absent session", async () => {
    mocks.token.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("rejects arbitrary paths and caller authority", async () => {
    expect((await call(payload, undefined, "../resolve")).status).toBe(400);
    expect((await call({ ...payload, role: "ADMIN" })).status).toBe(400);
  });
  it("requires bounded provenance note", async () => {
    expect((await call({ ...payload, note: "" })).status).toBe(400);
    expect((await call({ ...payload, note: "x".repeat(5000) })).status).toBe(
      413,
    );
  });
});
