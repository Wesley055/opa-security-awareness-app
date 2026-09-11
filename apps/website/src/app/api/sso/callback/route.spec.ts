// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  apiUrl: vi.fn(),
  setOperatorSession: vi.fn(),
  pendingSso: vi.fn(),
  clearPendingSso: vi.fn(),
}));
vi.mock('@/lib/operator-session', () => ({
  apiUrl: mock.apiUrl,
  setOperatorSession: mock.setOperatorSession,
}));
vi.mock('@/lib/sso-bridge', () => ({
  ssoOrigin: () => 'https://opa.example.test',
  pendingSso: mock.pendingSso,
  clearPendingSso: mock.clearPendingSso,
  boundedBody: (r: Request) => r.text(),
  failure: (status = 401) =>
    Response.json(
      { ok: false, error: 'Institutional sign-in could not be completed.' },
      { status },
    ),
}));
import { GET, POST } from './route';
describe('SSO Command Center session bridge', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.apiUrl.mockReturnValue('https://api.example.test');
    mock.pendingSso.mockResolvedValue({
      transactionId: 'opaque-id',
      browserBinding: 'private-cookie',
    });
  });
  const response = (role: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          accessToken: 'OPA-access',
          refreshToken: 'OPA-refresh',
          user: { role },
        }),
      ),
    );
  it.each(['FACILITY_OPERATOR', 'FACILITY_ADMIN'])(
    'uses the existing HttpOnly session for %s',
    async (role) => {
      response(role);
      const result = await GET(
        new Request(
          'https://opa.example.test/api/sso/callback?code=private-code&state=state',
        ),
      );
      expect(result.status).toBe(303);
      expect(result.headers.get('location')).toBe(
        'https://opa.example.test/operator',
      );
      expect(mock.setOperatorSession).toHaveBeenCalledWith({
        accessToken: 'OPA-access',
        refreshToken: 'OPA-refresh',
      });
      expect(await result.text()).not.toContain('OPA-access');
    },
  );
  it.each(['ADMIN', 'USER', 'RESPONDER'])(
    'denies %s from tenant Command Center',
    async (role) => {
      response(role);
      expect(
        (
          await GET(
            new Request(
              'https://opa.example.test/api/sso/callback?code=c&state=s',
            ),
          )
        ).status,
      ).toBe(403);
      expect(mock.setOperatorSession).not.toHaveBeenCalled();
    },
  );
  it('requires the browser correlation cookie', async () => {
    mock.pendingSso.mockRejectedValue(new Error('Missing'));
    response('FACILITY_OPERATOR');
    expect(
      (
        await GET(
          new Request('https://opa.example.test/api/sso/callback?state=s'),
        )
      ).status,
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards SAML only to the backend and exposes no assertion', async () => {
    response('FACILITY_OPERATOR');
    const result = await POST(
      new Request('https://opa.example.test/api/sso/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          RelayState: 'state',
          SAMLResponse: 'private-assertion',
        }),
      }),
    );
    expect(result.status).toBe(303);
    expect(await result.text()).not.toContain('private-assertion');
  });
  it('defers linking until the original OPA session returns on a same-origin request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ linkPending: true })),
    );
    const result = await GET(
      new Request('https://opa.example.test/api/sso/callback?code=c&state=s'),
    );
    expect(result.headers.get('location')).toBe(
      'https://opa.example.test/operator/sso/complete',
    );
    expect(mock.setOperatorSession).not.toHaveBeenCalled();
    expect(mock.clearPendingSso).not.toHaveBeenCalled();
  });
  it('rejects duplicate state parameters', async () => {
    response('FACILITY_OPERATOR');
    expect(
      (
        await GET(
          new Request(
            'https://opa.example.test/api/sso/callback?state=a&state=b',
          ),
        )
      ).status,
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
