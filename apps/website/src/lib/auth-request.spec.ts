import { afterEach, it, expect, vi } from "vitest";
import { authRequest } from "./auth-request";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(["fetch", "body"])(
  "bounds a stalled %s with an unknown result",
  async (stage) => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        stage === "fetch"
          ? new Promise(() => {})
          : Promise.resolve({
              ok: true,
              status: 200,
              json: () => new Promise(() => {}),
            }),
      ),
    );
    const request = expect(
      authRequest("/api/auth/password-reset/confirm", {}),
    ).rejects.toThrow("Result unknown");
    await vi.advanceTimersByTimeAsync(15001);
    await request;
    expect(vi.getTimerCount()).toBe(0);
  },
);
