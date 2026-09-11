import { expect, it, vi } from "vitest";
vi.mock("@/lib/console-api", () => ({ consoleApi: vi.fn() }));
import { consoleApi } from "@/lib/console-api";
import { GET } from "./route";
const params = Promise.resolve({ incidentId: "incident-a" });
it("forwards only the incident and bounded cursor using the session adapter", async () => {
  vi.mocked(consoleApi).mockResolvedValue({
    status: 200,
    data: { version: 1, items: [], nextCursor: null },
  });
  const response = await GET(
    new Request("https://opa.test/api?facilityId=other"),
    { params },
  );
  expect(consoleApi).toHaveBeenCalledWith("/incidents/incident-a/deliveries");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(await response.json()).toEqual({
    version: 1,
    items: [],
    nextCursor: null,
  });
});
it.each([401, 403, 404, 503])("preserves access failure %s", async (status) => {
  vi.mocked(consoleApi).mockResolvedValue({ status, error: "Unavailable" });
  expect(
    (await GET(new Request("https://opa.test/api"), { params })).status,
  ).toBe(status);
});
it("rejects malformed cursors before upstream access", async () => {
  expect(
    (await GET(new Request("https://opa.test/api?after=bad"), { params }))
      .status,
  ).toBe(400);
  expect(consoleApi).not.toHaveBeenCalled();
});
