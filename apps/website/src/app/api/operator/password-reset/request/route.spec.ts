import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('password-reset request bridge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes email and preserves the generic response', async () => {
    process.env.OPA_API_URL = 'https://api.example.test/';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(new Request('https://viewer.example.test/api/operator/password-reset/request', { method: 'POST', body: JSON.stringify({ email: ' USER@Example.COM ' }) }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, message: 'If an eligible OPA account exists for that email, password reset instructions have been sent.' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ email: 'user@example.com' });
  });

  it('does not expose upstream server detail', async () => {
    process.env.OPA_API_URL = 'https://api.example.test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive', { status: 500 })));
    const response = await POST(new Request('https://viewer.example.test/api/operator/password-reset/request', { method: 'POST', body: JSON.stringify({ email: 'user@example.com' }) }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Password reset is temporarily unavailable.' });
  });
});