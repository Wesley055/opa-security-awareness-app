/**
 * How much a provider's data can be trusted.
 *
 * This exists because a mock provider that returns plausible-looking data is
 * more dangerous than one that returns nothing: a responder shown a
 * fabricated street address or a fabricated "nearest hospital" may act on it.
 *
 * Provider NAMES are not a safe signal - a naming convention is easy to
 * overlook and easy to break. This explicit field is checked by
 * ProviderConfidenceValidator at startup, and should be checked by any UI
 * before rendering location intelligence to a human.
 */
export type DataConfidence =
  /** Fabricated development data. MUST NOT reach a real user or responder. */
  | 'MOCK'
  /** Real data from a source that has not been formally verified. */
  | 'VERIFIED'
  /** Real data from a production-approved provider. Safe to display. */
  | 'PRODUCTION';

/**
 * Every emergency intelligence provider must declare how trustworthy its data
 * is. Implementing this interface makes the contract explicit, so a new
 * provider cannot silently omit its confidence level and slip past the
 * startup validator.
 */
export interface IntelligenceProvider {
  readonly providerName: string;
  readonly dataConfidence: DataConfidence;
}

/**
 * THE PRIMITIVE. Asks only whether a provider is mocked. Says nothing about
 * whether the value may be shown to anyone.
 *
 * Kept separate from isDisplayableToUsers below, deliberately. The startup
 * validator asks "is this provider mocked" - a deployment question. A
 * response builder or a UI asks "may this be displayed" - a presentation
 * question. Both return the same answer today and they are not the same
 * question: if a fourth confidence level is ever added, only one of them is
 * likely to change. Each caller should use the one that matches what it is
 * actually asking.
 */
export const isMockConfidence = (confidence: DataConfidence): boolean =>
  confidence === 'MOCK';

/**
 * DERIVED from the primitive above. This is the check named in the
 * DataConfidence doc comment: any UI or response builder should call this
 * before rendering location intelligence to a human.
 *
 * Defined in terms of isMockConfidence rather than repeating the comparison,
 * so the rule exists in exactly one place. Before this, the same comparison
 * was written out three times - here, in the boot validator, and again as a
 * local helper inside EmergencyIntelligenceService - and all three had to be
 * changed in step to stay correct.
 */
export const isDisplayableToUsers = (confidence: DataConfidence): boolean =>
  !isMockConfidence(confidence);
