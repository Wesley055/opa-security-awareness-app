import type { GoogleLocationClient } from '../google-location.client';
import { PoliceProvider } from './police.provider';

describe('PoliceProvider', () => {
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
    const provider = new PoliceProvider(buildClient(false));

    expect(provider.dataConfidence).toBe('MOCK');
  });

  it('remains MOCK when Google is configured pending Nigeria production validation', () => {
    const provider = new PoliceProvider(buildClient(true));

    expect(provider.dataConfidence).toBe('MOCK');
  });

  it('normalizes police stations and leaves operational capabilities unknown', async () => {
    const provider = new PoliceProvider(
      buildClient(true, {
        places: [
          {
            id: 'police-1',
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
        ],
      }),
    );

    const result =
      await provider.findNearbyPoliceStations(
        6.4411,
        3.5355,
      );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'police-1',
      name: 'Lekki Police Station',
      address: 'Lekki, Lagos, Nigeria',
      phoneNumber: '0702 000 0000',
      latitude: 6.445,
      longitude: 3.534,
      twentyFourHours: null,
      emergencyResponse: null,
      provider: 'GooglePoliceProvider',
    });

    expect(result[0]?.distanceMeters).toBeGreaterThan(0);
  });

  it('sorts police stations by OPA-computed distance', async () => {
    const provider = new PoliceProvider(
      buildClient(true, {
        places: [
          {
            id: 'farther',
            displayName: { text: 'Farther Station' },
            location: {
              latitude: 6.4511,
              longitude: 3.5355,
            },
          },
          {
            id: 'nearer',
            displayName: { text: 'Nearer Station' },
            location: {
              latitude: 6.4421,
              longitude: 3.5355,
            },
          },
        ],
      }),
    );

    const result =
      await provider.findNearbyPoliceStations(
        6.4411,
        3.5355,
      );

    expect(result.map((station) => station.id)).toEqual([
      'nearer',
      'farther',
    ]);
  });
});
