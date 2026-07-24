import { Injectable } from '@nestjs/common';
import type { DataConfidence } from '../data-confidence';

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
  isVerified: boolean;
  provider: string;
}

@Injectable()
export class PlacesProvider {
  readonly providerName = 'MockPlacesProvider';
  readonly dataConfidence: DataConfidence = 'MOCK';

  async findNearbyPlaces(
    latitude: number,
    longitude: number,
  ): Promise<NearbyPlace[]> {
    return [
      {
        id: 'place-001',
        name: 'Lagos State University Teaching Hospital',
        category: 'HOSPITAL',
        latitude: latitude + 0.018,
        longitude,
        distanceMeters: 2800,
        direction: 'NORTH',
        address: 'Ikeja, Lagos',
        phoneNumber: '+2348000000001',
        isVerified: true,
        provider: this.providerName,
      },
      {
        id: 'place-002',
        name: 'Area F Police Command',
        category: 'POLICE',
        latitude,
        longitude: longitude - 0.014,
        distanceMeters: 2100,
        direction: 'WEST',
        address: 'Ikeja, Lagos',
        phoneNumber: '+2348000000002',
        isVerified: true,
        provider: this.providerName,
      },
      {
        id: 'place-003',
        name: 'Allen Junction',
        category: 'LANDMARK',
        latitude: latitude - 0.003,
        longitude,
        distanceMeters: 300,
        direction: 'SOUTH',
        address: 'Allen Avenue, Ikeja',
        isVerified: true,
        provider: this.providerName,
      },
      {
        id: 'place-004',
        name: '24-Hour Pharmacy',
        category: 'PHARMACY',
        latitude,
        longitude: longitude + 0.006,
        distanceMeters: 650,
        direction: 'EAST',
        address: 'Opebi Road, Ikeja',
        phoneNumber: '+2348000000003',
        isVerified: true,
        provider: this.providerName,
      },
    ];
  }

  groupByDirection(
    places: NearbyPlace[],
  ): Record<CardinalDirection, NearbyPlace[]> {
    return {
      NORTH: places.filter((place) => place.direction === 'NORTH'),
      SOUTH: places.filter((place) => place.direction === 'SOUTH'),
      EAST: places.filter((place) => place.direction === 'EAST'),
      WEST: places.filter((place) => place.direction === 'WEST'),
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
}