import { afterEach, it, expect, vi } from "vitest";
import { institutionalFetch } from "./institutional-fetch";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("recovers from 401 without emitting authority loss", async () => {
  const lost = vi.fn();
  window.addEventListener("opa-institutional-authority-lost", lost);

  const mock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));

  vi.stubGlobal("fetch", mock);

  const response = await institutionalFetch("readiness");

  expect(response.status).toBe(200);
  expect(mock).toHaveBeenCalledTimes(3);
  expect(mock.mock.calls[1][0]).toBe("/api/institutional/refresh");
  expect(lost).not.toHaveBeenCalled();

  window.removeEventListener("opa-institutional-authority-lost", lost);
});

it("emits authority loss when refreshed credentials remain unauthorized", async () => {
  const lost = vi.fn();
  window.addEventListener("opa-institutional-authority-lost", lost);

  const mock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));

  vi.stubGlobal("fetch", mock);

  const response = await institutionalFetch("readiness");

  expect(response.status).toBe(401);
  expect(mock).toHaveBeenCalledTimes(3);
  expect(lost).toHaveBeenCalledTimes(1);

  window.removeEventListener("opa-institutional-authority-lost", lost);
});

it("does not expire the session for an ordinary facility capability 403", async () => {
  const lost = vi.fn();
  window.addEventListener("opa-institutional-authority-lost", lost);

  const mock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));

  vi.stubGlobal("fetch", mock);

  const response = await institutionalFetch(
    "facilities/00000000-0000-4000-8000-000000000001/incidents",
  );

  expect(response.status).toBe(403);
  expect(mock).toHaveBeenCalledTimes(1);
  expect(lost).not.toHaveBeenCalled();

  window.removeEventListener("opa-institutional-authority-lost", lost);
});

it("expires authority when the institutional context itself is forbidden", async () => {
  const lost = vi.fn();
  window.addEventListener("opa-institutional-authority-lost", lost);

  const mock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));

  vi.stubGlobal("fetch", mock);

  const response = await institutionalFetch("context");

  expect(response.status).toBe(403);
  expect(mock).toHaveBeenCalledTimes(1);
  expect(lost).toHaveBeenCalledTimes(1);

  window.removeEventListener("opa-institutional-authority-lost", lost);
});
it("single-flights concurrent access renewal without authority-loss UI", async () => {
  let renewed = false,
    finish!: (r: Response) => void;
  const lost = vi.fn();
  window.addEventListener("opa-institutional-authority-lost", lost);
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
  const first = institutionalFetch("context"),
    second = institutionalFetch("context");
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
  window.removeEventListener("opa-institutional-authority-lost", lost);
});
