import { afterEach, it, expect, vi } from "vitest";
import { onboardingFetch } from "./onboarding-fetch";
afterEach(() => vi.unstubAllGlobals());
it("returns support authentication failure without silently restoring authority", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  expect((await onboardingFetch("facilities")).status).toBe(401);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves the independent ADMIN refresh flow", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  expect((await onboardingFetch("employees", undefined, true)).status).toBe(
    200,
  );
  expect(fetch.mock.calls[1][0]).toBe("/api/super-admin/refresh");
});
