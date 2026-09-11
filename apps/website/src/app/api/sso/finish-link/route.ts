import { NextResponse } from 'next/server';
import { apiUrl, getAccessToken } from '@/lib/operator-session';
import {
  clearPendingSso,
  failure,
  pendingSso,
  sameOrigin,
  ssoOrigin,
} from '@/lib/sso-bridge';
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return failure(403);
    const token = await getAccessToken(),
      base = apiUrl();
    if (!token || !base) return failure();
    const response = await fetch(base + '/sso/link/finish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(await pendingSso()),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    await clearPendingSso();
    if (!response.ok) return failure();
    const redirect = NextResponse.redirect(ssoOrigin() + '/operator', 303);
    redirect.headers.set('Cache-Control', 'no-store');
    redirect.headers.set('Referrer-Policy', 'no-referrer');
    return redirect;
  } catch {
    return failure();
  }
}
