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

export async function POST() {
  await clearOperatorSession();

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store, private',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}