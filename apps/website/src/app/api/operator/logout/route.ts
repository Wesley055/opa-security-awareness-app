import { NextResponse } from 'next/server';
import { clearOperatorSession } from '@/lib/operator-session';

/**
 * Clears the operator session cookies.
 *
 * LOCAL ONLY. The API has no token revocation endpoint, so the access token
 * remains technically valid until it expires - at most 15 minutes - and the
 * refresh token until it is used or expires. Deleting the cookies means the
 * browser can no longer present either, which is the whole of what a
 * browser-side logout can honestly promise.
 *
 * Real revocation would need the API to maintain a denylist or a token
 * version per user. Worth knowing before anyone describes this as
 * "signing out everywhere".
 */

export const dynamic = 'force-dynamic';

/**
 * REDIRECTS, IT DOES NOT RETURN JSON. The sign-out control is a plain HTML
 * form in the console shell, and a form NAVIGATES to whatever the POST
 * returns - so a JSON body left the operator staring at {"ok":true} with no
 * way back. 303 is the correct status for POST -> GET.
 *
 * That also keeps sign-out working with no client JavaScript, which is the
 * reason it is a form rather than a fetch.
 */
export async function POST(request: Request) {
  await clearOperatorSession();

  const response = NextResponse.redirect(
    new URL('/operator/login', request.url),
    { status: 303 },
  );

  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');

  return response;
}