import 'server-only';
import { cookies } from 'next/headers';

/**
 * Operator session, held entirely in httpOnly cookies.
 *
 * Marked `server-only` for the same reason lib/tracking.ts is: if this were
 * ever imported into a client component the API base URL would ship to the
 * browser and the operator's tokens would be handled client-side, which is
 * exactly what the same-origin bridge exists to prevent.
 *
 * An operator token is a stronger credential than a tracking link - it reads
 * a whole facility's live emergencies, with resident names and coordinates -
 * so it gets at least the same protection.
 */

const ACCESS_COOKIE = 'opa_operator_access';
const REFRESH_COOKIE = 'opa_operator_refresh';

/**
 * Matches the API's JWT_ACCESS_EXPIRES_IN default of 15m, so the browser
 * drops the cookie at the moment the token dies rather than sending a
 * corpse. When 14A-3 lands, the absence of this cookie alongside a present
 * refresh cookie is the signal to rotate.
 */
const ACCESS_MAX_AGE_SECONDS = 15 * 60;

/** Matches JWT_REFRESH_EXPIRES_IN default of 30d. */
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const API_URL = process.env.OPA_API_URL;

export type OperatorTokens = {
  accessToken: string;
  refreshToken: string;
};

export function apiUrl(): string | null {
  return API_URL ?? null;
}

/**
 * httpOnly is the whole point: client JavaScript cannot read these.
 *
 * sameSite strict because no cross-site flow needs them, and strict is the
 * strongest CSRF mitigation available without a token scheme.
 *
 * secure only in production so local http development still works. A
 * cookie marked secure is simply not sent over http, which would make the
 * dev server silently unauthenticated.
 */
export async function setOperatorSession(tokens: OperatorTokens) {
  const store = await cookies();
  const secure = process.env.NODE_ENV === 'production';

  store.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });

  store.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_MAX_AGE_SECONDS,
  });
}

export async function clearOperatorSession() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}

/**
 * Whether a request can even attempt an authenticated call.
 *
 * Deliberately NOT a claim that the session is valid - only the API can say
 * that, and this does not decode the token. A page uses this to decide
 * whether to redirect to login without paying for a network round trip; the
 * API's own answer is what actually decides.
 */
export async function hasOperatorSession(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

/**
 * Three-state session read, added for 14A-3.
 *
 * hasOperatorSession() is binary and cannot express the state the refresh
 * flow exists for: the access cookie has expired while the 30-day refresh
 * cookie is still present. It is left exactly as committed because it is
 * left exactly as committed. IT NOW HAS NO CALLERS - both operator pages
 * moved to getSessionState. Kept for 14A-4 to use or delete deliberately.
 *
 *   active       an authenticated call can be attempted right now
 *   refreshable  access is gone, rotation may recover the session
 *   none         nothing to work with, sign in
 *
 * As with hasOperatorSession, this is NOT a claim that anything is VALID.
 * Only the API can say that. This reports which cookies exist.
 */
export type OperatorSessionState = 'active' | 'refreshable' | 'none';

export async function getSessionState(): Promise<OperatorSessionState> {
  if (await getAccessToken()) {
    return 'active';
  }

  if (await getRefreshToken()) {
    return 'refreshable';
  }

  return 'none';
}