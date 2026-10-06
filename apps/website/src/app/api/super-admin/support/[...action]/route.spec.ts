import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), upstream: vi.fn() }));
vi.mock("@/lib/super-admin-api", () => ({
  requireAdmin: mocks.admin,
  upstream: mocks.upstream,
  AdminFailure: class extends Error {
    constructor(public status: number) {
      super();
    }
  },
}));
import { AdminFailure } from "@/lib/super-admin-api";
import { GET, POST } from "./route";
const id = "6d08a466-e685-4123-a06e-c281e389a221";
const context = {
  reason: "Reviewed appointment",
  caseReference: id,
  correlationId: id,
};
function call(path: string, body?: unknown, origin = "https://opa.test") {
  return (body ? POST : GET)(
    new Request("https://opa.test/api/super-admin/support/" + path, {
      method: body ? "POST" : "GET",
      headers: { origin, "idempotency-key": id, "x-platform-actor": id },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ action: path.split("/") }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ access: crypto.randomUUID(), actorId: id });
  mocks.upstream.mockResolvedValue({ ok: true });
});
describe("Super Admin support bridge", () => {
  it("allows only UUID cursor on authorized human-safe account discovery", async () => {
    mocks.upstream.mockResolvedValue({ accounts: [{ id, displayIdentity: "K••• · Account ABC", email: "private@example.test", membershipState: "ACTIVE" }], nextCursor: null });
    const invoke = (query: string) => GET(new Request("https://opa.test/api/super-admin/support/accounts" + query), { params: Promise.resolve({ action: ["accounts"] }) });
    const result = await invoke("?cursor=" + id);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ accounts: [{ id, displayIdentity: "K••• · Account ABC", membershipState: "ACTIVE" }], nextCursor: null });
    expect(mocks.upstream).toHaveBeenCalledWith("/admin/support/accounts?cursor=" + id, expect.any(String), undefined, undefined);
    expect((await invoke("?cursor=bad")).status).toBe(400);
    expect((await invoke("?email=private@example.test")).status).toBe(400);
  });
  it("projects directory state without plaintext contacts/secrets", async () => {
    mocks.upstream.mockResolvedValue({
      employees: [
        {
          id,
          email: "private@example.test",
          phoneNumber: "private",
          passwordHash: "private",
          supportEmployment: { state: "ACTIVE" },
        },
      ],
    });
    expect(await (await call("employees")).json()).toEqual({
      employees: [{ id, supportEmployment: { state: "ACTIVE" } }],
    });
  });
  it.each(["ACTIVE", "SUSPENDED", "ENDED"])(
    "forwards employment %s with provenance only",
    async (state) => {
      expect(
        (await call("employees/" + id + "/employment", { ...context, state }))
          .status,
      ).toBe(200);
      expect(mocks.upstream).toHaveBeenCalledWith(
        "/admin/support/employees/" + id + "/employment",
        expect.any(String),
        { ...context, state },
        undefined,
      );
    },
  );
  it("forwards grant/revoke with exact scope, expiry and provenance", async () => {
    const body = {
      ...context,
      capability: "STAFF_RECOVER_ACCESS",
      facilityId: id,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    expect((await call("employees/" + id + "/grants", body)).status).toBe(200);
    expect(mocks.upstream).toHaveBeenLastCalledWith(
      "/admin/support/employees/" + id + "/grants",
      expect.any(String),
      body,
      undefined,
    );
    expect((await call("grants/" + id + "/revoke", context)).status).toBe(200);
  });
  it("forwards invitation identity and stable key but never caller role", async () => {
    expect(
      (
        await call("invitations", {
          ...context,
          firstName: "Synthetic",
          lastName: "Test",
          email: "test@example.test",
          phoneNumber: "+2348031234567",
        })
      ).status,
    ).toBe(200);
    expect(mocks.upstream.mock.calls[0][3]).toBe(id);
    expect(
      (await call("invitations", { ...context, role: "ADMIN" })).status,
    ).toBe(400);
  });
  it.each([
    "facilities",
    "employees/" + id + "/delete",
    "../facilities",
    "grants/" + id + "/grant",
  ])("rejects unallowlisted path %s", async (path) => {
    expect((await call(path, context)).status).toBe(404);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, blank reason and oversized body", async () => {
    expect(
      (await call("invitations", context, "https://other.test")).status,
    ).toBe(403);
    expect(
      (await call("invitations", { ...context, reason: " " })).status,
    ).toBe(400);
    expect(
      (await call("invitations", { ...context, reason: "x".repeat(9000) }))
        .status,
    ).toBe(413);
  });
  it.each([401, 403])("requires current ADMIN; rejects %s", async (status) => {
    mocks.admin.mockRejectedValue(new AdminFailure(status));
    expect((await call("employees")).status).toBe(status);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
});

it("allows only exact ADMIN receipt and revoke-all routes with safe projection", async () => {
  mocks.upstream.mockResolvedValue({
    status: "COMMITTED",
    receipt: {
      id,
      resourceId: id,
      action: "SUPPORT_CAPABILITIES_REVOKED",
      identityCiphertext: "must-not-pass",
    },
  });
  expect(await (await call("operations/" + id)).json()).toEqual({
    status: "COMMITTED",
    receipt: { id, resourceId: id, action: "SUPPORT_CAPABILITIES_REVOKED" },
  });
  expect((await call("employees/" + id + "/revoke-all", context)).status).toBe(
    200,
  );
  expect((await call("operations/not-an-id")).status).toBe(404);
  expect(
    (
      await call(
        "employees/" + id + "/revoke-all",
        context,
        "https://evil.test",
      )
    ).status,
  ).toBe(403);
});

it("rejects a mutation after the authenticated platform actor changes", async () => {
  mocks.admin.mockResolvedValue({ access: crypto.randomUUID(), actorId: crypto.randomUUID() });
  expect((await call("employees/" + id + "/employment", { ...context, state: "SUSPENDED" })).status).toBe(403);
  expect(mocks.upstream).not.toHaveBeenCalled();
});
it("rejects mutations without an authenticated actor identity", async () => {
  mocks.admin.mockResolvedValue({ access: crypto.randomUUID(), actorId: null });
  expect((await call("employees/" + id + "/employment", { ...context, state: "ACTIVE" })).status).toBe(403);
  expect(mocks.upstream).not.toHaveBeenCalled();
});

it("forwards only the reviewed account recovery endpoint with provenance", async () => {
  expect((await call("accounts/" + id + "/recover", context)).status).toBe(200);
  expect(mocks.upstream).toHaveBeenCalledWith("/admin/support/accounts/" + id + "/recover", expect.any(String), context, undefined);
  expect((await call("accounts/" + id + "/delete", context)).status).toBe(404);
});
