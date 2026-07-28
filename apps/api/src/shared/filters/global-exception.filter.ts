import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { CorrelatedRequest } from '../middleware/correlation-id.middleware';
import {
  redactSensitivePath,
  redactSensitiveTrackingUrls,
} from '../middleware/request-logging.middleware';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<CorrelatedRequest>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : null;

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : typeof exceptionResponse === 'object' &&
            exceptionResponse !== null &&
            'message' in exceptionResponse
          ? (exceptionResponse as { message: string | string[] }).message
          : status === HttpStatus.INTERNAL_SERVER_ERROR
            ? 'Internal server error'
            : 'Request failed';

    const errorName =
      exception instanceof Error
        ? exception.name
        : 'UnknownError';

    const safePath = redactSensitivePath(request.originalUrl);

    const safeMessage = Array.isArray(message)
      ? message.map((entry) => redactSensitiveTrackingUrls(entry))
      : redactSensitiveTrackingUrls(message);

    const safeStack =
      exception instanceof Error && exception.stack !== undefined
        ? redactSensitiveTrackingUrls(exception.stack)
        : undefined;

    this.logger.error(
      JSON.stringify({
        event: 'http_error',
        correlationId: request.correlationId,
        method: request.method,
        path: safePath,
        statusCode: status,
        errorName,
        message: safeMessage,
        timestamp: new Date().toISOString(),
      }),
      safeStack,
    );

    response.status(status).json({
      statusCode: status,
      message: safeMessage,
      path: safePath,
      correlationId: request.correlationId,
      timestamp: new Date().toISOString(),
    });
  }
}