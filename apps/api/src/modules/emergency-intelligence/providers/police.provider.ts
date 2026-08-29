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

export interface PoliceStation {
  id: string;
  name: string;
  address: string;
  phoneNumber?: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;

  /**
   * A Google police-place record does not establish staffing hours
   * or emergency-dispatch capability.
   */
  twentyFourHours: boolean | null;
  emergencyResponse: boolean | null;

  provider: string;
}

@Injectable()
export class PoliceProvider {
  readonly providerName = 'GooglePoliceProvider';

  constructor(
    private readonly googleLocationClient: GoogleLocationClient,
  ) {}

  get dataConfidence(): DataConfidence {
    return this.googleLocationClient.isConfigured()
      ? 'PRODUCTION'
      : 'MOCK';
  }

  async findNearbyPoliceStations(
    latitude: number,
    longitude: number,
  ): Promise<PoliceStation[]> {
    const response =
      await this.googleLocationClient.postJson<GoogleNearbySearchResponse>(
        GOOGLE_NEARBY_SEARCH_URL,
        buildNearbySearchBody(latitude, longitude, ['police']),
        GOOGLE_NEARBY_FIELD_MASK,
      );

    return (response.places ?? [])
      .filter(hasUsableGooglePlaceLocation)
      .map((place) => {
        const station: PoliceStation = {
          id: place.id,
          name: place.displayName.text,
          address: place.formattedAddress ?? '',
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          distanceMeters: distanceMetersBetween(
            latitude,
            longitude,
            place.location.latitude,
            place.location.longitude,
          ),
          twentyFourHours: null,
          emergencyResponse: null,
          provider: this.providerName,
        };

        if (place.nationalPhoneNumber) {
          station.phoneNumber = place.nationalPhoneNumber;
        }

        return station;
      })
      .sort(
        (left, right) =>
          left.distanceMeters - right.distanceMeters,
      );
  }
}
