import { NextResponse } from 'next/server';
import { fetchTimelineVerification } from '@/lib/operator-timeline';

/**
 * Same-origin integrity-check bridge. 14A-9.
 *
 * CALLED ONLY WHEN THE TIMELINE HAS GROWN. sequence is monotonic and
 * unique per incident, so a change in the last sequence IS an append. The
 * client tracks that; this route just forwards.
 *
 * 503 MEANS "OPA DOES NOT KNOW", NOT "THE CHAIN IS BROKEN". The console
 * must never render a tampering warning because a request failed.
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
  const result = await fetchTimelineVerification(incidentId);

  if (result.state === 'READY') {
    return noStore(
      NextResponse.json({ ok: true, verification: result.verification }),
    );
  }

  return noStore(
    NextResponse.json(
      { ok: false, error: 'Integrity could not be checked.' },
      { status: 503 },
    ),
  );
}