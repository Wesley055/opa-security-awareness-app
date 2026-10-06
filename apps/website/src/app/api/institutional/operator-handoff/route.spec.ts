import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  operatorHandoff: vi.fn(),
}));

vi.mock("@/lib/operator-handoff", () => ({
  operatorHandoff: mocks.operatorHandoff,
}));

import { POST } from "./route";

describe("POST /api/institutional/operator-handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("establishes the handoff and redirects to the Command Center", async () => {
    mocks.operatorHandoff.mockResolvedValue({
      ok: true,
      facilityId: "facility-1",
    });

    const request = new Request(
      "https://opa.test/api/institutional/operator-handoff",
      {
        method: "POST",
        headers: {
          origin: "https://opa.test",
        },
      },
    );

    const response = await POST(request);

    expect(mocks.operatorHandoff).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://opa.test/operator");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it("rejects a cross-origin handoff before touching the session", async () => {
    const request = new Request(
      "https://opa.test/api/institutional/operator-handoff",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
        },
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.operatorHandoff).not.toHaveBeenCalled();
  });

  it.each([
    [401, "/institutional"],
    [403, "/institutional"],
  ])(
    "redirects handoff failure %s to the bounded canonical surface",
    async (status, target) => {
      mocks.operatorHandoff.mockRejectedValue(
        Object.assign(new Error("denied"), { status }),
      );

      const request = new Request(
        "https://opa.test/api/institutional/operator-handoff",
        {
          method: "POST",
          headers: {
            origin: "https://opa.test",
          },
        },
      );

      const response = await POST(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://opa.test" + target,
      );
    },
  );

  it("returns 503 without creating an external redirect on upstream outage", async () => {
    mocks.operatorHandoff.mockRejectedValue(
      Object.assign(new Error("unavailable"), { status: 503 }),
    );

    const request = new Request(
      "https://opa.test/api/institutional/operator-handoff",
      {
        method: "POST",
        headers: {
          origin: "https://opa.test",
        },
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });
});

it("accepts same-origin no-referrer native form metadata", async () => {
  mocks.operatorHandoff.mockResolvedValue({ok:true,facilityId:"facility-1"});
  const response=await POST(new Request("https://opa.test/api/institutional/operator-handoff",{method:"POST",headers:{origin:"null","sec-fetch-site":"same-origin","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}}));
  expect(response.status).toBe(303);
});
