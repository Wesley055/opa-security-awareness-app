import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncidentDetail } from '@/lib/operator-incident';
import type { OperatorTrackingSnapshot } from '@/lib/operator-tracking-types';
vi.mock('@/components/console/evidence-availability', () => ({ EvidenceAvailability: () => null }));
import { IncidentDetailView } from './incident-detail';

vi.mock('./incident-timeline', () => ({
  IncidentTimeline: () => <div data-testid="timeline" />,
}));

const INCIDENT: IncidentDetail = {
  id: 'incident-1',
  status: 'OPEN',
  trigger: 'BUTTON',
  latitude: '33.148270',
  longitude: '-96.810320',
  address: null,
  voicePhrase: null,
  lastTriggeredAt: null,
  retriggerCount: 0,
  createdAt: '2026-08-22T08:00:00.000Z',
  updatedAt: '2026-08-22T08:00:00.000Z',
  resolvedAt: null,
  journeySessionId: 'session-1',
  user: {
    firstName: 'Test',
    lastName: 'Resident',
  },
};

const INITIAL_TRACKING: OperatorTrackingSnapshot = {
  state: 'RECEIVING',
  lastFixReceivedAt: '2026-08-22T08:00:05.000Z',
  latest: {
    sequence: 10,
    latitude: 33.148261,
    longitude: -96.810317,
    accuracy: 5,
    speed: 1,
    heading: 90,
    source: 'background',
    origin: 'TRACKED',
    recordedAt: '2026-08-22T08:00:04.000Z',
    receivedAt: '2026-08-22T08:00:05.000Z',
  },
  points: [],
  serverTime: '2026-08-22T08:00:06.000Z',
};

function renderView() {
  return render(
    <IncidentDetailView
      initialIncident={INCIDENT}
      initialServerTime="2026-08-22T08:00:06.000Z"
      initialTracking={INITIAL_TRACKING}
      initialTimeline={[]}
      initialVerification={null}
    />,
  );
}

function trackedLocationRow(): HTMLElement {
  const label = screen.getByText('Tracked location');
  const row = label.closest('div');

  if (!row) {
    throw new Error('Tracked location row was not rendered.');
  }

  return row;
}

describe('IncidentDetailView live tracking', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the tracked position separately from the activation location', () => {
    renderView();

    expect(
      screen.getByText(/Receiving location updates/),
    ).toBeInTheDocument();

    const row = trackedLocationRow();

    expect(row).toHaveTextContent('33.14826, -96.81032');
    expect(row).toHaveTextContent('Latest background fix');
    expect(row).toHaveTextContent('sequence 10');
  });

  it("shows capture/receipt/accuracy and qualifies freshness", () => {
    renderView();
    for (const label of ["Location captured", "Location received", "Location accuracy", "Location freshness"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("5 metres")).toBeInTheDocument();
    expect(screen.getByText(/Recent capture at last successful check/)).toBeInTheDocument();
  });
  it("does not call an old buffered capture fresh just because its receipt is recent", () => {
    render(<IncidentDetailView initialIncident={INCIDENT} initialServerTime="2026-08-22T09:00:06.000Z" initialTracking={INITIAL_TRACKING} initialTimeline={[]} initialVerification={null} />);
    expect(screen.getByText(/Last known position; stale/)).toBeInTheDocument();
  });
  it.each(["NO_SESSION", "AWAITING_FIRST_FIX"] as const)("explains absent coordinates for %s without inventing a cause", state => {
    render(<IncidentDetailView initialIncident={{ ...INCIDENT, latitude: null, longitude: null }} initialServerTime="2026-08-22T08:00:06.000Z" initialTracking={{ ...INITIAL_TRACKING, state, latest: null }} initialTimeline={[]} initialVerification={null} />);
    expect(screen.getByText("Location availability")).toBeInTheDocument();
    expect(screen.getByText(/No usable tracked position/)).toBeInTheDocument();
    expect(screen.queryByText(/Recent capture at last/)).toBeNull();
  });
  it('updates tracking through the existing five-second incident poll', async () => {
    vi.useFakeTimers();

    const updatedTracking: OperatorTrackingSnapshot = {
      ...INITIAL_TRACKING,
      lastFixReceivedAt: '2026-08-22T08:00:10.000Z',
      latest: {
        ...INITIAL_TRACKING.latest!,
        sequence: 11,
        latitude: 33.13059,
        longitude: -96.82338,
        recordedAt: '2026-08-22T08:00:09.000Z',
        receivedAt: '2026-08-22T08:00:10.000Z',
      },
      serverTime: '2026-08-22T08:00:11.000Z',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith('/tracking')) {
        return new Response(
          JSON.stringify({ ok: true, tracking: updatedTracking }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url.endsWith('/timeline')) {
        return new Response(
          JSON.stringify({ ok: true, events: [] }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url === '/api/operator/incidents/incident-1') {
        return new Response(
          JSON.stringify({
            ok: true,
            incident: INCIDENT,
            serverTime: '2026-08-22T08:00:11.000Z',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderView();

    let row = trackedLocationRow();

    expect(row).toHaveTextContent('33.14826, -96.81032');
    expect(row).toHaveTextContent('sequence 10');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    row = trackedLocationRow();

    expect(row).toHaveTextContent('33.13059, -96.82338');
    expect(row).toHaveTextContent('sequence 11');
  });
});
