import { afterEach, it, expect, vi } from "vitest";
import { superAdminFetch } from "./super-admin-fetch";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("bounds a stalled creation without retrying it", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
  const result = superAdminFetch("facilities", { method: "POST", body: "{}" });
  const assertion = expect(result).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(15001);
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("bounds a stalled response body", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    status: 200,
    text: () => new Promise(() => {}),
  } as Response);
  const assertion = expect(superAdminFetch("facilities")).rejects.toThrow(
    /timed out/,
  );
  await vi.advanceTimersByTimeAsync(15001);
  await assertion;
});
it.each([401, 403])(
  "emits authority loss after status %s and does not loop",
  async (status) => {
    const lost = vi.fn();
    window.addEventListener("opa-super-admin-authority-lost", lost);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status }),
    );
    const response = await superAdminFetch("organization/overview");
    expect(response.status).toBe(status);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(status === 401 ? 2 : 1);
    window.removeEventListener("opa-super-admin-authority-lost", lost);
  },
);

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
  expect(mock.mock.calls[0][0]).toEqual(mock.mock.calls[2][0]);
  expect(mock.mock.calls[0][1].body).toEqual(mock.mock.calls[2][1].body);
  expect(mock.mock.calls[0][1].method).toEqual(mock.mock.calls[2][1].method);
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

it("scoped capability denial does not expire platform identity", async () => {
  const lost = vi.fn();
  window.addEventListener("opa-super-admin-authority-lost", lost);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 403 })),
  );
  expect(
    (await superAdminFetch("organization/facilities/id/cases")).status,
  ).toBe(403);
  expect(lost).not.toHaveBeenCalled();
  window.removeEventListener("opa-super-admin-authority-lost", lost);
});

it("single-flights concurrent access renewal without authority-loss UI", async () => {
  let renewed = false,
    finish!: (r: Response) => void;
  const lost = vi.fn();
  window.addEventListener("opa-super-admin-authority-lost", lost);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).endsWith("/refresh"))
        return new Promise<Response>((resolve) => {
          finish = (r) => {
            renewed = true;
            resolve(r);
          };
        });
      return new Response(null, { status: renewed ? 200 : 401 });
    }),
  );
  const first = superAdminFetch("context"),
    second = superAdminFetch("context");
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  expect(finish).toBeTypeOf("function");
  finish(new Response(null, { status: 200 }));
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/refresh")),
  ).toHaveLength(1);
  expect(lost).not.toHaveBeenCalled();
  window.removeEventListener("opa-super-admin-authority-lost", lost);
});
