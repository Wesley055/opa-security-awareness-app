import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Privacy headers for capability URLs.
 *
 * The API sets these on its own responses, but those protect the
 * server-to-server call. The browser-facing response needs them
 * independently - and the browser is the more important leak boundary,
 * because that is where a token could reach a third party through a Referer
 * header, a cache, or a search index.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/i/')) {
    // A shared cache must never hold one person's emergency.
    response.headers.set('Cache-Control', 'no-store, private');
    // Without this, following any outbound link from the page would hand the
    // token to a third party in the Referer header.
    response.headers.set('Referrer-Policy', 'no-referrer');
    // A link pasted into a public forum must not be indexed.
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  return response;
}

export const config = {
  matcher: ['/i/:path*'],
};
