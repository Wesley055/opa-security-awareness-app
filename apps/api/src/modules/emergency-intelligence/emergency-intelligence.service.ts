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
 * The boot-time ProviderConfidenceValidator refuses to start the app at all
 * unless OPA_ALLOW_MOCK_PROVIDERS=true is explicitly set - meaning this
 * omission path only runs in an environment that has knowingly opted into
 * mock providers (local dev). Production, staging, and anything shown to a
 * pilot partner never reaches this branch with mocks still in place.
 *
 * Do not remove this gating even though the validator already blocks
 * startup - defense in depth. If the validator is ever relaxed for a
 * legitimate reason, this is the layer that still prevents fabricated
 * data from reaching a real response.
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
          'Raw device GPS still returned. This only occurs when ' +
          'OPA_ALLOW_MOCK_PROVIDERS=true (local development only).',
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