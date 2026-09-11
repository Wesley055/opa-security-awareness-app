import { NextResponse } from 'next/server';
import { apiUrl, setOperatorSession } from '@/lib/operator-session';
import {
  boundedBody,
  clearPendingSso,
  failure,
  pendingSso,
  ssoOrigin,
} from '@/lib/sso-bridge';
export const dynamic = 'force-dynamic';
async function callback(request: Request, saml: boolean) {
  try {
    const origin = ssoOrigin();
    if (new URL(request.url).origin !== origin) return failure(403);
    const pending = await pendingSso();
    const base = apiUrl();
    if (!base) return failure(503);
    if (
      saml &&
      !request.headers
        .get('content-type')
        ?.startsWith('application/x-www-form-urlencoded')
    )
      return failure(400);
    if (!saml && request.url.length > 16384) return failure(400);
    const params = saml
      ? new URLSearchParams(await boundedBody(request))
      : new URL(request.url).searchParams;
    const state = params.get(saml ? 'RelayState' : 'state');
    if (
      !state ||
      params.getAll(saml ? 'RelayState' : 'state').length !== 1 ||
      (saml && params.getAll('SAMLResponse').length !== 1)
    )
      return failure();
    const rawResponse = saml
      ? params.get('SAMLResponse')
      : origin + '/api/sso/callback?' + params.toString();
    const response = await fetch(base + '/sso/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...pending, state, rawResponse }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await clearPendingSso();
      return failure();
    }
    const result = (await response.json()) as {
      linkPending?: boolean;
      accessToken?: string;
      refreshToken?: string;
      user?: { role?: string };
    };
    if (result.linkPending) {
      const redirect = NextResponse.redirect(
        origin + '/operator/sso/complete',
        303,
      );
      redirect.headers.set('Cache-Control', 'no-store');
      redirect.headers.set('Referrer-Policy', 'no-referrer');
      return redirect;
    }
    await clearPendingSso();
    if (
      !result.accessToken ||
      !result.refreshToken ||
      !['FACILITY_OPERATOR', 'FACILITY_ADMIN'].includes(result.user?.role ?? '')
    )
      return failure(403);
    await setOperatorSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    const redirect = NextResponse.redirect(origin + '/operator', 303);
    redirect.headers.set('Cache-Control', 'no-store');
    redirect.headers.set('Referrer-Policy', 'no-referrer');
    return redirect;
  } catch {
    return failure();
  }
}
export async function GET(request: Request) {
  return callback(request, false);
}
export async function POST(request: Request) {
  return callback(request, true);
}
