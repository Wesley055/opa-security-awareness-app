import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/environment-api", () => ({
  environmentApiUrl: () => "https://api.example.test",
}));
import { POST } from "./route";

describe("password-reset confirm bridge", () => {
  const password = crypto.randomUUID();
  const token = crypto.randomUUID() + crypto.randomUUID();
  afterEach(() => vi.unstubAllGlobals());

  it("forwards only token and password", async () => {
    process.env.OPA_API_URL = "https://api.example.test/";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      new Request(
        "https://viewer.example.test/api/operator/password-reset/confirm",
        {
          method: "POST",
          headers: { origin: "https://viewer.example.test" },
          body: JSON.stringify({
            token: token,
            password: password,
            ignored: "nope",
          }),
        },
      ),
    );
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      token: token,
      password: password,
    });
  });

  it("maps invalid or expired tokens to a bounded error", async () => {
    process.env.OPA_API_URL = "https://api.example.test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("detail", { status: 400 })),
    );
    const response = await POST(
      new Request(
        "https://viewer.example.test/api/operator/password-reset/confirm",
        {
          method: "POST",
          headers: { origin: "https://viewer.example.test" },
          body: JSON.stringify({
            token: token,
            password: password,
          }),
        },
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "This password reset token is invalid or expired.",
    });
  });
});
