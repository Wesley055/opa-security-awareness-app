import { NextResponse } from 'next/server';
import { apiUrl, getAccessToken } from '@/lib/operator-session';
import {
  boundedBody,
  failure,
  sameOrigin,
  setPendingSso,
  ssoOrigin,
} from '@/lib/sso-bridge';
export const dynamic = 'force-dynamic';
async function initiate(request: Request, link: boolean) {
  try {
    const origin = ssoOrigin();
    if (
      new URL(request.url).origin !== origin ||
      (link && !sameOrigin(request))
    )
      return failure(403);
    const params = link
      ? new URLSearchParams(await boundedBody(request, 4096))
      : new URL(request.url).searchParams;
    const id = params.get('configurationId');
    if (
      !id ||
      !/^[0-9a-f-]{36}$/.test(id) ||
      params.getAll('configurationId').length !== 1
    )
      return failure(400);
    const base = apiUrl();
    if (!base) return failure(503);
    const token = link ? await getAccessToken() : null;
    if (link && !token) return failure();
    const response = await fetch(
      base + '/sso/configurations/' + id + (link ? '/link' : '/initiate'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        ...(link
          ? { body: JSON.stringify({ password: params.get('password') }) }
          : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) return failure();
    const result = (await response.json()) as {
      transactionId: string;
      browserBinding: string;
      url: string;
    };
    if (
      !/^[0-9a-f-]{36}$/.test(result.transactionId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(result.browserBinding) ||
      new URL(result.url).protocol !== 'https:'
    )
      return failure(502);
    await setPendingSso(result.transactionId, result.browserBinding);
    const redirect = NextResponse.redirect(result.url, 303);
    redirect.headers.set('Cache-Control', 'no-store');
    redirect.headers.set('Referrer-Policy', 'no-referrer');
    return redirect;
  } catch {
    return failure();
  }
}
export async function GET(request: Request) {
  return initiate(request, false);
}
export async function POST(request: Request) {
  return initiate(request, true);
}
