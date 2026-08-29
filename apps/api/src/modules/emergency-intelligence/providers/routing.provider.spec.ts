import type { GoogleLocationClient } from '../google-location.client';
import {
  RoutingProvider,
  type BuildSafeRoutesInput,
} from './routing.provider';

describe('RoutingProvider', () => {
  const INPUT: BuildSafeRoutesInput = {
    origin: {
      latitude: 6.4411,
      longitude: 3.5355,
    },
    destinations: [
      {
        id: 'hospital-1',
        name: 'Southern Gem Hospital',
        type: 'HOSPITAL',
        latitude: 6.4392875,
        longitude: 3.5377534,
      },
      {
        id: 'police-1',
        name: 'Lekki Police Station',
        type: 'POLICE_STATION',
        latitude: 6.445,
        longitude: 3.534,
      },
    ],
  };

  function buildClient(
    configured: boolean,
    implementation?: (
      baseUrl: string,
      body: unknown,
      fieldMask: string,
    ) => Promise<unknown>,
  ): GoogleLocationClient {
    return {
      isConfigured: jest.fn().mockReturnValue(configured),
      postJson: jest.fn(
        implementation ??
          (async () => ({
            routes: [
              {
                distanceMeters: 1000,
                duration: '300s',
                description: 'Test Road',
                routeLabels: ['DEFAULT_ROUTE'],
              },
            ],
          })),
      ),
    } as unknown as GoogleLocationClient;
  }

  it('reports MOCK confidence when Google is not configured', () => {
    const provider = new RoutingProvider(
      buildClient(false),
    );

    expect(provider.dataConfidence).toBe('MOCK');
  });

  it('reports PRODUCTION confidence when Google is configured', () => {
    const provider = new RoutingProvider(
      buildClient(true),
    );

    expect(provider.dataConfidence).toBe('PRODUCTION');
  });

  it('calls Google Routes API with origin and destination coordinates', async () => {
    const client = buildClient(true);

    const provider = new RoutingProvider(client);

    await provider.buildSafeRoutes({
      origin: INPUT.origin,
      destinations: [INPUT.destinations[0]!],
    });

    expect(client.postJson).toHaveBeenCalledTimes(1);

    expect(client.postJson).toHaveBeenCalledWith(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      expect.objectContaining({
        origin: {
          location: {
            latLng: {
              latitude: 6.4411,
              longitude: 3.5355,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: 6.4392875,
              longitude: 3.5377534,
            },
          },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: false,
        languageCode: 'en',
        units: 'METRIC',
      }),
      expect.stringContaining('routes.distanceMeters'),
    );
  });

  it('normalizes route distance, duration and summary', async () => {
    const provider = new RoutingProvider(
      buildClient(
        true,
        async () => ({
          routes: [
            {
              distanceMeters: 1224,
              duration: '295s',
              description: 'Sule Olusesi Rd',
              routeLabels: ['DEFAULT_ROUTE'],
            },
          ],
        }),
      ),
    );

    const result = await provider.buildSafeRoutes({
      origin: INPUT.origin,
      destinations: [INPUT.destinations[0]!],
    });

    expect(result).toEqual([
      {
        id: 'route-hospital-1',
        destinationName: 'Southern Gem Hospital',
        destinationType: 'HOSPITAL',
        distanceMeters: 1224,
        estimatedDurationSeconds: 295,
        travelMode: 'DRIVING',
        summary: 'Sule Olusesi Rd',
        provider: 'GoogleRoutingProvider',
      },
    ]);
  });

  it('deduplicates destinations by id before making Google calls', async () => {
    const client = buildClient(true);

    const provider = new RoutingProvider(client);

    await provider.buildSafeRoutes({
      origin: INPUT.origin,
      destinations: [
        INPUT.destinations[0]!,
        INPUT.destinations[0]!,
      ],
    });

    expect(client.postJson).toHaveBeenCalledTimes(1);
  });

  it('isolates failure of one destination and keeps successful routes', async () => {
    const client = buildClient(
      true,
      async (_url, body) => {
        const typedBody = body as {
          destination: {
            location: {
              latLng: {
                latitude: number;
              };
            };
          };
        };

        if (
          typedBody.destination.location.latLng.latitude ===
          6.4392875
        ) {
          throw new Error('route failure');
        }

        return {
          routes: [
            {
              distanceMeters: 700,
              duration: '180s',
              description: 'Police Route',
            },
          ],
        };
      },
    );

    const provider = new RoutingProvider(client);

    const result = await provider.buildSafeRoutes(INPUT);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        destinationName: 'Lekki Police Station',
        destinationType: 'POLICE_STATION',
        estimatedDurationSeconds: 180,
      }),
    );
  });

  it('reports routing unavailable when all returned routes are malformed', async () => {
    const provider = new RoutingProvider(
      buildClient(
        true,
        async () => ({
          routes: [
            {
              distanceMeters: 500,
              duration: 'not-a-duration',
            },
          ],
        }),
      ),
    );

    await expect(
      provider.buildSafeRoutes({
        origin: INPUT.origin,
        destinations: [INPUT.destinations[0]!],
      }),
    ).rejects.toThrow(
      'Google routing returned no usable routes for available destinations.',
    );
  });

  it('sorts routes by travel duration', async () => {
    const client = buildClient(
      true,
      async (_url, body) => {
        const typedBody = body as {
          destination: {
            location: {
              latLng: {
                latitude: number;
              };
            };
          };
        };

        const hospital =
          typedBody.destination.location.latLng.latitude ===
          6.4392875;

        return {
          routes: [
            {
              distanceMeters: hospital ? 1200 : 800,
              duration: hospital ? '300s' : '180s',
              description: hospital
                ? 'Hospital Route'
                : 'Police Route',
            },
          ],
        };
      },
    );

    const provider = new RoutingProvider(client);

    const result = await provider.buildSafeRoutes(INPUT);

    expect(
      result.map((route) => route.destinationType),
    ).toEqual([
      'POLICE_STATION',
      'HOSPITAL',
    ]);
  });
});
