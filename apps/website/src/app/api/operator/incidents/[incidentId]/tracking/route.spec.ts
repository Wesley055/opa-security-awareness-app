// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tracking = vi.hoisted(() => ({
  fetchOperatorTracking: vi.fn(),
}));

vi.mock('@/lib/operator-tracking', () => ({
  fetchOperatorTracking: tracking.fetchOperatorTracking,
}));

import { GET } from './route';

function context(incidentId = 'incident-1') {
  return {
    params: Promise.resolve({ incidentId }),
  };
}

describe('GET /api/operator/incidents/:incidentId/tracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the validated tracking snapshot with private no-store headers', async () => {
    const snapshot = {
      state: 'RECEIVING',
      lastFixReceivedAt: '2026-08-22T08:59:13.018Z',
      latest: {
        sequence: 3529,
        latitude: 33.148261,
        longitude: -96.810317,
        accuracy: 5,
        speed: 1.2,
        heading: 90,
        source: 'background',
        origin: 'TRACKED',
        recordedAt: '2026-08-22T08:59:09.999Z',
        receivedAt: '2026-08-22T08:59:13.018Z',
      },
      points: [],
      serverTime: '2026-08-22T09:00:00.000Z',
    };

    tracking.fetchOperatorTracking.mockResolvedValue({
      state: 'READY',
      tracking: snapshot,
    });

    const response = await GET(
      new Request('http://localhost/test'),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      tracking: snapshot,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it.each([
    ['REJECTED', 401],
    ['NOT_FOUND', 404],
    ['UNAVAILABLE', 503],
  ])('maps %s to HTTP %i', async (state, expectedStatus) => {
    tracking.fetchOperatorTracking.mockResolvedValue({ state });

    const response = await GET(
      new Request('http://localhost/test'),
      context(),
    );

    expect(response.status).toBe(expectedStatus);
  });

  it('maps forbidden without discarding the authorization message', async () => {
    tracking.fetchOperatorTracking.mockResolvedValue({
      state: 'FORBIDDEN',
      message: 'Not authorized for this incident.',
    });

    const response = await GET(
      new Request('http://localhost/test'),
      context(),
    );

    expect(response.status).toBe(403);

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Not authorized for this incident.',
    });
  });
});
