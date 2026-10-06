import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  path: "/",
  jar: [] as Array<{
    name: string;
    value: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    maxAge?: number;
  }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/environment-api", () => ({
  environmentApiUrl: () => "https://api.example.test",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = state.jar.find(
        (c) =>
          c.name === name &&
          (c.path === "/" ||
            state.path === c.path ||
            state.path.startsWith(c.path + "/")),
      );
      return c ? { value: c.value } : undefined;
    },
    set: (
      name: string,
      value: string,
      options: { path?: string; maxAge?: number },
    ) => {
      const path = options.path ?? "/";
      state.jar = state.jar.filter(
        (c) => !(c.name === name && c.path === path),
      );
      if (options.maxAge !== 0)
        state.jar.push({ name, value, path, ...options });
    },
    delete: (name: string) => {
      state.jar = state.jar.filter((c) => !(c.name === name && c.path === "/"));
    },
  }),
}));
import {
  POST as institutionalPost,
  GET as institutionalGet,
} from "@/app/api/institutional/[...action]/route";
import { POST as handoff } from "@/app/api/institutional/operator-handoff/route";
import { POST as compatibility } from "@/app/api/operator/handoff/route";
import {
  GET as rotate,
  POST as rotateJson,
} from "@/app/api/operator/refresh/route";
import { POST as logout } from "@/app/api/operator/logout/route";
import { getSessionState } from "./operator-session";
import { getOperatorContext } from "./operator-context";
let actor: string,
  facility: string,
  role: string,
  access: string,
  refresh: string,
  revoked: boolean,
  outage: boolean,
  expired: boolean,
  refreshRejectedAccess: boolean,
  scopedForbidden: boolean;
let consoleSpy: ReturnType<typeof vi.spyOn>;
const origin = "https://opa.example.test";
function request(path: string, method = "POST", body?: unknown) {
  state.path = path;
  return new Request(origin + path, {
    method,
    headers: {
      origin,
      "Content-Type": "application/json",
      "x-institutional-actor": actor + ":" + role,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (action: string) => ({
  params: Promise.resolve({ action: action.split("/") }),
});
const context = () => ({
  actor: { id: actor, role },
  facilities: [
    { id: facility, name: "Disposable facility", capabilities: [role] },
  ],
});
async function login() {
  return institutionalPost(
    request("/api/institutional/login", "POST", {
      email: randomUUID() + "@example.test",
      password: randomUUID(),
    }),
    params("login"),
  );
}
const has = (name: string) => state.jar.some((c) => c.name === name);
beforeEach(() => {
  state.jar = [];
  state.path = "/";
  actor = randomUUID();
  facility = randomUUID();
  role = "FACILITY_OPERATOR";
  access = randomUUID();
  refresh = randomUUID();
  revoked = false;
  outage = false;
  expired = false;
  refreshRejectedAccess = false;
  scopedForbidden = false;
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (outage)
        return Response.json({ error: "unavailable" }, { status: 503 });
      if (path === "/auth/login")
        return Response.json({
          accessToken: access,
          refreshToken: refresh,
          user: { role },
        });
      if (path === "/auth/refresh") {
        if (revoked) return Response.json({ error: "denied" }, { status: 401 });
        access = randomUUID();
        refresh = randomUUID();
        expired = refreshRejectedAccess;
        return Response.json({ accessToken: access, refreshToken: refresh });
      }
      if (
        revoked ||
        expired ||
        new Headers(init?.headers).get("authorization") !== "Bearer " + access
      )
        return Response.json({ error: "denied" }, { status: 401 });
      if (path === "/institutional/context") return Response.json(context());
      if (path === "/users/me")
        return Response.json({
          id: actor,
          role,
          facilityId: facility,
          firstName: "Synthetic",
          lastName: "Operator",
          facility: {
            id: facility,
            name: "Disposable facility",
            type: "OTHER",
            isActive: true,
            isVerified: true,
          },
        });
      if (scopedForbidden)
        return Response.json({ error: "scope denied" }, { status: 403 });
      throw Error("Unexpected synthetic endpoint: " + path);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("actual canonical login -> path-scoped handoff -> operator context, without legacy cookies or token disclosure", async () => {
  const logged = await login();
  expect(logged.status).toBe(200);
  expect(has("opa_institutional_access")).toBe(true);
  expect(has("opa_onboarding_access")).toBe(false);
  const refreshCookie = state.jar.find(
    (c) => c.name === "opa_institutional_refresh",
  )!;
  expect(refreshCookie.path).toBe("/api/institutional");
  const forwarded = await compatibility(request("/api/operator/handoff"));
  expect(forwarded.status).toBe(307);
  const response = await handoff(
    request(new URL(forwarded.headers.get("location")!).pathname),
  );
  expect(response.status).toBe(303);
  expect(new URL(response.headers.get("location")!).pathname).toBe("/operator");
  state.path = "/operator";
  expect(await getSessionState()).toBe("active");
  expect(await getOperatorContext()).toMatchObject({
    state: "READY",
    context: {
      userId: actor,
      role: "FACILITY_OPERATOR",
      facility: { id: facility },
    },
  });
  for (const c of state.jar) {
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("strict");
  }
  const publicOutput =
    (await logged.text()) +
    (await response.text()) +
    response.headers.get("location") +
    JSON.stringify(consoleSpy.mock.calls);
  expect(publicOutput.includes(access) || publicOutput.includes(refresh)).toBe(
    false,
  );
});
it.each(["FACILITY_ADMIN", "TECHNICAL_SUPPORT", "ADMIN"])(
  "denies current %s without inheriting operator authority",
  async (other) => {
    role = other;
    await login();
    const r = await handoff(request("/api/institutional/operator-handoff"));
    expect(new URL(r.headers.get("location")!).pathname).toBe("/institutional");
    expect(has("opa_operator_access")).toBe(false);
    expect(has("opa_institutional_access")).toBe(true);
  },
);
it("missing canonical session cannot use legacy onboarding cookies", async () => {
  state.jar.push(
    { name: "opa_onboarding_access", value: randomUUID(), path: "/" },
    { name: "opa_onboarding_refresh", value: randomUUID(), path: "/" },
  );
  const r = await handoff(request("/api/institutional/operator-handoff"));
  expect(new URL(r.headers.get("location")!).pathname).toBe("/institutional");
  expect(has("opa_operator_access")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("expired canonical access rotates once within its cookie path then hands off", async () => {
  await login();
  state.jar = state.jar.filter((c) => c.name !== "opa_institutional_access");
  expired = true;
  const r = await handoff(request("/api/institutional/operator-handoff"));
  expect(new URL(r.headers.get("location")!).pathname).toBe("/operator");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh")),
  ).toHaveLength(1);
  state.path = "/operator";
  expect((await getOperatorContext()).state).toBe("READY");
});
it("revoked authority fails closed and clears derived credentials", async () => {
  await login();
  await handoff(request("/api/institutional/operator-handoff"));
  revoked = true;
  await handoff(request("/api/institutional/operator-handoff"));
  expect(has("opa_operator_access")).toBe(false);
  expect(has("opa_institutional_access")).toBe(false);
  expect(has("opa_institutional_refresh")).toBe(false);
});
it("outage preserves canonical session and creates no operator session", async () => {
  await login();
  const before = state.jar.map((c) => ({ ...c }));
  outage = true;
  const r = await handoff(request("/api/institutional/operator-handoff"));
  expect(r.status).toBe(503);
  expect(state.jar.length).toBe(before.length);
  expect(state.jar.every((c, i) => c.value === before[i].value)).toBe(true);
  expect(has("opa_operator_access")).toBe(false);
});
it("current role changes are reread at handoff, not inferred from cookies", async () => {
  await login();
  role = "ADMIN";
  await handoff(request("/api/institutional/operator-handoff"));
  expect(has("opa_operator_access")).toBe(false);
});
it("scoped 403 leaves canonical cookies intact", async () => {
  await login();
  const before = state.jar.map((c) => ({ ...c }));
  scopedForbidden = true;
  const action = "facilities/" + facility + "/members";
  const r = await institutionalGet(
    request("/api/institutional/" + action, "GET"),
    params(action),
  );
  expect(r.status).toBe(403);
  expect(state.jar.length).toBe(before.length);
  expect(state.jar.every((c, i) => c.value === before[i].value)).toBe(true);
});
it("operator access expiry refreshes once to a validated usable session", async () => {
  await login();
  await handoff(request("/api/institutional/operator-handoff"));
  state.jar = state.jar.filter((c) => c.name !== "opa_operator_access");
  expired = true;
  const r = await rotate(request("/api/operator/refresh", "GET"));
  expect(new URL(r.headers.get("location")!).pathname).toBe("/operator");
  state.path = "/operator";
  expect(await getSessionState()).toBe("active");
  expect((await getOperatorContext()).state).toBe("READY");
});
it("a rejected fresh access token ends rotation instead of redirecting into a loop", async () => {
  await login();
  await handoff(request("/api/institutional/operator-handoff"));
  refreshRejectedAccess = true;
  const r = await rotate(request("/api/operator/refresh", "GET"));
  expect(r.headers.get("location")).toContain(
    "/operator/login?reason=session-ended",
  );
  expect(has("opa_operator_refresh")).toBe(false);
});
it("operator refresh outage preserves cookies without retry loop", async () => {
  await login();
  await handoff(request("/api/institutional/operator-handoff"));
  outage = true;
  const r = await rotateJson();
  expect(r.status).toBe(503);
  expect(has("opa_operator_refresh")).toBe(true);
});
it.each(["institutional", "operator"])(
  "%s logout clears both surfaces including path-scoped refresh",
  async (surface) => {
    await login();
    await handoff(request("/api/institutional/operator-handoff"));
    const form = request("/api/" + surface + "/logout");
    form.headers.set("origin", "null");
    form.headers.set("sec-fetch-site", "same-origin");
    form.headers.set("sec-fetch-mode", "navigate");
    form.headers.set("sec-fetch-dest", "document");
    form.headers.set("content-type", "application/x-www-form-urlencoded");
    form.headers.set("content-length", "0");
    if (surface === "institutional") {
      expect((await institutionalPost(form, params("logout"))).status).toBe(200);
    } else {
      const response = await logout(form);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(origin + "/operator/login");
    }
    expect(state.jar).toHaveLength(0);
    expect(await getSessionState()).toBe("none");
    expect((await institutionalGet(request("/api/institutional/context", "GET"), params("context"))).status).toBe(401);
    expect((await institutionalPost(request("/api/institutional/refresh"), params("refresh"))).status).toBe(401);
    expect((await rotateJson()).status).toBe(401);
  },
);
it("switching canonical actor clears the previous operator scope", async () => {
  await login();
  await handoff(request("/api/institutional/operator-handoff"));
  actor = randomUUID();
  role = "FACILITY_ADMIN";
  await login();
  expect(has("opa_operator_access")).toBe(false);
  expect(has("opa_operator_refresh")).toBe(false);
  state.path = "/operator";
  expect(await getSessionState()).toBe("none");
});
it("production cookies remain Secure", async () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    await login();
    await handoff(request("/api/institutional/operator-handoff"));
    expect(state.jar.every((c) => c.secure === true)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("canonical access expiry preserves refresh until one validated renewal", async () => {
  await login();
  expired = true;
  const denied = await institutionalGet(request("/api/institutional/context", "GET"), params("context"));
  expect(denied.status).toBe(401);
  expect(has("opa_institutional_refresh")).toBe(true);
  const renewed = await institutionalPost(request("/api/institutional/refresh"), params("refresh"));
  expect(renewed.status).toBe(200);
  const current = await institutionalGet(request("/api/institutional/context", "GET"), params("context"));
  expect(current.status).toBe(200);
});
it("canonical revoked credentials cannot restore either surface through refresh", async () => {
  await login();
  await handoff(request("/api/institutional/operator-handoff"));
  revoked = true;
  const denied = await institutionalGet(request("/api/institutional/context", "GET"), params("context"));
  expect(denied.status).toBe(401);
  const renewal = await institutionalPost(request("/api/institutional/refresh"), params("refresh"));
  expect(renewal.status).toBe(401);
  expect(state.jar).toHaveLength(0);
});
