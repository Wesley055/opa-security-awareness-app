import { NextResponse } from 'next/server';
import { fetchIncidentDetail } from '@/lib/operator-incident';

/**
 * Same-origin incident detail bridge. 14A-7.
 *
 * Polled every five seconds by the detail page. Reads the httpOnly access
 * cookie server-side and returns a browser-safe body.
 *
 * THE INCIDENT ID COMES FROM THE ROUTE, and it is the only input. Whether
 * this caller may read it is the API's decision, made by IncidentAccessGuard
 * against a fresh database read on every request.
 *
 * STATUS CONTRACT, mirroring the other operator bridges:
 *   200  the incident, plus serverTime
 *   401  token refused - POST /api/operator/refresh, then retry once
 *   403  authenticated but not permitted - STOP polling
 *   404  no such incident - STOP polling
 *   503  upstream unreachable - keep what is on screen and try later
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
  const result = await fetchIncidentDetail(incidentId);

  if (result.state === 'READY') {
    return noStore(
      NextResponse.json({
        ok: true,
        incident: result.incident,
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
      { ok: false, error: 'This incident is temporarily unavailable.' },
      { status: 503 },
    ),
  );
}