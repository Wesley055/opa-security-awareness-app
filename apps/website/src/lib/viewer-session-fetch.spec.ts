import { beforeEach, describe, expect, it, vi } from 'vitest';
import { viewerSessionFetch } from './viewer-session-fetch';

describe('viewerSessionFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not refresh a non-401 response', async () => {
    const first = new Response(null, { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(first);
    vi.stubGlobal('fetch', fetchMock);

    const result = await viewerSessionFetch('/api/operator/residents');

    expect(result).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes once and retries the original request once after 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const init = { method: 'POST', body: 'body' };
    const result = await viewerSessionFetch('/api/operator/residents', init);

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/operator/residents', init);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/operator/refresh', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/operator/residents', init);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns authoritative refresh rejection without retrying', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await viewerSessionFetch('/api/operator/residents');

    expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns refresh unavailability without retrying', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await viewerSessionFetch('/api/operator/residents');

    expect(result.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not start a second refresh loop when the retry is still 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await viewerSessionFetch('/api/operator/residents');

    expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/operator/refresh')).toHaveLength(1);
  });
});
