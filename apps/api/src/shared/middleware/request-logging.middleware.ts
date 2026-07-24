import {
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import type {
  NextFunction,
  Response,
} from 'express';
import type { CorrelatedRequest } from './correlation-id.middleware';

/**
 * URL segments that are credentials, not identifiers.
 *
 * A tracking token in `/public/tracking/<token>` grants live access to
 * someone's emergency. Logging the raw path would turn application logs into
 * a list of working links: anyone with log access - Azure diagnostics, a
 * support tool, an exported log file - would hold real capability tokens.
 *
 * Each entry redacts everything after the given prefix.
 */
const SENSITIVE_PATH_PREFIXES = ['/public/tracking/'];

const REDACTED = '<redacted>';

/**
 * Replace credential-bearing path segments before anything is written out.
 * Query strings are dropped entirely for these routes rather than parsed,
 * since a token could appear there too.
 */
export function redactSensitivePath(originalUrl: string): string {
  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    if (originalUrl.startsWith(prefix)) {
      return `${prefix}${REDACTED}`;
    }
  }
  return originalUrl;
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(
    request: CorrelatedRequest,
    response: Response,
    next: NextFunction,
  ): void {
    const startedAt = Date.now();

    response.on('finish', () => {
      const durationMs = Date.now() - startedAt;

      this.logger.log(
        JSON.stringify({
          event: 'http_request',
          correlationId: request.correlationId,
          method: request.method,
          path: redactSensitivePath(request.originalUrl),
          statusCode: response.statusCode,
          durationMs,
          userAgent: request.get('user-agent'),
          ip: request.ip,
          timestamp: new Date().toISOString(),
        }),
      );
    });

    next();
  }
}
