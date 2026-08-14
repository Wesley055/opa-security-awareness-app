import { NextResponse } from 'next/server';
import { fetchOperatorQueue } from '@/lib/operator-queue';

/**
 * Same-origin queue bridge. 14A-6.
 *
 * The client polls this every five seconds. It reads the httpOnly access
 * cookie server-side, calls the API, and returns a browser-safe body.
 *
 * IT ACCEPTS NO facilityId, and that is not an omission to be fixed later.
 * The API resolves the facility from the token. A facilityId parameter here
 * would be a value the browser could point anywhere - harmless in itself,
 * since the guard would refuse it, but it would mean the console asserts
 * membership rather than reading it.
 *
 * `cursor` IS accepted and forwarded verbatim. It is opaque, server-issued,
 * and the API validates it - a malformed one is a 400 from the service, not
 * a silent first page.
 *
 * STATUS CONTRACT, mirroring the refresh and context bridges:
 *   200  a page of the live queue, plus serverTime
 *   401  token refused - POST /api/operator/refresh, then retry once
 *   403  the account may not read this queue - STOP polling, do not retry
 *   503  upstream unreachable - keep the queue on screen and try later
 */

export const dynamic = 'force-dynamic';

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request: Request) {
  const cursor =
    new URL(request.url).searchParams.get('cursor') ?? undefined;

  const result = await fetchOperatorQueue({ cursor });

  if (result.state === 'READY') {
    return noStore(
      NextResponse.json({
        ok: true,
        incidents: result.incidents,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        serverTime: result.serverTime,
      }),
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

  if (result.state === 'FORBIDDEN') {
    return noStore(
      NextResponse.json({ ok: false, error: result.message }, { status: 403 }),
    );
  }

  return noStore(
    NextResponse.json(
      { ok: false, error: 'The queue is temporarily unavailable.' },
      { status: 503 },
    ),
  );
}