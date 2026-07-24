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

export const isDisplayableToUsers = (confidence: DataConfidence): boolean =>
  confidence !== 'MOCK';
