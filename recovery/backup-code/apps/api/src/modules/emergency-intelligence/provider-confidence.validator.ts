import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { IntelligenceProvider } from './data-confidence';
import { isMockConfidence } from './data-confidence';
import { GeocodingProvider } from './providers/geocoding.provider';
import { HospitalProvider } from './providers/hospital.provider';
import { PlacesProvider } from './providers/places.provider';
import { PoliceProvider } from './providers/police.provider';
import { RoutingProvider } from './providers/routing.provider';
import { SafePlaceProvider } from './providers/safe-place.provider';

/**
 * Refuses to start when MOCK emergency-intelligence providers are registered
 * unless the deployment explicitly acknowledges booting with their outputs
 * suppressed.
 *
 * This converts "we must remember not to expose fabricated data" into an
 * application-enforced rule. A mock geocoder that reports the same invented
 * street address for every coordinate is not a cosmetic problem in a safety
 * product: a responder could be sent to the wrong place.
 *
 * Gating is controlled by an explicit flag rather than NODE_ENV. Forgetting
 * the flag fails closed. The flag acknowledges suppressed-provider operation;
 * it does not permit mock data to reach users or responders.
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
    // isMockConfidence, not isDisplayableToUsers: this is a deployment
    // question about the providers themselves, not a question about what may
    // be rendered. Same answer today; different question.
    const mocked = this.providers.filter((p) =>
      isMockConfidence(p.dataConfidence),
    );

    if (mocked.length === 0) {
      this.logger.log(
        'All emergency intelligence providers report production-grade data.',
      );
      return;
    }

    const names = mocked.map((p) => p.providerName).join(', ');

    // Opt-IN: an environment must explicitly acknowledge booting with
    // registered mock providers whose outputs are suppressed. Forgetting the
    // flag fails closed, which is the safe direction for a safety product.
    const suppressedMocksAcknowledged =
      process.env.OPA_BOOT_WITH_SUPPRESSED_MOCKS === 'true';

    if (!suppressedMocksAcknowledged) {
      throw new Error(
        `Refusing to start: ${mocked.length} mock emergency-intelligence ` +
          `provider(s) are registered (${names}). Fabricated location ` +
          'intelligence must never reach a real user or responder. Replace ' +
          'these providers, ensure their outputs are suppressed from every ' +
          'response path, or explicitly acknowledge booting with suppressed ' +
          'mocks by setting OPA_BOOT_WITH_SUPPRESSED_MOCKS=true.',
      );
    }

    this.logger.warn(
      `${mocked.length} mock emergency-intelligence provider(s) are ` +
        `registered (${names}). Current response handling suppresses their ` +
        'outputs from user and responder responses. Boot permitted because ' +
        'OPA_BOOT_WITH_SUPPRESSED_MOCKS=true.',
    );
  }
}
