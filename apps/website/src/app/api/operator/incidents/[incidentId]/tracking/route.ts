import { NextResponse } from 'next/server';
import { fetchOperatorTracking } from '@/lib/operator-tracking';

/**
 * Same-origin live-tracking bridge. 14A-8b.
 *
 * The browser talks only to this route. The upstream access token remains in
 * the httpOnly operator session and never enters client JavaScript.
 *
 * STATUS CONTRACT matches incident detail and timeline:
 *   200  validated tracking snapshot
 *   401  token refused - refresh once, then retry
 *   403  authenticated but not permitted - stop polling
 *   404  no such incident - stop polling
 *   503  upstream unavailable/unusable - preserve last known tracking state
 */
export const dynamic = 'force-dynamic';

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  const { incidentId } = await params;
  const result = await fetchOperatorTracking(incidentId);

  if (result.state === 'READY') {
    return noStore(
      NextResponse.json({
        ok: true,
        tracking: result.tracking,
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
      NextResponse.json(
        { ok: false, error: result.message },
        { status: 403 },
      ),
    );
  }

  if (result.state === 'NOT_FOUND') {
    return noStore(
      NextResponse.json(
        { ok: false, error: 'Incident not found.' },
        { status: 404 },
      ),
    );
  }

  return noStore(
    NextResponse.json(
      { ok: false, error: 'Live tracking is temporarily unavailable.' },
      { status: 503 },
    ),
  );
}
