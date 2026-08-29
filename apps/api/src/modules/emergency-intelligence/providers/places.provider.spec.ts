import type { GoogleLocationClient } from '../google-location.client';
import { PlacesProvider } from './places.provider';

describe('PlacesProvider', () => {
  function buildClient(
    configured: boolean,
    response?: unknown,
  ): GoogleLocationClient {
    return {
      isConfigured: jest.fn().mockReturnValue(configured),
      postJson: jest.fn().mockResolvedValue(response),
    } as unknown as GoogleLocationClient;
  }

  it('reports MOCK confidence when Google is not configured', () => {
    const provider = new PlacesProvider(buildClient(false));

    expect(provider.dataConfidence).toBe('MOCK');
  });

  it('reports PRODUCTION confidence when Google is configured', () => {
    const provider = new PlacesProvider(buildClient(true));

    expect(provider.dataConfidence).toBe('PRODUCTION');
  });

  it('normalizes Google places, computes distance and direction, and does not claim verification', async () => {
    const client = buildClient(true, {
      places: [
        {
          id: 'hospital-1',
          types: ['hospital', 'health'],
          primaryType: 'hospital',
          displayName: {
            text: 'Southern Gem Hospital',
          },
          formattedAddress: 'Lekki, Lagos, Nigeria',
          nationalPhoneNumber: '0701 000 0000',
          location: {
            latitude: 6.4392875,
            longitude: 3.5377534,
          },
        },
      ],
    });

    const provider = new PlacesProvider(client);

    const result = await provider.findNearbyPlaces(
      6.4411,
      3.5355,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'hospital-1',
      name: 'Southern Gem Hospital',
      category: 'HOSPITAL',
      latitude: 6.4392875,
      longitude: 3.5377534,
      address: 'Lekki, Lagos, Nigeria',
      phoneNumber: '0701 000 0000',
      isVerified: false,
      provider: 'GooglePlacesProvider',
    });

    expect(result[0]?.distanceMeters).toBeGreaterThan(0);
    expect(result[0]?.direction).toBe('SOUTH_EAST');
  });

  it('filters malformed places without usable identity or coordinates', async () => {
    const provider = new PlacesProvider(
      buildClient(true, {
        places: [
          {
            id: 'missing-location',
            displayName: { text: 'No Location' },
          },
          {
            id: 'valid',
            displayName: { text: 'Valid Place' },
            location: {
              latitude: 6.44,
              longitude: 3.53,
            },
          },
        ],
      }),
    );

    const result = await provider.findNearbyPlaces(
      6.4411,
      3.5355,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('valid');
  });

  it('sorts places using OPA-computed distance', async () => {
    const provider = new PlacesProvider(
      buildClient(true, {
        places: [
          {
            id: 'farther',
            displayName: { text: 'Farther Place' },
            location: {
              latitude: 6.4511,
              longitude: 3.5355,
            },
          },
          {
            id: 'nearer',
            displayName: { text: 'Nearer Place' },
            location: {
              latitude: 6.4421,
              longitude: 3.5355,
            },
          },
        ],
      }),
    );

    const result = await provider.findNearbyPlaces(
      6.4411,
      3.5355,
    );

    expect(result.map((place) => place.id)).toEqual([
      'nearer',
      'farther',
    ]);
  });
});
