import { Injectable } from '@nestjs/common';

export interface Hospital {
  id: string;
  name: string;
  address: string;
  phoneNumber?: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  emergencyAvailable: boolean;
  traumaCenter: boolean;
  twentyFourHours: boolean;
  provider: string;
}

@Injectable()
export class HospitalProvider {
  readonly providerName = 'MockHospitalProvider';

  async findNearbyHospitals(
    latitude: number,
    longitude: number,
  ): Promise<Hospital[]> {
    return [
      {
        id: 'hospital-001',
        name: 'Lagos State University Teaching Hospital',
        address: 'Ikeja, Lagos',
        phoneNumber: '+2348000001001',
        latitude: latitude + 0.018,
        longitude,
        distanceMeters: 2800,
        emergencyAvailable: true,
        traumaCenter: true,
        twentyFourHours: true,
        provider: this.providerName,
      },
      {
        id: 'hospital-002',
        name: 'Genesis Specialist Hospital',
        address: 'Allen Avenue, Ikeja',
        phoneNumber: '+2348000001002',
        latitude: latitude + 0.006,
        longitude: longitude + 0.002,
        distanceMeters: 950,
        emergencyAvailable: true,
        traumaCenter: false,
        twentyFourHours: true,
        provider: this.providerName,
      },
    ];
  }
}