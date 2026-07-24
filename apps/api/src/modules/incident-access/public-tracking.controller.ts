import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicTrackingService } from './public-tracking.service';

/**
 * Public, unauthenticated tracking endpoint.
 *
 * The token in the path IS the credential. Requests carry no session and no
 * JWT: a family member receives this link by SMS during an emergency and must
 * be able to open it immediately, without an account.
 *
 * Consumed SERVER-SIDE by the Next.js tracking page, not by browsers
 * directly, so no CORS configuration sits on the emergency path.
 *
 * Note the request logger redacts this route's path - see
 * shared/middleware/request-logging.middleware.ts. Without that, every
 * request would write a working capability token into the application logs.
 */
@Controller('public/tracking')
export class PublicTrackingController {
  constructor(private readonly tracking: PublicTrackingService) {}

  @Get(':token')
  // Never cached: an emergency snapshot must not be served stale, and a
  // shared cache must never hold one person's incident.
  @Header('Cache-Control', 'no-store, private')
  // Without this, following any outbound link from the tracking page would
  // leak the token to a third party in the Referer header.
  @Header('Referrer-Policy', 'no-referrer')
  // A tracking link pasted into a public forum must not be indexed.
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  async getTracking(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.tracking.getSnapshot(token);

    switch (result.state) {
      case 'NOT_FOUND':
        // Generic 404: reveals nothing about whether the incident ever
        // existed.
        response.status(404);
        break;

      case 'EXPIRED':
      case 'REVOKED':
        // 410 Gone: this capability existed and no longer does. The body
        // still distinguishes the two, because a family member needs to know
        // whether the incident may still be active.
        response.status(410);
        break;

      case 'VALID':
      case 'INCIDENT_CLOSED':
        response.status(200);
        break;
    }

    return result;
  }
}
