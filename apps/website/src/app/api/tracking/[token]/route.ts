import { NextResponse } from 'next/server';
import { fetchTracking } from '@/lib/tracking';

/**
 * Same-origin polling endpoint for the tracking page.
 *
 * The browser calls opasafety.com, never the API host directly. That keeps
 * CORS configuration off the emergency path, keeps the API hostname out of
 * client code, and gives one controlled place to enforce no-store.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await fetchTracking(token);

  const status =
    result.state === 'NOT_FOUND'
      ? 404
      : result.state === 'EXPIRED' || result.state === 'REVOKED'
        ? 410
        : result.state === 'UNAVAILABLE'
          ? 503
          : 200;

  return NextResponse.json(result, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}
