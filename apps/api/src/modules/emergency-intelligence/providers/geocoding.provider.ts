import { Injectable } from '@nestjs/common';
import type { DataConfidence } from '../data-confidence';

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

@Injectable()
export class GeocodingProvider {
  readonly providerName = 'MockGeocodingProvider';
  readonly dataConfidence: DataConfidence = 'MOCK';

  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<GeocodingResult> {
    return {
      latitude,
      longitude,
      formattedAddress: '12 Allen Avenue, Ikeja, Lagos',
      street: 'Allen Avenue',
      crossStreet: 'Allen Avenue & Opebi Road',
      landmark: 'Allen Junction',
      community: 'Ikeja',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postalCode: '100271',
      provider: this.providerName,
    };
  }
}