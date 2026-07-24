import { Module } from '@nestjs/common';
import { EmergencyIntelligenceController } from './emergency-intelligence.controller';
import { EmergencyIntelligenceService } from './emergency-intelligence.service';
import { DeviceProvider } from './providers/device.provider';
import { GeocodingProvider } from './providers/geocoding.provider';
import { HospitalProvider } from './providers/hospital.provider';
import { PlacesProvider } from './providers/places.provider';
import { PoliceProvider } from './providers/police.provider';
import { RoutingProvider } from './providers/routing.provider';
import { SafePlaceProvider } from './providers/safe-place.provider';
import { ProviderConfidenceValidator } from './provider-confidence.validator';

@Module({
  controllers: [EmergencyIntelligenceController],
  providers: [
    EmergencyIntelligenceService,
    GeocodingProvider,
    PlacesProvider,
    HospitalProvider,
    PoliceProvider,
    SafePlaceProvider,
    DeviceProvider,
    RoutingProvider,
    ProviderConfidenceValidator,
  ],
  exports: [EmergencyIntelligenceService],
})
export class EmergencyIntelligenceModule {}