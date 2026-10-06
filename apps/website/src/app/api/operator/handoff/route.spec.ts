import { it, expect } from "vitest";
import { POST } from "./route";
it("preserves POST into the existing canonical cookie scope with a fixed internal target", async () => {
  const r = await POST(
    new Request("https://opa.test/api/operator/handoff", {
      method: "POST",
      headers: { origin: "https://opa.test" },
    }),
  );
  expect(r.status).toBe(307);
  expect(r.headers.get("location")).toBe(
    "https://opa.test/api/institutional/operator-handoff",
  );
});
it("rejects cross-origin handoff before redirect", async () => {
  const r = await POST(
    new Request("https://opa.test/api/operator/handoff", {
      method: "POST",
      headers: { origin: "https://foreign.test" },
    }),
  );
  expect(r.status).toBe(403);
  expect(r.headers.get("location")).toBeNull();
});

it("accepts same-origin no-referrer native form metadata", async () => {
  const response=await POST(new Request("https://opa.test/api/operator/handoff",{method:"POST",headers:{origin:"null","sec-fetch-site":"same-origin","sec-fetch-mode":"navigate","sec-fetch-dest":"document"}}));
  expect(response.status).toBe(307);
});
