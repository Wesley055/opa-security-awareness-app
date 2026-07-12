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
          path: request.originalUrl,
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