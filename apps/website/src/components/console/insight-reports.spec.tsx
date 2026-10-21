import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { InsightReports } from "./insight-reports";
afterEach(cleanup);
const report = {
  reportId: "air",
  version: 2,
  sourceDigest: "a".repeat(64),
  sourceFactCutoff: "2026-01-01T00:01:00Z",
  generatedAt: "2026-01-01T00:01:01Z",
  supersedesId: "prior",
  review: { status: "REVIEW_REQUIRED" },
  document: {
    summary: "Recorded evidence only.",
    timeline: [],
    evidence: [],
    uncertainty: ["Location verification unavailable."],
  },
};
const assessment = {
  policy: null,
  evidenceCutoff: report.sourceFactCutoff,
  findings: [
    {
      control: "ACKNOWLEDGEMENT",
      status: "INDETERMINATE",
      explanation: "Applicable policy unavailable.",
      evidenceReferences: [],
      thresholdSeconds: null,
      observedSeconds: null,
    },
  ],
  uncertainty: [],
};
const detail = {
  incidentId: "incident",
  report,
  assessment,
  reportVersions: [{ reportId: "air", version: 2, supersedesId: "prior" }],
  correctiveActions: [],
  governance: { explanation: "Partial audit coverage.", events: [] },
};
function transport() {
  return vi.fn().mockImplementation(async (path: string) => {
    const op = new URL("http://localhost/" + path).searchParams.get("op");
    return Response.json(
      op === "list"
        ? {
            canReview: true,
            incidents: [
              {
                incidentId: "incident",
                status: "RESOLVED",
                generationStatus: "GENERATED",
                report: { reportId: "air", version: 2 },
              },
            ],
          }
        : op === "detail"
          ? detail
          : report,
    );
  });
}
describe("institutional incident reports", () => {
  it("shows uncertainty, immutable version metadata and unavailable AI without a compliance claim", async () => {
    const call = transport();
    render(
      <InsightReports
        from="2026-01-01"
        to="2026-02-01"
        facilityId="facility"
        transport={call}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Load incident reports" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Incident incident/ }),
    );
    await screen.findByText(/Acknowledgement: Indeterminate/);
    expect(screen.getByText(/AI-assisted narrative: unavailable/)).toBeTruthy();
    expect(screen.getByText(/Source digest:/)).toBeTruthy();
    expect(
      screen.getByText(/selected legacy AIR has no stored control assessment/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve reviewed snapshot" }),
    );
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        expect.stringContaining("op=approve"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sourceDigest: report.sourceDigest }),
        }),
      ),
    );
  });
  it("clears evidence on authority loss and ignores stale responses after a facility change", async () => {
    const call = transport();
    let release!: (response: Response) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const ui = render(
      <InsightReports
        from="2026-01-01"
        to="2026-02-01"
        facilityId="old"
        transport={call}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Load incident reports" }),
    );
    ui.rerender(
      <InsightReports
        from="2026-01-01"
        to="2026-02-01"
        facilityId="new"
        transport={call}
      />,
    );
    release(
      Response.json({
        canReview: true,
        incidents: [
          {
            incidentId: "old-incident",
            status: "RESOLVED",
            generationStatus: "GENERATED",
          },
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByText(/old-incident/)).toBeNull());
    fireEvent(window, new Event("opa-institutional-authority-lost"));
    expect(screen.getByText(/Evidence cleared/)).toBeTruthy();
  });
});
