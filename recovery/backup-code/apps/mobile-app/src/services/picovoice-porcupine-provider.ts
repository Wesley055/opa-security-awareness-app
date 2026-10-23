import type {
  VoiceTriggerHandler,
  VoiceTriggerProvider,
} from "./voice-trigger-provider";

export interface PicovoicePorcupineConfig {
  accessKey: string;
  keywordPath: string;
  phrase: string;
  sensitivity?: number;
}

/**
 * Voice wake-word monitoring is intentionally unavailable on iOS 1.0.
 *
 * iOS does not start Picovoice native monitoring in this release.
 * Android retains the production Picovoice implementation.
 */
export class PicovoicePorcupineProvider
  implements VoiceTriggerProvider
{
  readonly id = "picovoice_porcupine" as const;

  constructor(
    _config: PicovoicePorcupineConfig,
  ) {}

  isRunning(): boolean {
    return false;
  }

  async start(
    _onTrigger: VoiceTriggerHandler,
  ): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    return;
  }
}
