import { Injectable } from '@nestjs/common';
import type { DataConfidence } from '../data-confidence';
import { GoogleLocationClient } from '../google-location.client';
import {
  buildNearbySearchBody,
  distanceMetersBetween,
  GOOGLE_NEARBY_FIELD_MASK,
  GOOGLE_NEARBY_SEARCH_URL,
  type GoogleNearbySearchResponse,
  hasUsableGooglePlaceLocation,
} from '../google-places';

export type SafePlaceType =
  | 'POLICE_STATION'
  | 'HOSPITAL'
  | 'FIRE_STATION'
  | 'EMBASSY'
  | 'COMMUNITY_CENTER'
  | 'SHOPPING_CENTER'
  | 'HOTEL'
  | 'OTHER';

export interface SafePlace {
  id: string;
  name: string;
  type: SafePlaceType;
  address: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  isVerified: boolean;
  twentyFourHours: boolean | null;
  phoneNumber?: string;
  provider: string;
}

const SAFE_PLACE_TYPES = [
  'police',
  'hospital',
  'fire_station',
  'shopping_mall',
];

function mapSafePlaceType(
  primaryType?: string,
  types: string[] = [],
): SafePlaceType {
  const allTypes = new Set([
    ...(primaryType ? [primaryType] : []),
    ...types,
  ]);

  if (allTypes.has('police')) {
    return 'POLICE_STATION';
  }

  if (allTypes.has('hospital')) {
    return 'HOSPITAL';
  }

  if (allTypes.has('fire_station')) {
    return 'FIRE_STATION';
  }

  if (allTypes.has('shopping_mall')) {
    return 'SHOPPING_CENTER';
  }

  return 'OTHER';
}

@Injectable()
export class SafePlaceProvider {
  readonly providerName = 'GoogleSafePlaceProvider';

  constructor(
    private readonly googleClient: GoogleLocationClient,
  ) {}

  get dataConfidence(): DataConfidence {
    return this.googleClient.isConfigured()
      ? 'PRODUCTION'
      : 'MOCK';
  }

  async findNearbySafePlaces(
    latitude: number,
    longitude: number,
  ): Promise<SafePlace[]> {
    const response =
      await this.googleClient.postJson<GoogleNearbySearchResponse>(
        GOOGLE_NEARBY_SEARCH_URL,
        buildNearbySearchBody(
          latitude,
          longitude,
          SAFE_PLACE_TYPES,
        ),
        GOOGLE_NEARBY_FIELD_MASK,
      );

    return (response.places ?? [])
      .filter(hasUsableGooglePlaceLocation)
      .map((place) => ({
        id: place.id,
        name: place.displayName.text,
        type: mapSafePlaceType(
          place.primaryType,
          place.types,
        ),
        address: place.formattedAddress ?? '',
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        distanceMeters: distanceMetersBetween(
          latitude,
          longitude,
          place.location.latitude,
          place.location.longitude,
        ),

        // Google listing presence does not prove that a location
        // is currently safe, staffed, open, or suitable for an
        // emergency response.
        isVerified: false,
        twentyFourHours: null,
        ...(place.nationalPhoneNumber
          ? { phoneNumber: place.nationalPhoneNumber }
          : {}),
        provider: this.providerName,
      }))
      .sort(
        (left, right) =>
          left.distanceMeters - right.distanceMeters,
      );
  }
}
