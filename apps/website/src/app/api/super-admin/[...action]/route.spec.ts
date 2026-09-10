import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/super-admin-api", () => ({
  AdminFailure: class extends Error {
    constructor(public status: number) {
      super();
    }
  },
  failureMessages: { 403: "Forbidden", 400: "Invalid" },
  requireAdmin: vi.fn(),
  upstream: vi.fn(),
}));
vi.mock("@/lib/super-admin-session", () => ({
  adminRefresh: vi.fn(),
  clearAdminSession: vi.fn(),
  setAdminSession: vi.fn(),
}));
import { requireAdmin, upstream } from "@/lib/super-admin-api";
import { GET, POST, project } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
describe("durable Super Admin bridge", () => {
  it('requires same-facility scope before asking the PII service to reveal', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({access:'server-token', name:'Admin', facilityId:null});
    const response=await POST(new Request('https://opa.test/api/super-admin/facilities/'+id+'/reveal', {method:'POST',headers:{origin:'https://opa.test'},body:JSON.stringify({identifierId:id,caseReference:id,purpose:'SUPPORT_CASE'})}), {params:Promise.resolve({action:['facilities',id,'reveal']})});
    expect(response.status).toBe(403); expect(upstream).not.toHaveBeenCalled();
  });
  it('uses the existing PII resolution endpoint and returns one value only', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({access:'server-token', name:'Admin', facilityId:id});
    vi.mocked(upstream).mockResolvedValue({value:'authorized@example.test',unexpected:'secret'});
    const response=await POST(new Request('https://opa.test/api/super-admin/facilities/'+id+'/reveal', {method:'POST',headers:{origin:'https://opa.test'},body:JSON.stringify({identifierId:id,caseReference:id,purpose:'SUPPORT_CASE'})}), {params:Promise.resolve({action:['facilities',id,'reveal']})});
    expect(response.status).toBe(200); expect(await response.json()).toEqual({value:'authorized@example.test'});
    expect(upstream).toHaveBeenCalledWith('/protected-identities/'+id+'/resolve','server-token',{caseReference:id,purpose:'SUPPORT_CASE'});
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      access: "server-token",
      name: "Admin",
      facilityId: null,
    });
  });
  it("projects only approved fields and removes raw secrets and identifiers recursively", () => {
    expect(
      project({
        requestId: id,
        status: "VERIFICATION_PENDING",
        activationToken: "raw",
        activationPath: "/raw",
        user: { passwordHash: "hash" },
        members: [{ id, email: "private", firstName: "private", role: "USER" }],
      }),
    ).toEqual({
      requestId: id,
      status: "VERIFICATION_PENDING",
      members: [{ id, role: "USER" }],
    });
  });
  it("returns the durable receipt and forwards the stable idempotency key", async () => {
    vi.mocked(upstream).mockResolvedValue({
      requestId: id,
      status: "VERIFICATION_PENDING",
      activationToken: "must-not-leak",
    });
    const response = await POST(
      new Request("https://opa.test/api/super-admin/operators", {
        method: "POST",
        headers: {
          origin: "https://opa.test",
          "content-type": "application/json",
          "idempotency-key": "stable-key",
        },
        body: JSON.stringify({ facilityId: id, email: "staff@example.test" }),
      }),
      { params: Promise.resolve({ action: ["operators"] }) },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      requestId: id,
      status: "VERIFICATION_PENDING",
    });
    expect(upstream).toHaveBeenCalledWith(
      "/admin/operators",
      "server-token",
      { facilityId: id, email: "staff@example.test" },
      "stable-key",
    );
  });
  it("rejects cross-origin mutations before accessing credentials", async () => {
    const response = await POST(
      new Request("https://opa.test/api/super-admin/operators", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
      { params: Promise.resolve({ action: ["operators"] }) },
    );
    expect(response.status).toBe(403);
    expect(requireAdmin).not.toHaveBeenCalled();
  });
  it("lists facilities only after platform authorization", async () => {
    vi.mocked(upstream).mockResolvedValue({ facilities: [], nextCursor: null });
    const response = await GET(
      new Request("https://opa.test/api/super-admin/facilities"),
      { params: Promise.resolve({ action: ["facilities"] }) },
    );
    expect(response.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledWith("/admin/facilities", "server-token");
  });
  it("rejects an invitation without an idempotency key", async () => {
    const response = await POST(
      new Request("https://opa.test/api/super-admin/operators", {
        method: "POST",
        headers: { origin: "https://opa.test" },
        body: "{}",
      }),
      { params: Promise.resolve({ action: ["operators"] }) },
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
