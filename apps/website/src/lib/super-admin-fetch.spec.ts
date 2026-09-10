import { afterEach, expect, it, vi } from "vitest";
import { superAdminFetch } from "./super-admin-fetch";
afterEach(() => vi.unstubAllGlobals());
it("recovers once from 401 and retries the same request", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", mock);
  expect(
    (await superAdminFetch("operators", { method: "POST", body: "payload" }))
      .status,
  ).toBe(200);
  expect(mock).toHaveBeenCalledTimes(3);
  expect(mock.mock.calls[0]).toEqual(mock.mock.calls[2]);
  expect(mock.mock.calls[1][0]).toBe("/api/super-admin/refresh");
});
it.each([403, 409, 503])(
  "never retries a mutation with status %s",
  async (status) => {
    const mock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", mock);
    expect(
      (await superAdminFetch("operators", { method: "POST" })).status,
    ).toBe(status);
    expect(mock).toHaveBeenCalledTimes(1);
  },
);
it("does not loop when refreshed credentials are rejected", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", mock);
  expect((await superAdminFetch("facilities/id")).status).toBe(401);
  expect(mock).toHaveBeenCalledTimes(3);
});
it("preserves refresh outage status without retrying mutation", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", mock);
  expect((await superAdminFetch("operators", { method: "POST" })).status).toBe(
    503,
  );
  expect(mock).toHaveBeenCalledTimes(2);
});
