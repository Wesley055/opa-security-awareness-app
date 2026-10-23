import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DataConfidence } from '../data-confidence';
import { GoogleLocationClient } from '../google-location.client';

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  street?: string;
  crossStreet?: string;
  landmark?: string;
  community?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  provider: string;
}

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeocodeResult {
  formatted_address: string;
  address_components: GoogleAddressComponent[];
}

interface GoogleGeocodeResponse {
  status: string;
  results: GoogleGeocodeResult[];
  error_message?: string;
}

const GOOGLE_GEOCODING_URL =
  'https://maps.googleapis.com/maps/api/geocode/json';

@Injectable()
export class GeocodingProvider {
  readonly providerName = 'GoogleGeocodingProvider';

  constructor(
    private readonly googleLocationClient: GoogleLocationClient,
  ) {}

  get dataConfidence(): DataConfidence {
    return this.googleLocationClient.isConfigured()
      ? 'PRODUCTION'
      : 'MOCK';
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<GeocodingResult> {
    if (!this.googleLocationClient.isConfigured()) {
      throw new ServiceUnavailableException(
        'Google geocoding provider is not configured.',
      );
    }

    const response =
      await this.googleLocationClient.getJson<GoogleGeocodeResponse>(
        GOOGLE_GEOCODING_URL,
        {
          latlng: `${latitude},${longitude}`,
          language: 'en',
        },
      );

    if (response.status !== 'OK') {
      throw new ServiceUnavailableException(
        `Google geocoding returned status ${response.status}.`,
      );
    }

    const result = response.results[0];

    if (!result) {
      throw new ServiceUnavailableException(
        'Google geocoding returned no location result.',
      );
    }

    const component = (...types: string[]): string | undefined => {
      for (const type of types) {
        const match = result.address_components.find((candidate) =>
          candidate.types.includes(type),
        );

        if (match?.long_name) {
          return match.long_name;
        }
      }

      return undefined;
    };

    return {
      latitude,
      longitude,
      formattedAddress: result.formatted_address,

      // Route is the closest trustworthy street-level component.
      street: component('route'),

      // Google reverse geocoding does not directly establish a trustworthy
      // road intersection for this fix. Never synthesize one from strings.
      crossStreet: undefined,

      // Likewise, do not label a nearby feature as a landmark solely from
      // reverse-geocoding components. Places intelligence handles landmarks.
      landmark: undefined,

      community: component(
        'neighborhood',
        'sublocality_level_1',
        'sublocality',
      ),

      city: component(
        'locality',
        'postal_town',
        'administrative_area_level_2',
      ),

      state: component('administrative_area_level_1'),
      country: component('country'),
      postalCode: component('postal_code'),
      provider: this.providerName,
    };
  }
}
