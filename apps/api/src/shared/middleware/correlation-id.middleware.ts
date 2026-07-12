import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

export type CorrelatedRequest = Request & {
  correlationId?: string;
};

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    request: CorrelatedRequest,
    response: Response,
    next: NextFunction,
  ): void {
    const incomingCorrelationId =
      request.header(CORRELATION_ID_HEADER)?.trim();

    const correlationId =
      incomingCorrelationId || randomUUID();

    request.correlationId = correlationId;

    response.setHeader(
      CORRELATION_ID_HEADER,
      correlationId,
    );

    next();
  }
}