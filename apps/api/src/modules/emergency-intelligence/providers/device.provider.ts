import { Injectable } from '@nestjs/common';

export interface DeviceIntelligence {
  batteryLevel?: number;
  isCharging?: boolean;
  networkType?: string;
  language?: string;
  speed?: number;
  heading?: number;
  altitude?: number;
  accuracy?: number;
  timestamp: string;
  isOffline: boolean;
  provider: string;
}

export interface DeviceIntelligenceInput {
  batteryLevel?: number;
  isCharging?: boolean;
  networkType?: string;
  language?: string;
  speed?: number;
  heading?: number;
  altitude?: number;
  accuracy?: number;
  timestamp?: string;
}

@Injectable()
export class DeviceProvider {
  readonly providerName = 'DeviceTelemetryProvider';

  buildDeviceIntelligence(
    input: DeviceIntelligenceInput,
  ): DeviceIntelligence {
    const networkType = input.networkType?.trim() || 'UNKNOWN';

    return {
      batteryLevel: input.batteryLevel,
      isCharging: input.isCharging,
      networkType,
      language: input.language?.trim() || 'en-NG',
      speed: input.speed,
      heading: input.heading,
      altitude: input.altitude,
      accuracy: input.accuracy,
      timestamp: input.timestamp ?? new Date().toISOString(),
      isOffline: networkType.toUpperCase() === 'OFFLINE',
      provider: this.providerName,
    };
  }
}