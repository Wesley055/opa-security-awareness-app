import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { reportProxy } from "./insight-report-proxy";
const facility = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
describe("incident report proxy", () => {
  it("pins the upstream facility to server context and cannot forward arbitrary paths", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ status: 200, data: { incidents: [] } });
    const request = new Request(
      `http://localhost/insight?op=detail&id=${id}&facilityId=${id}`,
    );
    expect((await reportProxy(request, facility, call)).status).toBe(200);
    expect(call).toHaveBeenCalledWith(
      `/internal/insight/incidents/${id}/compliance-evidence?facilityId=${facility}`,
      "GET",
      undefined,
    );
    call.mockClear();
    expect(
      (
        await reportProxy(
          new Request(
            `http://localhost/insight?op=detail&id=${id}&path=/admin`,
          ),
          facility,
          call,
        )
      ).status,
    ).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });
  it("allowlists approval fields and rejects malformed digests and oversized requests", async () => {
    const call = vi.fn().mockResolvedValue({ status: 200, data: {} });
    const request = (body: unknown) =>
      new Request(`http://localhost/insight?op=approve&id=${id}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    expect(
      (
        await reportProxy(
          request({
            sourceDigest: "a".repeat(64),
            facilityId: id,
            actorId: id,
            admin: true,
          }),
          facility,
          call,
        )
      ).status,
    ).toBe(200);
    expect(call).toHaveBeenCalledWith(
      `/internal/insight/air/${id}/approve`,
      "POST",
      { facilityId: facility, sourceDigest: "a".repeat(64) },
    );
    call.mockClear();
    expect(
      (
        await reportProxy(
          request({ sourceDigest: "unsupported" }),
          facility,
          call,
        )
      ).status,
    ).toBe(400);
    expect(
      (await reportProxy(request({ text: "a".repeat(5000) }), facility, call))
        .status,
    ).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });
  it("preserves audited JSON export and safe conflict responses", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ status: 200, data: { reportId: id, version: 1 } });
    const response = await reportProxy(
      new Request(`http://localhost/insight?op=export&id=${id}`),
      facility,
      call,
    );
    expect(response.headers.get("content-disposition")).toContain(
      "opa-air.json",
    );
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    call.mockResolvedValue({ status: 409, data: { sensitive: "private" } });
    const conflict = await reportProxy(
      new Request(`http://localhost/insight?op=version&id=${id}`),
      facility,
      call,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain("private");
  });
});
