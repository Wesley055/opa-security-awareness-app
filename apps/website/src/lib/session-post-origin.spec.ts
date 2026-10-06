import { describe, expect, it } from "vitest";
import { sameOriginSessionPost } from "./session-post-origin";
const chrome = { origin: "null", "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "content-type": "application/x-www-form-urlencoded", "content-length": "0" };
const check = (headers: Record<string,string>) => sameOriginSessionPost(new Request("http://localhost:3003/api/operator/logout", { method: "POST", headers }));
describe("session POST browser-origin policy", () => {
  it("accepts the physically captured Chrome no-referrer form shape", () => expect(check(chrome)).toBe(true));
  it("accepts absent Origin with complete same-origin form metadata", () => { const { origin: omitted, ...headers }=chrome; void omitted; expect(check(headers)).toBe(true); });
  it("supports matching Origin without Fetch Metadata", () => expect(check({origin:"http://localhost:3003"})).toBe(true));
  it("supports matching Referer without Origin or Fetch Metadata", () => expect(check({referer:"http://localhost:3003/operator"})).toBe(true));
  it.each<Record<string, string>>([
    {}, {origin:"null"}, {...chrome,origin:"https://foreign.test"},
    {...chrome,"sec-fetch-site":"cross-site"}, {...chrome,"sec-fetch-site":"same-site"},
    {...chrome,"sec-fetch-site":"none"}, {...chrome,"sec-fetch-site":""},
    {...chrome,referer:"https://foreign.test/operator"}, {...chrome,referer:"invalid"},
    {...chrome,"sec-fetch-mode":"cors"}, {...chrome,"sec-fetch-dest":"iframe"},
    {origin:"http://localhost:3003","sec-fetch-site":"cross-site"},
    {origin:"http://localhost:3003",referer:"http://localhost:3004/operator"},
    {origin:"null",referer:"http://localhost:3003/operator"},
    {...chrome,origin:"http://localhost:3004"},
  ])("fails closed for untrusted or conflicting metadata #%#", headers => expect(check(headers)).toBe(false));
  it("never authorizes GET",()=>expect(sameOriginSessionPost(new Request("http://localhost:3003/api/operator/logout",{headers:chrome}))).toBe(false));
});
