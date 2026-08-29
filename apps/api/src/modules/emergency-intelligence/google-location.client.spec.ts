import {
  ServiceUnavailableException,
} from '@nestjs/common';
import { GoogleLocationClient } from './google-location.client';

describe('GoogleLocationClient', () => {
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
    }

    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reports not configured when the API key is absent', () => {
    delete process.env.GOOGLE_MAPS_API_KEY;

    const client = new GoogleLocationClient();

    expect(client.isConfigured()).toBe(false);
  });

  it('refuses GET requests when the API key is absent', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;

    const client = new GoogleLocationClient();

    await expect(
      client.getJson('https://example.test/location', {
        latlng: '6.5244,3.3792',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('adds query parameters and API key to GET requests', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-secret-key';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ status: 'OK' }),
    }) as never;

    const client = new GoogleLocationClient();

    const result = await client.getJson<{ status: string }>(
      'https://example.test/location',
      {
        latlng: '6.5244,3.3792',
        language: 'en',
      },
    );

    expect(result).toEqual({ status: 'OK' });

    const fetchMock = global.fetch as jest.Mock;
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);

    expect(calledUrl).toContain('latlng=6.5244%2C3.3792');
    expect(calledUrl).toContain('language=en');
    expect(calledUrl).toContain('key=test-secret-key');
  });

  it('refuses POST requests when the API key is absent', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;

    const client = new GoogleLocationClient();

    await expect(
      client.postJson(
        'https://places.googleapis.com/v1/places:searchNearby',
        { includedTypes: ['hospital'] },
        'places.id',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends Places POST body, API key, and field mask in headers', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-secret-key';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        places: [{ id: 'place-1' }],
      }),
    }) as never;

    const client = new GoogleLocationClient();

    const body = {
      includedTypes: ['hospital'],
      maxResultCount: 5,
    };

    const result = await client.postJson<{
      places: Array<{ id: string }>;
    }>(
      'https://places.googleapis.com/v1/places:searchNearby',
      body,
      'places.id,places.displayName',
    );

    expect(result).toEqual({
      places: [{ id: 'place-1' }],
    });

    const fetchMock = global.fetch as jest.Mock;
    const [calledUrl, options] = fetchMock.mock.calls[0] ?? [];

    expect(calledUrl).toBe(
      'https://places.googleapis.com/v1/places:searchNearby',
    );

    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': 'test-secret-key',
        'X-Goog-FieldMask':
          'places.id,places.displayName',
      },
      body: JSON.stringify(body),
    });
  });

  it('fails closed on non-success GET HTTP responses', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-secret-key';

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
    }) as never;

    const client = new GoogleLocationClient();

    await expect(
      client.getJson('https://example.test/location', {}),
    ).rejects.toThrow(
      'Google location provider returned HTTP 429.',
    );
  });

  it('fails closed on non-success POST HTTP responses', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-secret-key';

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
    }) as never;

    const client = new GoogleLocationClient();

    await expect(
      client.postJson(
        'https://places.googleapis.com/v1/places:searchNearby',
        {},
        'places.id',
      ),
    ).rejects.toThrow(
      'Google location provider returned HTTP 400.',
    );
  });

  it('normalizes network failures', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-secret-key';

    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('socket failure')) as never;

    const client = new GoogleLocationClient();

    await expect(
      client.getJson('https://example.test/location', {}),
    ).rejects.toThrow(
      'Google location provider request failed.',
    );
  });
});
