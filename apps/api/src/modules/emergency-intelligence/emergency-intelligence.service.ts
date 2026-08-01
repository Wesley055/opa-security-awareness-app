import { Injectable, Logger } from '@nestjs/common';
import type { LocationRequestDto } from './dto/location-request.dto';
import { DeviceProvider } from './providers/device.provider';
import { GeocodingProvider } from './providers/geocoding.provider';
import { HospitalProvider } from './providers/hospital.provider';
import { PlacesProvider } from './providers/places.provider';
import { PoliceProvider } from './providers/police.provider';
import { RoutingProvider } from './providers/routing.provider';
import { SafePlaceProvider } from './providers/safe-place.provider';
import { isDisplayableToUsers } from './data-confidence';
import type { IntelligenceProvider } from './data-confidence';

/**
 * Omits any response section backed by a provider whose dataConfidence is
 * 'MOCK', rather than returning fabricated location intelligence.
 *
 * ADR-012: the boot-time ProviderConfidenceValidator now permits startup
 * with registered mock providers when OPA_BOOT_WITH_SUPPRESSED_MOCKS=true.
 * Production therefore DOES reach this branch with mocks in place. This is
 * no longer a local-development-only path.
 *
 * That makes this layer load-bearing rather than defense in depth: it is
 * what keeps fabricated data out of a real response now that the validator
 * has been deliberately relaxed. Its behaviour is pinned per provider by
 * emergency-intelligence.service.spec.ts. Do not remove it, and do not
 * change what it nulls without changing those tests deliberately.
 */
@Injectable()
export class EmergencyIntelligenceService {
  private readonly logger = new Logger(EmergencyIntelligenceService.name);

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
      this.geocodingProvider.reverseGeocode(dto.latitude, dto.longitude),
      this.placesProvider.findNearbyPlaces(dto.latitude, dto.longitude),
      this.hospitalProvider.findNearbyHospitals(dto.latitude, dto.longitude),
      this.policeProvider.findNearbyPoliceStations(dto.latitude, dto.longitude),
      this.safePlaceProvider.findNearbySafePlaces(dto.latitude, dto.longitude),
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

    const omitted: string[] = [];

    // isDisplayableToUsers, not isMockConfidence: this file decides what
    // reaches a response, which is the presentation question.
    //
    // The parameter type was { dataConfidence: string }, which discarded the
    // compile-time guarantee that a confidence value is a real
    // DataConfidence. Under that signature a misspelled confidence would
    // compile, return false here, and ship the data. IntelligenceProvider
    // restores the check.
    //
    // The name isMock and all six call sites below are unchanged.
    const isMock = (provider: IntelligenceProvider) =>
      !isDisplayableToUsers(provider.dataConfidence);

    // --- Geocoding-derived address fields ---
    const geocodingIsMock = isMock(this.geocodingProvider);
    if (geocodingIsMock) omitted.push('address');

    const location = {
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy: dto.accuracy,
      address: geocodingIsMock ? null : geocoding.formattedAddress,
      street: geocodingIsMock ? null : geocoding.street,
      crossStreet: geocodingIsMock ? null : geocoding.crossStreet,
      landmark: geocodingIsMock ? null : geocoding.landmark,
      community: geocodingIsMock ? null : geocoding.community,
      city: geocodingIsMock ? null : geocoding.city,
      state: geocodingIsMock ? null : geocoding.state,
      country: geocodingIsMock ? null : geocoding.country,
      postalCode: geocodingIsMock ? null : geocoding.postalCode,
      provider: geocodingIsMock ? null : geocoding.provider,
    };

    // --- Nearby places ---
    const placesIsMock = isMock(this.placesProvider);
    if (placesIsMock) omitted.push('surroundings');

    const surroundings = placesIsMock
      ? null
      : {
          places: nearbyPlaces,
          byDirection: this.placesProvider.groupByDirection(nearbyPlaces),
        };

    // --- Emergency resources: gated independently per provider ---
    const hospitalIsMock = isMock(this.hospitalProvider);
    const policeIsMock = isMock(this.policeProvider);
    const safePlaceIsMock = isMock(this.safePlaceProvider);
    if (hospitalIsMock) omitted.push('hospitals');
    if (policeIsMock) omitted.push('policeStations');
    if (safePlaceIsMock) omitted.push('safePlaces');

    const emergencyResources = {
      nearestHospital: hospitalIsMock ? null : (hospitals[0] ?? null),
      hospitals: hospitalIsMock ? null : hospitals,
      nearestPoliceStation: policeIsMock ? null : (policeStations[0] ?? null),
      policeStations: policeIsMock ? null : policeStations,
      nearestSafePlace: safePlaceIsMock ? null : (safePlaces[0] ?? null),
      safePlaces: safePlaceIsMock ? null : safePlaces,
    };

    // --- Routes ---
    const routingIsMock = isMock(this.routingProvider);
    if (routingIsMock) omitted.push('routes');

    if (omitted.length > 0) {
      this.logger.debug(
        `Omitted from response due to mock providers: ${omitted.join(', ')}. ` +
          'Raw device GPS still returned. This occurs whenever mock ' +
          'providers are registered, including in production under ' +
          'OPA_BOOT_WITH_SUPPRESSED_MOCKS=true.',
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      location,
      movement: {
        speed: dto.speed,
        heading: dto.heading,
        altitude: dto.altitude,
      },
      surroundings,
      emergencyResources,
      routes: routingIsMock ? null : routes,
      device,
    };
  }
}