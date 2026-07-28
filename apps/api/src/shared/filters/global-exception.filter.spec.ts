import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { GlobalExceptionFilter } from './global-exception.filter';

// A realistic ADR-008 tracking token: 128-bit, hex.
const TOKEN = '9f2c41a7b3084e6d95c1af07e2b46d38';
const TRACKING_PATH = `/public/tracking/${TOKEN}`;
const REDACTED_PATH = '/public/tracking/<redacted>';

interface Captured {
  statusCode: number | null;
  body: Record<string, unknown> | null;
}

// The filter is registered with useGlobalFilters in main.ts, not as an
// APP_FILTER provider, so a Test.createTestingModule harness would never
// exercise it and would pass with the filter absent. It is instantiated
// directly here against a mocked ArgumentsHost instead.
function createHost(originalUrl: string): {
  host: ArgumentsHost;
  captured: Captured;
} {
  const captured: Captured = { statusCode: null, body: null };

  const response = {
    status(code: number) {
      captured.statusCode = code;
      return response;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return response;
    },
  };

  const request = {
    originalUrl,
    method: 'GET',
    correlationId: 'test-correlation-id',
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, captured };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function loggedPayload(): Record<string, unknown> {
    const call = errorSpy.mock.calls[0];
    if (call === undefined) {
      throw new Error('logger.error was not called');
    }
    const first = call[0];
    if (typeof first !== 'string') {
      throw new Error('logger.error payload was not a string');
    }
    return JSON.parse(first) as Record<string, unknown>;
  }

  function responseBody(captured: Captured): Record<string, unknown> {
    const body = captured.body;
    if (body === null) {
      throw new Error('no response body was written');
    }
    return body;
  }

  it('redacts the tracking token from the logged path', () => {
    const { host } = createHost(TRACKING_PATH);

    filter.catch(new Error('boom'), host);

    expect(loggedPayload().path).toBe(REDACTED_PATH);
  });

  it('redacts the tracking token from the response body path', () => {
    const { host, captured } = createHost(TRACKING_PATH);

    filter.catch(new Error('boom'), host);

    expect(responseBody(captured).path).toBe(REDACTED_PATH);
  });

  // The vector that actually fires. Nest throws this itself for any
  // unmatched sub-path, from @nestjs/core routes-resolver.js:
  //   throw new NotFoundException(`Cannot ${method} ${url}`)
  // The URL rides in the message, and therefore in Error.stack, which
  // redacting the structured path alone would not touch.
  it('redacts the token from an unmatched-route 404 message and stack', () => {
    const url = `${TRACKING_PATH}/extra`;
    const { host, captured } = createHost(url);

    filter.catch(new NotFoundException(`Cannot GET ${url}`), host);

    expect(loggedPayload().message).toBe(`Cannot GET ${REDACTED_PATH}/extra`);
    expect(responseBody(captured).message).toBe(
      `Cannot GET ${REDACTED_PATH}/extra`,
    );

    const call = errorSpy.mock.calls[0];
    if (call === undefined) {
      throw new Error('logger.error was not called');
    }
    const stack = call[1];
    if (typeof stack !== 'string') {
      throw new Error('no stack was logged');
    }
    expect(stack).not.toContain(TOKEN);
  });

  // ValidationPipe returns an array of messages, and forbidNonWhitelisted
  // is enabled, so this shape is routine rather than exotic.
  it('redacts every entry of an array message', () => {
    const { host } = createHost('/incidents');

    filter.catch(
      new HttpException(
        { message: [`bad link ${TRACKING_PATH}`, 'unrelated'], statusCode: 400 },
        400,
      ),
      host,
    );

    expect(loggedPayload().message).toEqual([
      `bad link ${REDACTED_PATH}`,
      'unrelated',
    ]);
  });

  // Control case. Without it, a helper that redacted everything would pass
  // every assertion above. See trap #11.
  it('leaves paths and messages carrying no token untouched', () => {
    const { host, captured } = createHost('/incidents/abc-123');

    filter.catch(
      new NotFoundException('Cannot GET /incidents/abc-123'),
      host,
    );

    expect(loggedPayload().path).toBe('/incidents/abc-123');
    expect(responseBody(captured).message).toBe(
      'Cannot GET /incidents/abc-123',
    );
  });

  it('does not double-redact text that is already redacted', () => {
    const { host } = createHost('/incidents');

    filter.catch(new NotFoundException(`Cannot GET ${REDACTED_PATH}`), host);

    expect(loggedPayload().message).toBe(`Cannot GET ${REDACTED_PATH}`);
  });
});
