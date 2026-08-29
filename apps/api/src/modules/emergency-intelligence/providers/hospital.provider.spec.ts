import type { GoogleLocationClient } from '../google-location.client';
import { HospitalProvider } from './hospital.provider';

describe('HospitalProvider', () => {
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
    const provider = new HospitalProvider(buildClient(false));

    expect(provider.dataConfidence).toBe('MOCK');
  });

  it('reports PRODUCTION confidence when Google is configured', () => {
    const provider = new HospitalProvider(buildClient(true));

    expect(provider.dataConfidence).toBe('PRODUCTION');
  });

  it('normalizes hospitals and leaves unverified capabilities unknown', async () => {
    const provider = new HospitalProvider(
      buildClient(true, {
        places: [
          {
            id: 'hospital-1',
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
      }),
    );

    const result = await provider.findNearbyHospitals(
      6.4411,
      3.5355,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'hospital-1',
      name: 'Southern Gem Hospital',
      address: 'Lekki, Lagos, Nigeria',
      phoneNumber: '0701 000 0000',
      latitude: 6.4392875,
      longitude: 3.5377534,
      emergencyAvailable: null,
      traumaCenter: null,
      twentyFourHours: null,
      provider: 'GoogleHospitalProvider',
    });

    expect(result[0]?.distanceMeters).toBeGreaterThan(0);
  });

  it('sorts hospitals by OPA-computed distance', async () => {
    const provider = new HospitalProvider(
      buildClient(true, {
        places: [
          {
            id: 'farther',
            displayName: { text: 'Farther Hospital' },
            location: {
              latitude: 6.4511,
              longitude: 3.5355,
            },
          },
          {
            id: 'nearer',
            displayName: { text: 'Nearer Hospital' },
            location: {
              latitude: 6.4421,
              longitude: 3.5355,
            },
          },
        ],
      }),
    );

    const result = await provider.findNearbyHospitals(
      6.4411,
      3.5355,
    );

    expect(result.map((hospital) => hospital.id)).toEqual([
      'nearer',
      'farther',
    ]);
  });
});
