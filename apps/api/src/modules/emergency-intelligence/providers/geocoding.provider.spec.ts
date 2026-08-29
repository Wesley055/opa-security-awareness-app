import { ServiceUnavailableException } from '@nestjs/common';
import { GeocodingProvider } from './geocoding.provider';
import type { GoogleLocationClient } from '../google-location.client';

describe('GeocodingProvider', () => {
  function buildClient(
    configured: boolean,
    response?: unknown,
  ): GoogleLocationClient {
    return {
      isConfigured: jest.fn().mockReturnValue(configured),
      getJson: jest.fn().mockResolvedValue(response),
    } as unknown as GoogleLocationClient;
  }

  it('reports MOCK confidence when Google is not configured', () => {
    const provider = new GeocodingProvider(buildClient(false));

    expect(provider.dataConfidence).toBe('MOCK');
  });

  it('reports PRODUCTION confidence when Google is configured', () => {
    const provider = new GeocodingProvider(buildClient(true));

    expect(provider.dataConfidence).toBe('PRODUCTION');
  });

  it('refuses to geocode when Google is not configured', async () => {
    const provider = new GeocodingProvider(buildClient(false));

    await expect(
      provider.reverseGeocode(6.5244, 3.3792),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('normalizes a real Google geocoding response without inventing fields', async () => {
    const provider = new GeocodingProvider(
      buildClient(true, {
        status: 'OK',
        results: [
          {
            formatted_address:
              '1 Allen Avenue, Ikeja, Lagos, Nigeria',
            address_components: [
              {
                long_name: 'Allen Avenue',
                short_name: 'Allen Ave',
                types: ['route'],
              },
              {
                long_name: 'Ikeja',
                short_name: 'Ikeja',
                types: ['locality'],
              },
              {
                long_name: 'Lagos',
                short_name: 'LA',
                types: ['administrative_area_level_1'],
              },
              {
                long_name: 'Nigeria',
                short_name: 'NG',
                types: ['country'],
              },
              {
                long_name: '100281',
                short_name: '100281',
                types: ['postal_code'],
              },
            ],
          },
        ],
      }),
    );

    const result = await provider.reverseGeocode(
      6.5244,
      3.3792,
    );

    expect(result).toEqual({
      latitude: 6.5244,
      longitude: 3.3792,
      formattedAddress:
        '1 Allen Avenue, Ikeja, Lagos, Nigeria',
      street: 'Allen Avenue',
      crossStreet: undefined,
      landmark: undefined,
      community: undefined,
      city: 'Ikeja',
      state: 'Lagos',
      country: 'Nigeria',
      postalCode: '100281',
      provider: 'GoogleGeocodingProvider',
    });
  });

  it('rejects non-OK Google application status', async () => {
    const provider = new GeocodingProvider(
      buildClient(true, {
        status: 'REQUEST_DENIED',
        results: [],
      }),
    );

    await expect(
      provider.reverseGeocode(6.5244, 3.3792),
    ).rejects.toThrow(
      'Google geocoding returned status REQUEST_DENIED.',
    );
  });

  it('rejects an OK response with no result', async () => {
    const provider = new GeocodingProvider(
      buildClient(true, {
        status: 'OK',
        results: [],
      }),
    );

    await expect(
      provider.reverseGeocode(6.5244, 3.3792),
    ).rejects.toThrow(
      'Google geocoding returned no location result.',
    );
  });
});
