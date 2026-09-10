import { NextResponse } from 'next/server';
import { fetchEnrollmentRequests } from '@/lib/facility-admin-residents';
export const dynamic = 'force-dynamic';
export async function GET() {
  const result = await fetchEnrollmentRequests();
  const status = result.state === 'READY' ? 200 : result.state === 'REJECTED' ? 401 : result.state === 'FORBIDDEN' ? 403 : 503;
  return NextResponse.json(result.state === 'READY' ? result.data : { error: 'Enrollment requests are unavailable.' }, { status, headers: { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' } });
}
