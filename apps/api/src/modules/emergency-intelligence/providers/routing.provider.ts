import { Injectable } from '@nestjs/common';

export interface RouteOption {
  id: string;
  destinationName: string;
  destinationType:
    | 'HOSPITAL'
    | 'POLICE_STATION'
    | 'SAFE_PLACE'
    | 'FIRE_STATION'
    | 'OTHER';
  distanceMeters: number;
  estimatedDurationSeconds: number;
  travelMode: 'WALKING' | 'DRIVING';
  summary: string;
  provider: string;
}

@Injectable()
export class RoutingProvider {
  readonly providerName = 'MockRoutingProvider';

  async buildSafeRoutes(): Promise<RouteOption[]> {
    return [
      {
        id: 'route-001',
        destinationName: 'Genesis Specialist Hospital',
        destinationType: 'HOSPITAL',
        distanceMeters: 950,
        estimatedDurationSeconds: 240,
        travelMode: 'DRIVING',
        summary: 'Proceed toward Allen Avenue and continue to the hospital.',
        provider: this.providerName,
      },
      {
        id: 'route-002',
        destinationName: 'Ikeja Divisional Police Headquarters',
        destinationType: 'POLICE_STATION',
        distanceMeters: 780,
        estimatedDurationSeconds: 180,
        travelMode: 'DRIVING',
        summary: 'Proceed toward Oba Akran Avenue and continue to the police station.',
        provider: this.providerName,
      },
      {
        id: 'route-003',
        destinationName: 'Area F Police Command',
        destinationType: 'SAFE_PLACE',
        distanceMeters: 2100,
        estimatedDurationSeconds: 420,
        travelMode: 'DRIVING',
        summary: 'Continue west toward the verified police command.',
        provider: this.providerName,
      },
    ];
  }
}