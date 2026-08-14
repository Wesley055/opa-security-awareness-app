import { NextResponse } from 'next/server';
import {
  apiUrl,
  clearOperatorSession,
  getRefreshToken,
  setOperatorSession,
} from '@/lib/operator-session';

/**
 * Token rotation for the operator console. 14A-3.
 *
 * The access token lives 15 minutes. Before this route existed, an operator
 * watching a queue for a shift was silently signed out four times an hour,
 * and every time it looked like a failure before it was recognised as an
 * expiry. This is the whole reason the route exists.
 *
 * TWO ENTRY POINTS, ONE ROTATION.
 *
 *   GET   the invisible page flow. A server component cannot write cookies,
 *         so /operator redirects here, this rotates and sets them, and the
 *         operator lands back on /operator having seen one extra hop.
 *   POST  for 14A-6 queue polling, which will need to recover from a 401
 *         without a full navigation. Nothing calls it yet. It is written now
 *         because discovering during the queue build that the only recovery
 *         path is server-side would be the expensive time to find out.
 *
 * THE SUCCESS TARGET IS HARDCODED /operator. No returnTo or next parameter:
 * a caller-supplied redirect target needs open-redirect validation, and
 * there are exactly two operator pages today. Add it when a deep link
 * actually needs preserving, with a real allowlist, not before.
 *
 * A REJECTION AND AN OUTAGE ARE NOT THE SAME EVENT.
 *
 *   401 from the API is AUTHORITATIVE. rotate() re-reads the user row and
 *   refuses unless the account exists, is isActive, and is ACTIVE. So a 401
 *   means expired, suspended, or never activated - the session is genuinely
 *   over and BOTH cookies are cleared.
 *
 *   A network failure or a 5xx says nothing about the credential. Clearing
 *   on those would destroy a valid 30-day refresh token because the API
 *   restarted. The cookies are PRESERVED and the operator is told it is
 *   temporary.
 *
 * NO ROLE CHECK HERE, AND THAT IS DELIBERATE. POST /auth/refresh returns
 * { accessToken, refreshToken } and no user object, so there is no role to
 * check without decoding the token - which would mean trusting a claim the
 * three API guards all deliberately ignore. The role gate on login is UX,
 * not authorization: the API re-reads role from the database on every
 * guarded request and that is what decides. The cost is that an operator
 * demoted mid-session keeps the console shell until their refresh token
 * expires, seeing 403s from every call. Revisit if /auth/refresh ever
 * returns a user.
 *
 * NO SINGLE-FLIGHT LOCK, AND THIS DEPENDS ON A BACKEND PROPERTY. rotate()
 * performs no writes and nothing persists refresh-token state - there is no
 * RefreshToken model in the schema, and IncidentAccessToken's revokedAt is
 * for tracking links, not these. So a refresh token is not consumed by use
 * and two concurrent rotations both succeed with both results valid.
 * IF SERVER-SIDE REVOCATION IS EVER ADDED, THIS BECOMES A RACE and the
 * polling path in 14A-6 needs a single-flight guard.
 */

export const dynamic = 'force-dynamic';

type RotateOutcome = 'rotated' | 'rejected' | 'unavailable';

async function rotateSession(): Promise<RotateOutcome> {
  const base = apiUrl();

  if (!base) {
    console.error('OPA_API_URL is not configured.');
    return 'unavailable';
  }

  const refreshToken = await getRefreshToken();

  if (!refreshToken) {
    return 'rejected';
  }

  let response: Response;

  try {
    response = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    // Never log the token.
    console.error(
      'Operator token refresh could not reach the API:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return 'unavailable';
  }

  // The one authoritative rejection. Everything else is an outage.
  if (response.status === 401) {
    return 'rejected';
  }

  if (!response.ok) {
    console.error(`Operator token refresh returned ${response.status}.`);
    return 'unavailable';
  }

  let result: { accessToken?: string; refreshToken?: string };

  try {
    result = (await response.json()) as typeof result;
  } catch {
    console.error('Operator token refresh returned unreadable JSON.');
    return 'unavailable';
  }

  if (!result.accessToken || !result.refreshToken) {
    console.error('Operator token refresh returned no tokens.');
    return 'unavailable';
  }

  await setOperatorSession({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });

  return 'rotated';
}

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

/**
 * THE LOOP BREAKER IS THE LOGIN PAGE, NOT A MARKER HERE.
 *
 * Every failure path lands on /operator/login WITH a reason parameter, and
 * that page does not attempt rotation when a reason is present. So an outage
 * cannot bounce login -> refresh -> login. A rejection cannot either, since
 * both cookies are gone by then.
 *
 * ONE FAILURE MODE IS DELIBERATELY LEFT UNGUARDED: rotation succeeds but the
 * access cookie does not persist (scheme, path, clock skew), so /operator
 * sees no access cookie and comes straight back. That loops. A short-lived
 * marker cookie was written and REMOVED, because it manufactured the failure
 * it was meant to catch - two concurrent refreshes, which 14A-6 polling will
 * produce routinely, would have had the second read the first's marker and
 * be thrown to login. The unguarded version fails as
 * ERR_TOO_MANY_REDIRECTS: loud, immediate, and impossible to misread. If you
 * are seeing that, the cookie is not sticking; do not add a marker, find out
 * why it is not sticking.
 */
export async function GET(request: Request) {
  // No refresh cookie means there is nothing to rotate. Straight to login,
  // never back to /operator - that is what would loop.
  if (!(await getRefreshToken())) {
    return noStore(
      NextResponse.redirect(new URL('/operator/login', request.url)),
    );
  }

  const outcome = await rotateSession();

  if (outcome === 'rotated') {
    return noStore(NextResponse.redirect(new URL('/operator', request.url)));
  }

  if (outcome === 'rejected') {
    await clearOperatorSession();
    return noStore(
      NextResponse.redirect(
        new URL('/operator/login?reason=session-ended', request.url),
      ),
    );
  }

  // Outage. The cookies are left exactly as they are.
  return noStore(
    NextResponse.redirect(
      new URL('/operator/login?reason=unavailable', request.url),
    ),
  );
}

/**
 * For 14A-6 polling. Same rotation, same cookie rules, no redirects - the
 * caller decides what to do with the answer.
 *
 *   200  rotated, cookies replaced, retry the failed request once
 *   401  authoritatively rejected, cookies cleared, send the operator to login
 *   503  upstream unavailable, cookies untouched, back off and try again
 */
export async function POST() {
  const outcome = await rotateSession();

  if (outcome === 'rotated') {
    return noStore(NextResponse.json({ ok: true }));
  }

  if (outcome === 'rejected') {
    await clearOperatorSession();
    return noStore(
      NextResponse.json(
        { ok: false, error: 'Your session ended.' },
        { status: 401 },
      ),
    );
  }

  return noStore(
    NextResponse.json(
      { ok: false, error: 'Sign-in is temporarily unavailable.' },
      { status: 503 },
    ),
  );
}