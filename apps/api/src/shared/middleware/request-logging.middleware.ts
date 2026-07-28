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

/**
 * Redact tracking tokens that appear inside free text.
 *
 * Deliberately a sibling of redactSensitivePath rather than an extension of
 * it. That function takes a structured request path and truncates a known
 * prefix. This one takes arbitrary text - an exception message, a stack
 * trace - in which a tracking URL may appear anywhere, and more than once.
 * Callers stay explicit about which kind of input they hold; neither
 * function acquires overloaded semantics.
 *
 * The motivating case is Nest's own unmatched-route 404, thrown in
 * @nestjs/core routes-resolver.js as `Cannot ${method} ${url}`. It carries
 * the full URL in the exception message, and therefore in Error.stack too,
 * so redacting the structured path alone leaves the token in the log.
 *
 * The character class stops at anything that cannot be part of a token,
 * including '<'. That keeps the function idempotent: text already reading
 * '/public/tracking/<redacted>' is left untouched rather than growing a
 * second angle bracket.
 */
export function redactSensitiveTrackingUrls(value: string): string {
  return value.replace(
    /\/public\/tracking\/[^/?#\s<>)\]"']+/g,
    `/public/tracking/${REDACTED}`,
  );
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
