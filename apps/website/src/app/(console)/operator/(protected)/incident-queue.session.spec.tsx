// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncidentQueue } from './incident-queue';

describe('IncidentQueue session recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes once and retries Load more after an expired access token', async () => {
    const nextPage = {
      ok: true,
      incidents: [],
      nextCursor: null,
      hasMore: false,
      serverTime: '2026-09-01T23:00:00.000Z',
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(nextPage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    render(
      <IncidentQueue
        initialIncidents={[]}
        initialNextCursor="cursor-2"
        initialHasMore={true}
        initialServerTime="2026-09-01T22:59:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/operator/incidents?cursor=cursor-2',
      { cache: 'no-store' },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/operator/refresh',
      { method: 'POST' },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/operator/incidents?cursor=cursor-2',
      { cache: 'no-store' },
    );
  });
});
