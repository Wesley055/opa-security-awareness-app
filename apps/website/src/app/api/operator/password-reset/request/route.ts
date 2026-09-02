import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const GENERIC_MESSAGE = 'If an eligible OPA account exists for that email, password reset instructions have been sent.';

function getApiBaseUrl(): string | null {
  const value = process.env.OPA_API_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

export async function POST(request: Request) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return NextResponse.json({ ok: false, error: 'Password reset is temporarily unavailable.' }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 }); }
  const email = typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254) return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 });

  try {
    const response = await fetch(`${baseUrl}/auth/password-reset/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (response.ok) return NextResponse.json({ ok: true, message: GENERIC_MESSAGE }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
    if (response.status === 400) return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 });
    return NextResponse.json({ ok: false, error: 'Password reset is temporarily unavailable.' }, { status: 503 });
  } catch {
    return NextResponse.json({ ok: false, error: 'Password reset is temporarily unavailable.' }, { status: 503 });
  }
}