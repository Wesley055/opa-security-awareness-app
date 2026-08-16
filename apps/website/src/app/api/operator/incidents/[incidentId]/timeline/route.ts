import { NextResponse } from 'next/server';
import { fetchIncidentTimeline } from '@/lib/operator-timeline';

/**
 * Same-origin timeline bridge. 14A-9.
 *
 * A TRANSLATOR, NOT A DECISION-MAKER. It authenticates and forwards. It
 * does not decide when verification should run - the client owns that,
 * because the client is what knows the last sequence it has seen.
 *
 * STATUS CONTRACT, mirroring the other operator bridges:
 *   200  the projected events
 *   401  token refused - POST /api/operator/refresh, then retry once
 *   403  not permitted - stop polling
 *   404  no such incident - stop polling
 *   503  upstream unreachable - keep what is on screen
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
  const result = await fetchIncidentTimeline(incidentId);

  if (result.state === 'READY') {
    return noStore(NextResponse.json({ ok: true, events: result.events }));
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
      { ok: false, error: 'The timeline is temporarily unavailable.' },
      { status: 503 },
    ),
  );
}