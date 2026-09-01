// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  apiUrl: vi.fn(),
  setOperatorSession: vi.fn(),
}));

vi.mock('@/lib/operator-session', () => ({
  apiUrl: session.apiUrl,
  setOperatorSession: session.setOperatorSession,
}));

import { POST } from './route';

function loginRequest() {
  return new Request('http://localhost/api/operator/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'StrongPassword123!',
    }),
  });
}

function mockApiLogin(role: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          user: { role },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ),
  );
}

describe('POST /api/operator/login', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    session.apiUrl.mockReturnValue('https://api.example.test');
    session.setOperatorSession.mockResolvedValue(undefined);
  });

  it.each(['FACILITY_OPERATOR', 'FACILITY_ADMIN'])(
    'establishes a Viewer session for %s',
    async (role) => {
      mockApiLogin(role);

      const response = await POST(loginRequest());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });

      expect(session.setOperatorSession).toHaveBeenCalledWith({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    },
  );

  it.each(['USER', 'ADMIN'])(
    'rejects %s from the facility Viewer',
    async (role) => {
      mockApiLogin(role);

      const response = await POST(loginRequest());

      expect(response.status).toBe(403);
      expect(session.setOperatorSession).not.toHaveBeenCalled();
    },
  );
});
