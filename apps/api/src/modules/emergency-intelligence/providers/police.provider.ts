import { Injectable } from '@nestjs/common';

export interface PoliceStation {
  id: string;
  name: string;
  address: string;
  phoneNumber?: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  twentyFourHours: boolean;
  emergencyResponse: boolean;
  provider: string;
}

@Injectable()
export class PoliceProvider {
  readonly providerName = 'MockPoliceProvider';

  async findNearbyPoliceStations(
    latitude: number,
    longitude: number,
  ): Promise<PoliceStation[]> {
    return [
      {
        id: 'police-001',
        name: 'Area F Police Command',
        address: 'Ikeja, Lagos',
        phoneNumber: '+2348000002001',
        latitude,
        longitude: longitude - 0.014,
        distanceMeters: 2100,
        twentyFourHours: true,
        emergencyResponse: true,
        provider: this.providerName,
      },
      {
        id: 'police-002',
        name: 'Ikeja Divisional Police Headquarters',
        address: 'Oba Akran Avenue, Ikeja',
        phoneNumber: '+2348000002002',
        latitude: latitude + 0.004,
        longitude: longitude + 0.003,
        distanceMeters: 780,
        twentyFourHours: true,
        emergencyResponse: true,
        provider: this.providerName,
      },
    ];
  }
}