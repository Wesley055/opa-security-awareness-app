import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { ReportingShell } from "./reporting-shell";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";
vi.mock("@/lib/viewer-session-fetch", () => ({ viewerSessionFetch: vi.fn() }));
const summary = {
  incidentCount: 2,
  unresolved: 1,
  staleUnresolved: 1,
  resolutionMeanMs: null,
  resolutionKnown: 0,
  resolutionUnknown: 1,
  evidencePresent: 2,
  evidencePossible: 10,
  missingEvidence: 1,
  missingClosureProvenance: 1,
  actions: { total: 1, open: 1, completed: 0, verified: 0, overdue: 1 },
  delivery: { PROVIDER_ACCEPTED: 1, DELIVERED: 0 },
  byTrigger: { SOS_BUTTON: 2 },
  bySource: { MANUAL: 2 },
  byMode: { SILENT: 2 },
  byDay: { "2026-01-01": 2 },
};
const load = () =>
  fireEvent.click(screen.getByRole("button", { name: "Load report" }));
beforeEach(() => {
  vi.mocked(viewerSessionFetch).mockResolvedValue(Response.json({ summary }));
});
afterEach(cleanup);
describe("current reporting workspace", () => {
  it("shows populated authoritative metrics with unknown latency and delivery distinction", async () => {
    render(<ReportingShell />);
    load();
    await screen.findByText("Report loaded.");
    expect(screen.getByText("PROVIDER ACCEPTED")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
  });
  it("shows empty report separately from degraded backend", async () => {
    vi.mocked(viewerSessionFetch).mockResolvedValue(
      Response.json({ summary: { ...summary, incidentCount: 0 } }),
    );
    render(<ReportingShell />);
    load();
    await screen.findByText("No incidents in this date window.");
  });
  it("rejects invalid dates before transport", () => {
    render(<ReportingShell />);
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2020-01-01" },
    });
    load();
    expect(screen.getByText(/Choose a valid date range/)).toBeTruthy();
    expect(viewerSessionFetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])(
    "removes results on denied status %s",
    async (status) => {
      vi.mocked(viewerSessionFetch).mockResolvedValue(
        new Response(null, { status }),
      );
      render(<ReportingShell />);
      load();
      await screen.findByText(/Reporting access is no longer authorized/);
      expect(screen.queryByText("Notification outcomes")).toBeNull();
    },
  );
  it("does not globally log out on a transient outage", async () => {
    const lost = vi.fn();
    window.addEventListener("opa:access-changed", lost);
    vi.mocked(viewerSessionFetch).mockRejectedValue(Error("offline"));
    render(<ReportingShell />);
    load();
    await screen.findByText(/Retry without signing out/);
    expect(lost).not.toHaveBeenCalled();
    window.removeEventListener("opa:access-changed", lost);
  });
  it.each([
    "focus",
    "pageshow",
    "opa:access-changed",
    "opa-institutional-authority-lost",
  ])("clears rendered authority state on %s", async (event) => {
    render(<ReportingShell />);
    load();
    await screen.findByText("Report loaded.");
    fireEvent(window, new Event(event));
    expect(screen.queryByText("Notification outcomes")).toBeNull();
    expect(screen.getByText(/Report cleared/)).toBeTruthy();
  });
  it("ignores an in-flight old actor response after remount", async () => {
    let resolve!: (v: Response) => void;
    vi.mocked(viewerSessionFetch).mockReturnValueOnce(
      new Promise((r) => (resolve = r)),
    );
    const ui = render(<ReportingShell key="old" />);
    load();
    ui.rerender(<ReportingShell key="new" />);
    resolve(Response.json({ summary }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Load report" })).toBeTruthy(),
    );
    expect(screen.queryByText("Notification outcomes")).toBeNull();
  });
  it("uses institutional transport with selected scope and no operator cookie fallback", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ summary }));
    render(<ReportingShell facilityId="facility" transport={transport} />);
    load();
    await screen.findByText("Report loaded.");
    expect(transport.mock.calls[0][0]).toContain("facilityId=facility");
    expect(viewerSessionFetch).not.toHaveBeenCalled();
  });
});
