import { Injectable } from '@nestjs/common';
import type { DataConfidence } from '../data-confidence';
import { GoogleLocationClient } from '../google-location.client';
import {
  bearingDegreesBetween,
  buildNearbySearchBody,
  distanceMetersBetween,
  GOOGLE_NEARBY_FIELD_MASK,
  GOOGLE_NEARBY_SEARCH_URL,
  type GoogleNearbyPlace,
  type GoogleNearbySearchResponse,
  hasUsableGooglePlaceLocation,
} from '../google-places';

export type CardinalDirection =
  | 'NORTH'
  | 'SOUTH'
  | 'EAST'
  | 'WEST'
  | 'NORTH_EAST'
  | 'NORTH_WEST'
  | 'SOUTH_EAST'
  | 'SOUTH_WEST';

export interface NearbyPlace {
  id: string;
  name: string;
  category:
    | 'HOSPITAL'
    | 'POLICE'
    | 'FIRE_STATION'
    | 'PHARMACY'
    | 'LANDMARK'
    | 'SAFE_PLACE'
    | 'FUEL_STATION'
    | 'SHOPPING_CENTER'
    | 'OTHER';
  latitude: number;
  longitude: number;
  distanceMeters: number;
  direction: CardinalDirection;
  address?: string;
  phoneNumber?: string;

  /**
   * True only when OPA has independently verified the place.
   * A record existing in Google Places does not establish emergency
   * capability, operating status, or responder suitability.
   */
  isVerified: boolean;

  provider: string;
}

const INCLUDED_PLACE_TYPES = [
  'hospital',
  'police',
  'fire_station',
  'pharmacy',
  'gas_station',
  'shopping_mall',
  'tourist_attraction',
];

@Injectable()
export class PlacesProvider {
  readonly providerName = 'GooglePlacesProvider';

  constructor(
    private readonly googleLocationClient: GoogleLocationClient,
  ) {}

  get dataConfidence(): DataConfidence {
    return this.googleLocationClient.isConfigured()
      ? 'PRODUCTION'
      : 'MOCK';
  }

  async findNearbyPlaces(
    latitude: number,
    longitude: number,
  ): Promise<NearbyPlace[]> {
    const response =
      await this.googleLocationClient.postJson<GoogleNearbySearchResponse>(
        GOOGLE_NEARBY_SEARCH_URL,
        buildNearbySearchBody(
          latitude,
          longitude,
          INCLUDED_PLACE_TYPES,
        ),
        GOOGLE_NEARBY_FIELD_MASK,
      );

    return (response.places ?? [])
      .filter(hasUsableGooglePlaceLocation)
      .map((place) =>
        this.toNearbyPlace(place, latitude, longitude),
      )
      .sort(
        (left, right) =>
          left.distanceMeters - right.distanceMeters,
      );
  }

  groupByDirection(
    places: NearbyPlace[],
  ): Record<CardinalDirection, NearbyPlace[]> {
    return {
      NORTH: places.filter(
        (place) => place.direction === 'NORTH',
      ),
      SOUTH: places.filter(
        (place) => place.direction === 'SOUTH',
      ),
      EAST: places.filter(
        (place) => place.direction === 'EAST',
      ),
      WEST: places.filter(
        (place) => place.direction === 'WEST',
      ),
      NORTH_EAST: places.filter(
        (place) => place.direction === 'NORTH_EAST',
      ),
      NORTH_WEST: places.filter(
        (place) => place.direction === 'NORTH_WEST',
      ),
      SOUTH_EAST: places.filter(
        (place) => place.direction === 'SOUTH_EAST',
      ),
      SOUTH_WEST: places.filter(
        (place) => place.direction === 'SOUTH_WEST',
      ),
    };
  }

  private toNearbyPlace(
    place: GoogleNearbyPlace & {
      id: string;
      displayName: { text: string };
      location: {
        latitude: number;
        longitude: number;
      };
    },
    sourceLatitude: number,
    sourceLongitude: number,
  ): NearbyPlace {
    const result: NearbyPlace = {
      id: place.id,
      name: place.displayName.text,
      category: this.categoryFor(place),
      latitude: place.location.latitude,
      longitude: place.location.longitude,
      distanceMeters: distanceMetersBetween(
        sourceLatitude,
        sourceLongitude,
        place.location.latitude,
        place.location.longitude,
      ),
      direction: this.directionFor(
        sourceLatitude,
        sourceLongitude,
        place.location.latitude,
        place.location.longitude,
      ),
      isVerified: false,
      provider: this.providerName,
    };

    if (place.formattedAddress) {
      result.address = place.formattedAddress;
    }

    if (place.nationalPhoneNumber) {
      result.phoneNumber = place.nationalPhoneNumber;
    }

    return result;
  }

  private categoryFor(
    place: GoogleNearbyPlace,
  ): NearbyPlace['category'] {
    const types = new Set([
      ...(place.types ?? []),
      ...(place.primaryType ? [place.primaryType] : []),
    ]);

    if (types.has('hospital')) {
      return 'HOSPITAL';
    }

    if (types.has('police')) {
      return 'POLICE';
    }

    if (types.has('fire_station')) {
      return 'FIRE_STATION';
    }

    if (types.has('pharmacy')) {
      return 'PHARMACY';
    }

    if (types.has('gas_station')) {
      return 'FUEL_STATION';
    }

    if (types.has('shopping_mall')) {
      return 'SHOPPING_CENTER';
    }

    if (types.has('tourist_attraction')) {
      return 'LANDMARK';
    }

    return 'OTHER';
  }

  private directionFor(
    sourceLatitude: number,
    sourceLongitude: number,
    targetLatitude: number,
    targetLongitude: number,
  ): CardinalDirection {
    const bearing = bearingDegreesBetween(
      sourceLatitude,
      sourceLongitude,
      targetLatitude,
      targetLongitude,
    );

    if (bearing >= 337.5 || bearing < 22.5) {
      return 'NORTH';
    }

    if (bearing < 67.5) {
      return 'NORTH_EAST';
    }

    if (bearing < 112.5) {
      return 'EAST';
    }

    if (bearing < 157.5) {
      return 'SOUTH_EAST';
    }

    if (bearing < 202.5) {
      return 'SOUTH';
    }

    if (bearing < 247.5) {
      return 'SOUTH_WEST';
    }

    if (bearing < 292.5) {
      return 'WEST';
    }

    return 'NORTH_WEST';
  }
}
