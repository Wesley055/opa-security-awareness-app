import { NextResponse } from 'next/server';
import { resendResidentInvitation } from '@/lib/facility-admin-residents';

export const dynamic = 'force-dynamic';

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const result = await resendResidentInvitation(userId);

  if (result.state === 'READY') {
    return noStore(NextResponse.json({ ok: true, delivery: result.data.delivery }));
  }

  const status =
    result.state === 'REJECTED' ? 401 :
    result.state === 'FORBIDDEN' ? 403 :
    result.state === 'NOT_FOUND' ? 404 :
    result.state === 'CONFLICT' ? 409 :
    result.state === 'INVALID' ? 400 : 503;

  const error =
    'message' in result && result.message
      ? result.message
      : result.state === 'REJECTED'
        ? 'Your session ended.'
        : 'Invitation resend is temporarily unavailable.';

  return noStore(NextResponse.json({ ok: false, error }, { status }));
}
