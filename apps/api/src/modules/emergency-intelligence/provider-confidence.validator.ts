import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { IntelligenceProvider } from './data-confidence';
import { GeocodingProvider } from './providers/geocoding.provider';
import { HospitalProvider } from './providers/hospital.provider';
import { PlacesProvider } from './providers/places.provider';
import { PoliceProvider } from './providers/police.provider';
import { RoutingProvider } from './providers/routing.provider';
import { SafePlaceProvider } from './providers/safe-place.provider';

/**
 * Refuses to start the application in production if any emergency
 * intelligence provider is still returning mock data.
 *
 * This converts "we must remember not to ship fabricated data" into something
 * the application enforces. A mock geocoder that reports the same invented
 * street address for every coordinate on earth is not a cosmetic problem in a
 * safety product - a responder could be sent to the wrong place.
 *
 * Gating is by explicit flag rather than NODE_ENV, because staging, UAT and
 * demo environments are shown to real pilot partners and must be held to the
 * same standard as production. Mocks are opt-IN, not opt-out.
 */
@Injectable()
export class ProviderConfidenceValidator implements OnModuleInit {
  private readonly logger = new Logger(ProviderConfidenceValidator.name);

  constructor(
    private readonly geocoding: GeocodingProvider,
    private readonly hospital: HospitalProvider,
    private readonly places: PlacesProvider,
    private readonly police: PoliceProvider,
    private readonly routing: RoutingProvider,
    private readonly safePlace: SafePlaceProvider,
  ) {}

  private get providers(): IntelligenceProvider[] {
    return [
      this.geocoding,
      this.hospital,
      this.places,
      this.police,
      this.routing,
      this.safePlace,
    ];
  }

  onModuleInit(): void {
    const mocked = this.providers.filter((p) => p.dataConfidence === 'MOCK');

    if (mocked.length === 0) {
      this.logger.log(
        'All emergency intelligence providers report production-grade data.',
      );
      return;
    }

    const names = mocked.map((p) => p.providerName).join(', ');

    // Opt-IN: an environment must explicitly declare that fabricated data is
    // acceptable. Forgetting to set it fails closed, which is the safe
    // direction for a safety product.
    const mocksAllowed = process.env.OPA_ALLOW_MOCK_PROVIDERS === 'true';

    if (!mocksAllowed) {
      throw new Error(
        `Refusing to start: ${mocked.length} emergency intelligence provider(s) ` +
          `return MOCK data (${names}). Fabricated location intelligence must ` +
          'never reach a real user or responder. Either replace these ' +
          'providers, gate them out of the response, or set ' +
          'OPA_ALLOW_MOCK_PROVIDERS=true if this is a development environment.',
      );
    }

    this.logger.warn(
      `${mocked.length} emergency intelligence provider(s) are returning MOCK ` +
        `data (${names}). Permitted because OPA_ALLOW_MOCK_PROVIDERS=true. ` +
        'This must NEVER be set in production, staging, UAT or any ' +
        'environment shown to a pilot partner.',
    );
  }
}
