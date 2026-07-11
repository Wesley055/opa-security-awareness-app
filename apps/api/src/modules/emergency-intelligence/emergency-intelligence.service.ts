import { Injectable } from '@nestjs/common';
import type { LocationRequestDto } from './dto/location-request.dto';
import { DeviceProvider } from './providers/device.provider';
import { GeocodingProvider } from './providers/geocoding.provider';
import { HospitalProvider } from './providers/hospital.provider';
import { PlacesProvider } from './providers/places.provider';
import { PoliceProvider } from './providers/police.provider';
import { RoutingProvider } from './providers/routing.provider';
import { SafePlaceProvider } from './providers/safe-place.provider';

@Injectable()
export class EmergencyIntelligenceService {
  constructor(
    private readonly geocodingProvider: GeocodingProvider,
    private readonly placesProvider: PlacesProvider,
    private readonly hospitalProvider: HospitalProvider,
    private readonly policeProvider: PoliceProvider,
    private readonly safePlaceProvider: SafePlaceProvider,
    private readonly deviceProvider: DeviceProvider,
    private readonly routingProvider: RoutingProvider,
  ) {}

  async buildLocationIntelligence(dto: LocationRequestDto) {
    const [
      geocoding,
      nearbyPlaces,
      hospitals,
      policeStations,
      safePlaces,
      routes,
    ] = await Promise.all([
      this.geocodingProvider.reverseGeocode(
        dto.latitude,
        dto.longitude,
      ),
      this.placesProvider.findNearbyPlaces(
        dto.latitude,
        dto.longitude,
      ),
      this.hospitalProvider.findNearbyHospitals(
        dto.latitude,
        dto.longitude,
      ),
      this.policeProvider.findNearbyPoliceStations(
        dto.latitude,
        dto.longitude,
      ),
      this.safePlaceProvider.findNearbySafePlaces(
        dto.latitude,
        dto.longitude,
      ),
      this.routingProvider.buildSafeRoutes(),
    ]);

    const device = this.deviceProvider.buildDeviceIntelligence({
      batteryLevel: dto.batteryLevel,
      isCharging: dto.isCharging,
      networkType: dto.networkType,
      language: dto.language,
      speed: dto.speed,
      heading: dto.heading,
      altitude: dto.altitude,
      accuracy: dto.accuracy,
      timestamp: dto.timestamp,
    });

    return {
      generatedAt: new Date().toISOString(),

      location: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        address: geocoding.formattedAddress,
        street: geocoding.street,
        crossStreet: geocoding.crossStreet,
        landmark: geocoding.landmark,
        community: geocoding.community,
        city: geocoding.city,
        state: geocoding.state,
        country: geocoding.country,
        postalCode: geocoding.postalCode,
        provider: geocoding.provider,
      },

      movement: {
        speed: dto.speed,
        heading: dto.heading,
        altitude: dto.altitude,
      },

      surroundings: {
        places: nearbyPlaces,
        byDirection:
          this.placesProvider.groupByDirection(nearbyPlaces),
      },

      emergencyResources: {
        nearestHospital: hospitals[0] ?? null,
        hospitals,
        nearestPoliceStation: policeStations[0] ?? null,
        policeStations,
        nearestSafePlace: safePlaces[0] ?? null,
        safePlaces,
      },

      routes,

      device,
    };
  }
}