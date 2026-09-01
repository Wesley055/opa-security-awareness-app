import { NextResponse } from 'next/server';
import { createFacilityAdminResident } from '@/lib/facility-admin-residents';

export const dynamic = 'force-dynamic';

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function errorResponse(
  result:
    | { state: 'REJECTED' }
    | { state: 'FORBIDDEN'; message: string }
    | { state: 'CONFLICT'; message: string }
    | { state: 'INVALID'; message: string }
    | { state: 'NOT_FOUND'; message: string }
    | { state: 'UNAVAILABLE'; message?: string },
) {
  switch (result.state) {
    case 'REJECTED':
      return noStore(
        NextResponse.json({ ok: false, error: 'Your session ended.' }, { status: 401 }),
      );
    case 'FORBIDDEN':
      return noStore(NextResponse.json({ ok: false, error: result.message }, { status: 403 }));
    case 'NOT_FOUND':
      return noStore(NextResponse.json({ ok: false, error: result.message }, { status: 404 }));
    case 'CONFLICT':
      return noStore(NextResponse.json({ ok: false, error: result.message }, { status: 409 }));
    case 'INVALID':
      return noStore(NextResponse.json({ ok: false, error: result.message }, { status: 400 }));
    case 'UNAVAILABLE':
      return noStore(
        NextResponse.json(
          { ok: false, error: result.message ?? 'Resident administration is temporarily unavailable.' },
          { status: 503 },
        ),
      );
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return noStore(
      NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 }),
    );
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).email !== 'string' ||
    typeof (body as Record<string, unknown>).phoneNumber !== 'string' ||
    typeof (body as Record<string, unknown>).firstName !== 'string' ||
    typeof (body as Record<string, unknown>).lastName !== 'string'
  ) {
    return noStore(
      NextResponse.json({ ok: false, error: 'Resident information is incomplete.' }, { status: 400 }),
    );
  }

  const candidate = body as Record<string, unknown>;
  const result = await createFacilityAdminResident({
    email: candidate.email as string,
    phoneNumber: candidate.phoneNumber as string,
    firstName: candidate.firstName as string,
    lastName: candidate.lastName as string,
  });

  if (result.state === 'READY') {
    return noStore(NextResponse.json({ ok: true, resident: result.data }));
  }

  return errorResponse(result);
}
