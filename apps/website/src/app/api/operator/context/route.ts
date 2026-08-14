import { NextResponse } from 'next/server';
import { getOperatorContext } from '@/lib/operator-context';

/**
 * Same-origin context bridge. 14A-5.
 *
 * NOTHING CALLS THIS YET. The shell imports getOperatorContext directly -
 * a server component reaching its own Next server over HTTP would have to
 * forward the browser's cookies by hand for no benefit. This exists for
 * 14A-6, whose queue polling will need context without a navigation, and
 * it is written now for the same reason the refresh route's POST was:
 * discovering during the queue build that the only path is server-side
 * would be the expensive moment to find out.
 *
 * THE BODY IS NARROWER THAN /users/me. No email, no phone number, no token,
 * no API hostname. The console needs a name and a facility; everything else
 * would be identity data shipped to a browser that has no use for it.
 *
 * STATUS CONTRACT, mirroring the refresh bridge:
 *   200  operator with an assigned facility
 *   401  the access token was refused - rotate via /api/operator/refresh
 *   409  authenticated, but this account has no facility to operate
 *   503  the API was unreachable or unusable - temporary, change nothing
 *
 * NO 403. Whether an account may read a particular facility is the API's
 * answer, given per request by FacilityOperatorGuard. This bridge does not
 * pre-empt it; a 403 invented here would be a second authorization opinion.
 */

export const dynamic = 'force-dynamic';

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET() {
  const result = await getOperatorContext();

  if (result.state === 'READY') {
    const { context } = result;

    return noStore(
      NextResponse.json({
        ok: true,
        operator: {
          firstName: context.firstName,
          lastName: context.lastName,
          role: context.role,
        },
        facility: context.facility,
      }),
    );
  }

  if (result.state === 'NO_FACILITY') {
    return noStore(
      NextResponse.json(
        { ok: false, error: 'This account has no facility assigned.' },
        { status: 409 },
      ),
    );
  }

  if (result.state === 'REJECTED') {
    return noStore(
      NextResponse.json(
        { ok: false, error: 'Your session ended.' },
        { status: 401 },
      ),
    );
  }

  return noStore(
    NextResponse.json(
      { ok: false, error: 'Facility context is temporarily unavailable.' },
      { status: 503 },
    ),
  );
}