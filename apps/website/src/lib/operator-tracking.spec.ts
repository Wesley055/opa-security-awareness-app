// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const session = vi.hoisted(() => ({
  apiUrl: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock('@/lib/operator-session', () => ({
  apiUrl: session.apiUrl,
  getAccessToken: session.getAccessToken,
}));

import { fetchOperatorTracking } from '@/lib/operator-tracking';

const SNAPSHOT = {
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

describe('fetchOperatorTracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    session.apiUrl.mockReturnValue('https://api.example.test');
    session.getAccessToken.mockResolvedValue('access-token');
  });

  it('calls the guarded tracking endpoint without caching', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(SNAPSHOT), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await fetchOperatorTracking('incident / 1');

    expect(result).toEqual({
      state: 'READY',
      tracking: SNAPSHOT,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(
      'https://api.example.test/incidents/incident%20%2F%201/tracking',
    );

    expect(init?.headers).toEqual({
      Authorization: 'Bearer access-token',
    });

    expect(init?.cache).toBe('no-store');
  });

  it('does not call upstream without an access token', async () => {
    session.getAccessToken.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(
      fetchOperatorTracking('incident-1'),
    ).resolves.toEqual({ state: 'REJECTED' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, { state: 'REJECTED' }],
    [404, { state: 'NOT_FOUND' }],
  ])('maps HTTP %i without inventing tracking state', async (status, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status }),
    );

    await expect(
      fetchOperatorTracking('incident-1'),
    ).resolves.toEqual(expected);
  });

  it('preserves the API 403 message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'Not authorized for this incident.' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(
      fetchOperatorTracking('incident-1'),
    ).resolves.toEqual({
      state: 'FORBIDDEN',
      message: 'Not authorized for this incident.',
    });
  });

  it('rejects a malformed success body instead of treating it as live', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          state: 'RECEIVING',
          latest: {
            latitude: '33.148261',
            longitude: -96.810317,
          },
          points: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(
      fetchOperatorTracking('incident-1'),
    ).resolves.toEqual({ state: 'UNAVAILABLE' });
  });

  it('accepts activation fallback with no sequence', async () => {
    const activation = {
      state: 'NO_SESSION',
      lastFixReceivedAt: null,
      latest: {
        latitude: 33.14827,
        longitude: -96.81032,
        recordedAt: '2026-08-22T07:30:00.000Z',
        receivedAt: null,
        source: 'activation',
        origin: 'ACTIVATION',
      },
      points: [],
      serverTime: '2026-08-22T09:00:00.000Z',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(activation), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      fetchOperatorTracking('incident-1'),
    ).resolves.toEqual({
      state: 'READY',
      tracking: activation,
    });
  });
});
