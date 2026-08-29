import type { GoogleLocationClient } from '../google-location.client';
import { SafePlaceProvider } from './safe-place.provider';

describe('SafePlaceProvider', () => {
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
    const provider = new SafePlaceProvider(
      buildClient(false),
    );

    expect(provider.dataConfidence).toBe('MOCK');
  });

  it('reports PRODUCTION confidence when Google is configured', () => {
    const provider = new SafePlaceProvider(
      buildClient(true),
    );

    expect(provider.dataConfidence).toBe('PRODUCTION');
  });

  it('normalizes candidate safe places without claiming operational verification', async () => {
    const provider = new SafePlaceProvider(
      buildClient(true, {
        places: [
          {
            id: 'police-1',
            primaryType: 'police',
            types: ['police'],
            displayName: {
              text: 'Lekki Police Station',
            },
            formattedAddress: 'Lekki, Lagos, Nigeria',
            nationalPhoneNumber: '0702 000 0000',
            location: {
              latitude: 6.445,
              longitude: 3.534,
            },
          },
          {
            id: 'hospital-1',
            primaryType: 'hospital',
            types: ['hospital'],
            displayName: {
              text: 'Southern Gem Hospital',
            },
            formattedAddress: 'Lekki, Lagos, Nigeria',
            location: {
              latitude: 6.4392875,
              longitude: 3.5377534,
            },
          },
        ],
      }),
    );

    const result = await provider.findNearbySafePlaces(
      6.4411,
      3.5355,
    );

    expect(result).toHaveLength(2);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'police-1',
          name: 'Lekki Police Station',
          type: 'POLICE_STATION',
          isVerified: false,
          twentyFourHours: null,
          provider: 'GoogleSafePlaceProvider',
        }),
        expect.objectContaining({
          id: 'hospital-1',
          name: 'Southern Gem Hospital',
          type: 'HOSPITAL',
          isVerified: false,
          twentyFourHours: null,
          provider: 'GoogleSafePlaceProvider',
        }),
      ]),
    );
  });

  it('maps supported Google place categories', async () => {
    const provider = new SafePlaceProvider(
      buildClient(true, {
        places: [
          {
            id: 'fire-1',
            primaryType: 'fire_station',
            displayName: { text: 'Fire Station' },
            location: {
              latitude: 6.442,
              longitude: 3.536,
            },
          },
          {
            id: 'mall-1',
            primaryType: 'shopping_mall',
            displayName: { text: 'Shopping Centre' },
            location: {
              latitude: 6.443,
              longitude: 3.536,
            },
          },
        ],
      }),
    );

    const result = await provider.findNearbySafePlaces(
      6.4411,
      3.5355,
    );

    expect(
      result.find((place) => place.id === 'fire-1')?.type,
    ).toBe('FIRE_STATION');

    expect(
      result.find((place) => place.id === 'mall-1')?.type,
    ).toBe('SHOPPING_CENTER');
  });

  it('sorts candidate safe places by OPA-computed distance', async () => {
    const provider = new SafePlaceProvider(
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

    const result = await provider.findNearbySafePlaces(
      6.4411,
      3.5355,
    );

    expect(result.map((place) => place.id)).toEqual([
      'nearer',
      'farther',
    ]);
  });
});
