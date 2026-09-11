import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
export const SSO_COOKIE = '__Host-opa_sso';
export function ssoOrigin(): string {
  const value = process.env.SSO_WEB_ORIGIN;
  if (!value) throw new Error('SSO unavailable');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value)
    throw new Error('SSO unavailable');
  return value;
}
export function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === ssoOrigin();
}
export async function pendingSso() {
  const store = await cookies();
  const value = store.get(SSO_COOKIE)?.value ?? '';
  const [transactionId, browserBinding] = value.split('.');
  if (
    !transactionId ||
    !/^[0-9a-f-]{36}$/.test(transactionId) ||
    !browserBinding ||
    !/^[A-Za-z0-9_-]{43}$/.test(browserBinding)
  )
    throw new Error('SSO unavailable');
  return { transactionId, browserBinding };
}
export async function setPendingSso(
  transactionId: string,
  browserBinding: string,
) {
  const store = await cookies();
  store.set(SSO_COOKIE, transactionId + '.' + browserBinding, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 300,
  });
}
export async function clearPendingSso() {
  (await cookies()).delete(SSO_COOKIE);
}
export function failure(status = 401) {
  return NextResponse.json(
    { ok: false, error: 'Institutional sign-in could not be completed.' },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
export async function boundedBody(
  request: Request,
  max = 96000,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error('Body too large');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } finally {
    await reader.cancel();
  }
}
