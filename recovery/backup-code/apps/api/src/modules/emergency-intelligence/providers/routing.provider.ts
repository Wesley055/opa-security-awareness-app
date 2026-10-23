import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DataConfidence } from '../data-confidence';
import { GoogleLocationClient } from '../google-location.client';

const GOOGLE_COMPUTE_ROUTES_URL =
  'https://routes.googleapis.com/directions/v2:computeRoutes';

const GOOGLE_ROUTES_FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.description',
  'routes.routeLabels',
].join(',');

export type RouteDestinationType =
  | 'HOSPITAL'
  | 'POLICE_STATION'
  | 'SAFE_PLACE'
  | 'FIRE_STATION'
  | 'OTHER';

export interface RoutingDestination {
  id: string;
  name: string;
  type: RouteDestinationType;
  latitude: number;
  longitude: number;
}

export interface BuildSafeRoutesInput {
  origin: {
    latitude: number;
    longitude: number;
  };
  destinations: RoutingDestination[];
}

export interface RouteOption {
  id: string;
  destinationName: string;
  destinationType: RouteDestinationType;
  distanceMeters: number;
  estimatedDurationSeconds: number;
  travelMode: 'WALKING' | 'DRIVING';
  summary: string;
  provider: string;
}

interface GoogleRoute {
  distanceMeters?: number;
  duration?: string;
  description?: string;
  routeLabels?: string[];
}

interface GoogleComputeRoutesResponse {
  routes?: GoogleRoute[];
}

function parseGoogleDurationSeconds(
  duration?: string,
): number | null {
  if (!duration) {
    return null;
  }

  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);

  if (!match?.[1]) {
    return null;
  }

  const seconds = Number(match[1]);

  return Number.isFinite(seconds)
    ? Math.round(seconds)
    : null;
}

@Injectable()
export class RoutingProvider {
  readonly providerName = 'GoogleRoutingProvider';

  constructor(
    private readonly googleLocationClient: GoogleLocationClient,
  ) {}

  get dataConfidence(): DataConfidence {
    return this.googleLocationClient.isConfigured()
      ? 'PRODUCTION'
      : 'MOCK';
  }

  async buildSafeRoutes(
    input: BuildSafeRoutesInput,
  ): Promise<RouteOption[]> {
    const uniqueDestinations = Array.from(
      new Map(
        input.destinations.map((destination) => [
          destination.id,
          destination,
        ]),
      ).values(),
    );

    const settled = await Promise.allSettled(
      uniqueDestinations.map(async (destination) => {
        const response =
          await this.googleLocationClient.postJson<GoogleComputeRoutesResponse>(
            GOOGLE_COMPUTE_ROUTES_URL,
            {
              origin: {
                location: {
                  latLng: {
                    latitude: input.origin.latitude,
                    longitude: input.origin.longitude,
                  },
                },
              },
              destination: {
                location: {
                  latLng: {
                    latitude: destination.latitude,
                    longitude: destination.longitude,
                  },
                },
              },
              travelMode: 'DRIVE',
              routingPreference: 'TRAFFIC_AWARE',
              computeAlternativeRoutes: false,
              languageCode: 'en',
              units: 'METRIC',
            },
            GOOGLE_ROUTES_FIELD_MASK,
          );

        const route = response.routes?.[0];

        if (
          !route ||
          typeof route.distanceMeters !== 'number' ||
          !Number.isFinite(route.distanceMeters)
        ) {
          return null;
        }

        const estimatedDurationSeconds =
          parseGoogleDurationSeconds(route.duration);

        if (estimatedDurationSeconds === null) {
          return null;
        }

        return {
          id: `route-${destination.id}`,
          destinationName: destination.name,
          destinationType: destination.type,
          distanceMeters: Math.round(route.distanceMeters),
          estimatedDurationSeconds,
          travelMode: 'DRIVING' as const,
          summary:
            route.description?.trim() ||
            `Route to ${destination.name}`,
          provider: this.providerName,
        };
      }),
    );

    const routes: RouteOption[] = [];

    for (const result of settled) {
      if (
        result.status === 'fulfilled' &&
        result.value !== null
      ) {
        routes.push(result.value);
      }
    }

    if (
      uniqueDestinations.length > 0 &&
      routes.length === 0
    ) {
      throw new ServiceUnavailableException(
        'Google routing returned no usable routes for available destinations.',
      );
    }

    return routes.sort(
      (left, right) =>
        left.estimatedDurationSeconds -
        right.estimatedDurationSeconds,
    );
  }
}
