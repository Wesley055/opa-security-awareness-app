// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { sameOrigin } from "./sso-bridge";
afterEach(()=>vi.unstubAllEnvs());
it.each([
  ["https://opa.test", {origin:"null","sec-fetch-site":"same-origin","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}, true],
  ["https://opa.test", {origin:"null","sec-fetch-site":"cross-site","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}, false],
  ["https://foreign.test", {origin:"null","sec-fetch-site":"same-origin","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}, false],
  ["https://opa.test", {origin:"https://foreign.test"}, false],
] as const)("keeps SSO configured origin binding with native form metadata #%#", (origin,headers,expected)=>{
  vi.stubEnv("SSO_WEB_ORIGIN","https://opa.test");
  expect(sameOrigin(new Request(origin+"/api/sso/finish-link",{method:"POST",headers}))).toBe(expected);
});
