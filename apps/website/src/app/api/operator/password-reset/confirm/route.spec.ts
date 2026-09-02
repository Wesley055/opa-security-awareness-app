import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('password-reset confirm bridge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('forwards only token and password', async () => {
    process.env.OPA_API_URL = 'https://api.example.test/';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(new Request('https://viewer.example.test/api/operator/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token: 'a'.repeat(64), password: 'long-enough-password', ignored: 'nope' }) }));
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ token: 'a'.repeat(64), password: 'long-enough-password' });
  });

  it('maps invalid or expired tokens to a bounded error', async () => {
    process.env.OPA_API_URL = 'https://api.example.test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('detail', { status: 400 })));
    const response = await POST(new Request('https://viewer.example.test/api/operator/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token: 'b'.repeat(64), password: 'long-enough-password' }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'This password reset token is invalid or expired.' });
  });
});