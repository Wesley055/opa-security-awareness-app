import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getApiBaseUrl(): string | null {
  const value = process.env.OPA_API_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

export async function POST(request: Request) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return NextResponse.json({ ok: false, error: 'Password reset is temporarily unavailable.' }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid password reset request.' }, { status: 400 }); }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  const password = typeof record.password === 'string' ? record.password : '';
  if (token.length < 32 || password.length < 12) return NextResponse.json({ ok: false, error: 'Invalid password reset request.' }, { status: 400 });

  try {
    const response = await fetch(`${baseUrl}/auth/password-reset/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (response.ok) return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
    if (response.status === 400) return NextResponse.json({ ok: false, error: 'This password reset token is invalid or expired.' }, { status: 400 });
    return NextResponse.json({ ok: false, error: 'Password reset is temporarily unavailable.' }, { status: 503 });
  } catch {
    return NextResponse.json({ ok: false, error: 'Password reset is temporarily unavailable.' }, { status: 503 });
  }
}