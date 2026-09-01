import { NextResponse } from 'next/server';
import { apiUrl, setOperatorSession } from '@/lib/operator-session';

/**
 * Same-origin login bridge for the operator console.
 *
 * The browser posts credentials here, never to the API host directly. That
 * keeps CORS off the authentication path, keeps the API hostname out of
 * client code, and gives one controlled place to set httpOnly cookies the
 * browser's JavaScript cannot read.
 *
 * THE RESPONSE BODY CARRIES NO TOKENS. The client learns only whether it
 * worked. If a token appeared in this JSON it would be in memory, in
 * devtools, and in any error reporter the page ever gains.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const base = apiUrl();

  if (!base) {
    // Fail loudly rather than rendering a login that silently never works.
    console.error('OPA_API_URL is not configured.');
    return NextResponse.json(
      { ok: false, error: 'Sign-in is unavailable.' },
      { status: 503 },
    );
  }

  let email: unknown;
  let password: unknown;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    email = body.email;
    password = body.password;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Enter your email and password.' },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // The API answers 401 for every credential failure - unknown account,
      // wrong password, suspended, never activated - and this does not
      // enrich it. Telling an unauthenticated caller which one it was
      // discloses that an account exists.
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    const result = (await response.json()) as {
      accessToken?: string;
      refreshToken?: string;
      user?: { role?: string };
    };

    if (!result.accessToken || !result.refreshToken) {
      console.error('Login succeeded but returned no tokens.');
      return NextResponse.json(
        { ok: false, error: 'Sign-in is unavailable.' },
        { status: 502 },
      );
    }

    // This bridge admits only facility-scoped Viewer roles.
    // It is not the authorization boundary: every protected API request
    // re-reads role and facility membership from Postgres through its guard.
    //
    // FACILITY_OPERATOR uses the operational Viewer.
    // FACILITY_ADMIN uses facility resident administration.
    // USER belongs in the mobile app.
    // ADMIN belongs in OPA platform administration, not facility operations.
    const role = result.user?.role;
    if (role !== 'FACILITY_OPERATOR' && role !== 'FACILITY_ADMIN') {
      return NextResponse.json(
        { ok: false, error: 'This account cannot use the facility Viewer.' },
        { status: 403 },
      );
    }

    await setOperatorSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });

    // No tokens in the body. The cookies are the session.
    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store, private',
          'Referrer-Policy': 'no-referrer',
        },
      },
    );
  } catch (error) {
    // Never log the credentials or the response body.
    console.error(
      'Operator login request failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return NextResponse.json(
      { ok: false, error: 'Sign-in is unavailable.' },
      { status: 503 },
    );
  }
}