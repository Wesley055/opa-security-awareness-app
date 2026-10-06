import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncidentDetail } from "@/lib/operator-incident";
import type { TimelineEvent } from "@/lib/operator-timeline";
vi.mock("@/components/console/evidence-availability", () => ({
  EvidenceAvailability: () => null,
}));
vi.mock("@/components/console/delivery-confirmation", () => ({
  DeliveryConfirmation: () => null,
}));
vi.mock("@/lib/viewer-session-fetch", () => ({
  viewerSessionFetch: (...args: unknown[]) =>
    fetch(...(args as Parameters<typeof fetch>)),
}));
import { IncidentDetailView } from "./incident-detail";
const incident: IncidentDetail = {
  id: "6d08a466-e685-4123-a06e-c281e389a221",
  status: "OPEN",
  trigger: "VOICE_HELP_HELP",
  latitude: null,
  longitude: null,
  address: null,
  voicePhrase: null,
  lastTriggeredAt: null,
  retriggerCount: 0,
  createdAt: "2026-09-29T10:00:00Z",
  updatedAt: "2026-09-29T10:00:00Z",
  resolvedAt: null,
  journeySessionId: null,
  user: { firstName: "Test", lastName: "Resident" },
};
let events: TimelineEvent[], current: IncidentDetail, denied: number;
const json = (body: unknown) => Response.json(body);
function show() {
  render(
    <IncidentDetailView
      initialIncident={incident}
      initialServerTime={incident.createdAt}
      initialTracking={null}
      initialTimeline={events}
      initialVerification={{ valid: true }}
    />,
  );
}
async function record(type: string, note: string) {
  fireEvent.change(screen.getByLabelText("Operation"), {
    target: { value: type },
  });
  fireEvent.change(screen.getByLabelText("Response note"), {
    target: { value: note },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record operation" }));
  await waitFor(() =>
    expect(
      screen.getByText("Operation recorded. Refreshing canonical history."),
    ).toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.getByText(new RegExp(note))).toBeInTheDocument(),
  );
}
beforeEach(() => {
  current = { ...incident };
  events = [];
  denied = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (denied) return new Response(null, { status: denied });
    const url = String(input);
    if (url.endsWith("/operations")) {
      const body = JSON.parse(String(init?.body));
      events = [
        ...events,
        {
          sequence: events.length + 1,
          type: "OPERATOR_" + body.type,
          occurredAt: "2026-09-29T10:01:00Z",
          source: "OPERATOR",
          display: { note: body.note, actorRole: "FACILITY_OPERATOR" },
        },
      ];
      return json({ ok: true });
    }
    if (url.endsWith("/timeline/verify"))
      return json({ verification: { valid: true } });
    if (url.endsWith("/timeline")) return json({ events });
    if (url.endsWith("/tracking")) return json({ tracking: null });
    return json({ incident: current, serverTime: incident.createdAt });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("canonical Operator incident operations", () => {
  it("shows persisted SafeWalk emergency provenance without private journey fields", () => {
    current = {
      ...incident,
      safeWalkEmergency: {
        source: "SAFEWALK_EXPLICIT",
        emergencyStartedAt: incident.createdAt,
      },
    };
    render(
      <IncidentDetailView
        initialIncident={current}
        initialServerTime={incident.createdAt}
        initialTracking={null}
        initialTimeline={[]}
        initialVerification={{ valid: true }}
      />,
    );
    expect(
      screen.getByText(/Activation source: SafeWalk emergency/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Journey protection: Escalated to emergency/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Emergency started:/)).toBeInTheDocument();
    expect(
      screen.queryByText(/destination|guardian|private route/i),
    ).not.toBeInTheDocument();
  });

  it("retains the operation reference for an uncertain retry", async () => {
    const requests: string[] = [];
    const delegate = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/operations")) {
        requests.push(String(init?.body));
        if (requests.length === 1) throw new Error("network unavailable");
      }
      return delegate(input, init);
    });
    show();
    fireEvent.change(screen.getByLabelText("Response note"), {
      target: { value: "Response received" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record operation" }));
    await screen.findByText(/Result unknown/);
    fireEvent.click(screen.getByRole("button", { name: "Record operation" }));
    await screen.findByText("Operator acknowledged");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  });
  it("removes controls when an operation is denied after rendering", async () => {
    show();
    denied = 403;
    fireEvent.change(screen.getByLabelText("Response note"), {
      target: { value: "Response received" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record operation" }));
    await screen.findByText("Incident unavailable");
    expect(screen.queryByLabelText("Operation")).not.toBeInTheDocument();
  });

  it("acknowledges, dispatches and records progress without closing; retains history after external resolution", async () => {
    show();
    expect(
      screen.getByText("Activation source: Voice SOS"),
    ).toBeInTheDocument();
    await record("ACKNOWLEDGED", "Response received");
    expect(screen.getByText("Incident state: Open")).toBeInTheDocument();
    await record("DISPATCHED", "Response dispatched");
    await record("RESPONSE_PROGRESS", "Team arriving");
    current = {
      ...current,
      status: "RESOLVED",
      resolvedAt: "2026-09-29T10:02:00Z",
    };
    events.push({
      sequence: 4,
      type: "INCIDENT_RESOLVED",
      occurredAt: current.resolvedAt!,
      source: "FACILITY_ADMIN",
      display: { previousStatus: "OPEN", newStatus: "RESOLVED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh incident" }));
    await waitFor(() =>
      expect(screen.getByText("Incident resolved")).toBeInTheDocument(),
    );
    expect(screen.getByText("Operator acknowledged")).toBeInTheDocument();
    expect(screen.getByText("Operator dispatched")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record operation" }),
    ).not.toBeInTheDocument();
    for (const name of [
      /^resolve/i,
      /^close/i,
      /^cancel/i,
      /^delete/i,
      /^edit/i,
    ])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])(
    "clears incident and controls on current authority denial %s",
    async (status) => {
      show();
      denied = status;
      fireEvent.click(screen.getByRole("button", { name: "Refresh incident" }));
      await waitFor(() =>
        expect(screen.getByText("Incident unavailable")).toBeInTheDocument(),
      );
      expect(screen.queryByLabelText("Response note")).not.toBeInTheDocument();
    },
  );
  it("clears controls on context invalidation", () => {
    show();
    act(() => window.dispatchEvent(new Event("opa:access-changed")));
    expect(screen.getByText("Incident unavailable")).toBeInTheDocument();
  });
  it("shows silent activation only from canonical history", () => {
    events = [
      {
        sequence: 1,
        type: "INCIDENT_CREATED",
        occurredAt: incident.createdAt,
        source: "SYSTEM",
        display: { silentMode: true },
      },
    ];
    show();
    expect(
      screen.getByText("Activation source: Silent SOS"),
    ).toBeInTheDocument();
  });
  it("observes external resolution on the bounded five-second poll", async () => {
    vi.useFakeTimers();
    show();
    current = { ...current, status: "RESOLVED" };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText("Incident state: Resolved")).toBeInTheDocument();
    expect(screen.queryByLabelText("Response note")).not.toBeInTheDocument();
  });
});
