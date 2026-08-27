export type VoiceTriggerProviderId =
  | 'picovoice_porcupine'
  | 'future_offline_voice_provider';

export interface VoiceTriggerEvent {
  /**
   * Canonical phrase represented by the detected keyword model.
   * This is provider-neutral and must not contain raw audio.
   */
  phrase: string;

  /**
   * Provider-supplied confidence when genuinely available.
   * null means the provider does not expose a meaningful confidence value.
   * Never synthesize or estimate this value.
   */
  confidence: number | null;

  /**
   * Detection time in Unix milliseconds.
   */
  timestamp: number;

  /**
   * Identifies the implementation that produced the event without exposing
   * provider-specific objects to the rest of OPA.
   */
  provider: VoiceTriggerProviderId;
}

export type VoiceTriggerHandler = (
  event: VoiceTriggerEvent,
) => void | Promise<void>;

export interface VoiceTriggerProvider {
  readonly id: VoiceTriggerProviderId;

  start(onTrigger: VoiceTriggerHandler): Promise<void>;

  stop(): Promise<void>;

  isRunning(): boolean;
}
