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
 * This layer also isolates runtime provider failures. A geocoder, places,
 * hospital, police, safe-place, or routing outage must not prevent OPA from
 * returning raw GPS and any other intelligence that remains available.
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
    const settle = async <T>(
      providerName: string,
      operation: () => Promise<T>,
    ): Promise<T | null> => {
      try {
        return await operation();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown provider failure';

        this.logger.warn(
          `${providerName} failed while building location intelligence: ${message}`,
        );

        return null;
      }
    };

    const [
      geocoding,
      nearbyPlaces,
      hospitals,
      policeStations,
      safePlaces,
      routes,
    ] = await Promise.all([
      settle(this.geocodingProvider.providerName, () =>
        this.geocodingProvider.reverseGeocode(dto.latitude, dto.longitude),
      ),
      settle(this.placesProvider.providerName, () =>
        this.placesProvider.findNearbyPlaces(dto.latitude, dto.longitude),
      ),
      settle(this.hospitalProvider.providerName, () =>
        this.hospitalProvider.findNearbyHospitals(dto.latitude, dto.longitude),
      ),
      settle(this.policeProvider.providerName, () =>
        this.policeProvider.findNearbyPoliceStations(
          dto.latitude,
          dto.longitude,
        ),
      ),
      settle(this.safePlaceProvider.providerName, () =>
        this.safePlaceProvider.findNearbySafePlaces(
          dto.latitude,
          dto.longitude,
        ),
      ),
      settle(this.routingProvider.providerName, () =>
        this.routingProvider.buildSafeRoutes(),
      ),
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
    const unavailable: string[] = [];

    const isMock = (provider: IntelligenceProvider) =>
      !isDisplayableToUsers(provider.dataConfidence);

    // --- Geocoding-derived address fields ---
    const geocodingIsMock = isMock(this.geocodingProvider);
    const geocodingUnavailable = geocoding === null;

    if (geocodingIsMock) {
      omitted.push('address');
    } else if (geocodingUnavailable) {
      unavailable.push('address');
    }

    const location = {
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy: dto.accuracy,
      address:
        geocodingIsMock || geocodingUnavailable
          ? null
          : geocoding.formattedAddress,
      street:
        geocodingIsMock || geocodingUnavailable
          ? null
          : (geocoding.street ?? null),
      crossStreet:
        geocodingIsMock || geocodingUnavailable
          ? null
          : (geocoding.crossStreet ?? null),
      landmark:
        geocodingIsMock || geocodingUnavailable
          ? null
          : (geocoding.landmark ?? null),
      community:
        geocodingIsMock || geocodingUnavailable
          ? null
          : (geocoding.community ?? null),
      city:
        geocodingIsMock || geocodingUnavailable
          ? null
          : (geocoding.city ?? null),
      state:
        geocodingIsMock || geocodingUnavailable
          ? null
          : (geocoding.state ?? null),
      country:
        geocodingIsMock || geocodingUnavailable
          ? null
          : (geocoding.country ?? null),
      postalCode:
        geocodingIsMock || geocodingUnavailable
          ? null
          : (geocoding.postalCode ?? null),
      provider:
        geocodingIsMock || geocodingUnavailable
          ? null
          : geocoding.provider,
    };

    // --- Nearby places ---
    const placesIsMock = isMock(this.placesProvider);
    const placesUnavailable = nearbyPlaces === null;

    if (placesIsMock) {
      omitted.push('surroundings');
    } else if (placesUnavailable) {
      unavailable.push('surroundings');
    }

    const surroundings =
      placesIsMock || placesUnavailable
        ? null
        : {
            places: nearbyPlaces,
            byDirection:
              this.placesProvider.groupByDirection(nearbyPlaces),
          };

    // --- Emergency resources ---
    const hospitalIsMock = isMock(this.hospitalProvider);
    const policeIsMock = isMock(this.policeProvider);
    const safePlaceIsMock = isMock(this.safePlaceProvider);

    const hospitalUnavailable = hospitals === null;
    const policeUnavailable = policeStations === null;
    const safePlaceUnavailable = safePlaces === null;

    if (hospitalIsMock) {
      omitted.push('hospitals');
    } else if (hospitalUnavailable) {
      unavailable.push('hospitals');
    }

    if (policeIsMock) {
      omitted.push('policeStations');
    } else if (policeUnavailable) {
      unavailable.push('policeStations');
    }

    if (safePlaceIsMock) {
      omitted.push('safePlaces');
    } else if (safePlaceUnavailable) {
      unavailable.push('safePlaces');
    }

    const emergencyResources = {
      nearestHospital:
        hospitalIsMock || hospitalUnavailable
          ? null
          : (hospitals[0] ?? null),
      hospitals:
        hospitalIsMock || hospitalUnavailable ? null : hospitals,

      nearestPoliceStation:
        policeIsMock || policeUnavailable
          ? null
          : (policeStations[0] ?? null),
      policeStations:
        policeIsMock || policeUnavailable ? null : policeStations,

      nearestSafePlace:
        safePlaceIsMock || safePlaceUnavailable
          ? null
          : (safePlaces[0] ?? null),
      safePlaces:
        safePlaceIsMock || safePlaceUnavailable ? null : safePlaces,
    };

    // --- Routes ---
    const routingIsMock = isMock(this.routingProvider);
    const routingUnavailable = routes === null;

    if (routingIsMock) {
      omitted.push('routes');
    } else if (routingUnavailable) {
      unavailable.push('routes');
    }

    if (omitted.length > 0) {
      this.logger.debug(
        `Omitted from response due to mock providers: ${omitted.join(', ')}. ` +
          'Raw device GPS still returned.',
      );
    }

    if (unavailable.length > 0) {
      this.logger.warn(
        `Location intelligence unavailable from providers: ${unavailable.join(
          ', ',
        )}. Raw device GPS and remaining provider results still returned.`,
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
      routes:
        routingIsMock || routingUnavailable ? null : routes,
      device,
    };
  }
}
