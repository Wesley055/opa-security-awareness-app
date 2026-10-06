import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearOperatorSession: vi.fn(),
  clearInstitutionalSession: vi.fn(),
}));

vi.mock("@/lib/operator-session", () => ({
  clearOperatorSession: mocks.clearOperatorSession,
}));

vi.mock("@/lib/institutional-session", () => ({
  clearInstitutionalSession: mocks.clearInstitutionalSession,
}));

import { POST } from "./route";

describe("POST /api/operator/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a same-origin browser form POST when Origin is absent", async () => {
    const request = new Request("http://localhost:3003/api/operator/logout", {
      method: "POST",
      headers: {
        referer: "http://localhost:3003/operator",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/operator/login",
    );
    expect(mocks.clearOperatorSession).toHaveBeenCalledTimes(1);
    expect(mocks.clearInstitutionalSession).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit matching Origin", async () => {
    const request = new Request("https://opa.test/api/operator/logout", {
      method: "POST",
      headers: {
        origin: "https://opa.test",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(mocks.clearOperatorSession).toHaveBeenCalledTimes(1);
    expect(mocks.clearInstitutionalSession).toHaveBeenCalledTimes(1);
  });

  it("rejects an explicit cross-origin request without clearing sessions", async () => {
    const request = new Request("https://opa.test/api/operator/logout", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        referer: "https://evil.example/",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.clearOperatorSession).not.toHaveBeenCalled();
    expect(mocks.clearInstitutionalSession).not.toHaveBeenCalled();
  });

  it("rejects an origin-less request with a cross-origin Referer", async () => {
    const request = new Request("https://opa.test/api/operator/logout", {
      method: "POST",
      headers: {
        referer: "https://evil.example/page",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.clearOperatorSession).not.toHaveBeenCalled();
    expect(mocks.clearInstitutionalSession).not.toHaveBeenCalled();
  });
});
it("accepts the exact physical Chrome no-referrer form and redirects after clearing both sessions", async () => {
  vi.clearAllMocks();
  const response = await POST(new Request("http://localhost:3003/api/operator/logout", { method:"POST", headers: {origin:"null", "sec-fetch-site":"same-origin", "sec-fetch-mode":"navigate", "sec-fetch-dest":"document", "content-type":"application/x-www-form-urlencoded", "content-length":"0"} }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("http://localhost:3003/operator/login");
  expect(mocks.clearOperatorSession).toHaveBeenCalledTimes(1);
  expect(mocks.clearInstitutionalSession).toHaveBeenCalledTimes(1);
});
it.each<Record<string, string>>([
  {origin:"null", "sec-fetch-site":"cross-site", "sec-fetch-mode":"navigate", "sec-fetch-dest":"document"},
  {origin:"https://opa.test", "sec-fetch-site":"cross-site"},
  {origin:"null"},
  {origin:"https://opa.test",referer:"https://foreign.test"},
])("rejects conflicting metadata without touching either session #%#", async headers => {
  vi.clearAllMocks();
  expect((await POST(new Request("https://opa.test/api/operator/logout",{method:"POST",headers}))).status).toBe(403);
  expect(mocks.clearOperatorSession).not.toHaveBeenCalled();
  expect(mocks.clearInstitutionalSession).not.toHaveBeenCalled();
});
