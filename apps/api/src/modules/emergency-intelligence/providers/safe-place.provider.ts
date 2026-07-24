import { Injectable } from '@nestjs/common';
import type { DataConfidence } from '../data-confidence';

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
  twentyFourHours: boolean;
  phoneNumber?: string;
  provider: string;
}

@Injectable()
export class SafePlaceProvider {
  readonly providerName = 'MockSafePlaceProvider';
  readonly dataConfidence: DataConfidence = 'MOCK';

  async findNearbySafePlaces(
    latitude: number,
    longitude: number,
  ): Promise<SafePlace[]> {
    return [
      {
        id: 'safe-001',
        name: 'Area F Police Command',
        type: 'POLICE_STATION',
        address: 'Ikeja, Lagos',
        latitude,
        longitude: longitude - 0.014,
        distanceMeters: 2100,
        isVerified: true,
        twentyFourHours: true,
        phoneNumber: '+2348000002001',
        provider: this.providerName,
      },
      {
        id: 'safe-002',
        name: 'Genesis Specialist Hospital',
        type: 'HOSPITAL',
        address: 'Allen Avenue, Ikeja',
        latitude: latitude + 0.006,
        longitude: longitude + 0.002,
        distanceMeters: 950,
        isVerified: true,
        twentyFourHours: true,
        phoneNumber: '+2348000001002',
        provider: this.providerName,
      },
      {
        id: 'safe-003',
        name: 'Ikeja City Mall',
        type: 'SHOPPING_CENTER',
        address: 'Obafemi Awolowo Way, Ikeja',
        latitude: latitude - 0.004,
        longitude: longitude + 0.009,
        distanceMeters: 1400,
        isVerified: true,
        twentyFourHours: false,
        provider: this.providerName,
      },
    ];
  }
}