import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

export const GOOGLE_LOCATION_REQUEST_TIMEOUT_MS = 5_000;

@Injectable()
export class GoogleLocationClient {
  private readonly apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async getJson<T>(
    baseUrl: string,
    params: Record<string, string>,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'Google location provider is not configured.',
      );
    }

    const url = new URL(baseUrl);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    url.searchParams.set('key', this.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GOOGLE_LOCATION_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Google location provider returned HTTP ${response.status}.`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'Google location provider request failed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async postJson<T>(
    baseUrl: string,
    body: unknown,
    fieldMask: string,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'Google location provider is not configured.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GOOGLE_LOCATION_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Google location provider returned HTTP ${response.status}.`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'Google location provider request failed.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
