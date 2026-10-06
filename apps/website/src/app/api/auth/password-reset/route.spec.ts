import { afterEach, it, expect, vi } from "vitest";
vi.mock("@/lib/environment-api", () => ({
  environmentApiUrl: () => "https://api.example.test",
}));
import { POST as request } from "./request/route";
import { POST as confirm } from "./confirm/route";
afterEach(() => vi.unstubAllGlobals());
it.each([request, confirm])(
  "rejects foreign origin before contacting the canonical API",
  async (handler) => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await handler(
      new Request(
        "https://viewer.example.test/api/auth/password-reset/request",
        {
          method: "POST",
          headers: { origin: "https://foreign.example.test" },
          body: "{}",
        },
      ),
    );
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("central recovery uses the same bounded canonical backend and generic response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  const response = await request(
    new Request("https://viewer.example.test/api/auth/password-reset/request", {
      method: "POST",
      headers: { origin: "https://viewer.example.test" },
      body: JSON.stringify({ email: crypto.randomUUID() + "@example.test" }),
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).message).toContain("will be sent");
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    "https://api.example.test/auth/password-reset/request",
  );
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeDefined();
});
