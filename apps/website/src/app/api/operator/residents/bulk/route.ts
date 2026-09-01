import { NextResponse } from 'next/server';
import {
  createBulkFacilityAdminResidents,
  type CreateResidentInput,
} from '@/lib/facility-admin-residents';

export const dynamic = 'force-dynamic';

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function isResidentInput(value: unknown): value is CreateResidentInput {
  if (typeof value !== 'object' || value === null) return false;

  const row = value as Record<string, unknown>;

  return (
    typeof row.email === 'string' &&
    typeof row.phoneNumber === 'string' &&
    typeof row.firstName === 'string' &&
    typeof row.lastName === 'string'
  );
}

function residentInput(value: CreateResidentInput): CreateResidentInput {
  return {
    email: value.email,
    phoneNumber: value.phoneNumber,
    firstName: value.firstName,
    lastName: value.lastName,
  };
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return noStore(
      NextResponse.json(
        { ok: false, error: 'Request body must be valid JSON.' },
        { status: 400 },
      ),
    );
  }

  const residents =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).residents
      : undefined;

  if (
    !Array.isArray(residents) ||
    residents.length === 0 ||
    residents.length > 200 ||
    !residents.every(isResidentInput)
  ) {
    return noStore(
      NextResponse.json(
        { ok: false, error: 'Provide between 1 and 200 complete residents.' },
        { status: 400 },
      ),
    );
  }

  // Explicitly project the browser payload onto the supported resident fields.
  // facilityId is never accepted from the Viewer; the API guard derives it
  // from the authenticated FACILITY_ADMIN row.
  const result = await createBulkFacilityAdminResidents(
    residents.map(residentInput),
  );

  if (result.state === 'READY') {
    return noStore(NextResponse.json({ ok: true, result: result.data }));
  }

  const status =
    result.state === 'REJECTED'
      ? 401
      : result.state === 'FORBIDDEN'
        ? 403
        : result.state === 'NOT_FOUND'
          ? 404
          : result.state === 'CONFLICT'
            ? 409
            : result.state === 'INVALID'
              ? 400
              : 503;

  const error =
    'message' in result && result.message
      ? result.message
      : result.state === 'REJECTED'
        ? 'Your session ended.'
        : 'Resident administration is temporarily unavailable.';

  return noStore(NextResponse.json({ ok: false, error }, { status }));
}
