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

export interface Hospital {
  id: string;
  name: string;
  address: string;
  phoneNumber?: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;

  /**
   * Google place classification does not prove these capabilities.
   * null means OPA does not currently have verified evidence.
   */
  emergencyAvailable: boolean | null;
  traumaCenter: boolean | null;
  twentyFourHours: boolean | null;

  provider: string;
}

@Injectable()
export class HospitalProvider {
  readonly providerName = 'GoogleHospitalProvider';

  constructor(
    private readonly googleLocationClient: GoogleLocationClient,
  ) {}

  /**
   * Intentionally pinned to MOCK pending Nigeria production validation.
   * Do not expose hospital/police intelligence to responders until the
   * underlying source quality and operational suitability are verified.
   */
  readonly dataConfidence: DataConfidence = 'MOCK';

  async findNearbyHospitals(
    latitude: number,
    longitude: number,
  ): Promise<Hospital[]> {
    const response =
      await this.googleLocationClient.postJson<GoogleNearbySearchResponse>(
        GOOGLE_NEARBY_SEARCH_URL,
        buildNearbySearchBody(latitude, longitude, ['hospital']),
        GOOGLE_NEARBY_FIELD_MASK,
      );

    return (response.places ?? [])
      .filter(hasUsableGooglePlaceLocation)
      .map((place) => {
        const hospital: Hospital = {
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
          emergencyAvailable: null,
          traumaCenter: null,
          twentyFourHours: null,
          provider: this.providerName,
        };

        if (place.nationalPhoneNumber) {
          hospital.phoneNumber = place.nationalPhoneNumber;
        }

        return hospital;
      })
      .sort(
        (left, right) =>
          left.distanceMeters - right.distanceMeters,
      );
  }
}
