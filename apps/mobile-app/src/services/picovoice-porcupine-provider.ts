import {
  PorcupineManager,
} from '@picovoice/porcupine-react-native';

import type {
  VoiceTriggerHandler,
  VoiceTriggerProvider,
} from './voice-trigger-provider';

export interface PicovoicePorcupineConfig {
  accessKey: string;
  keywordPath: string;
  phrase: string;
  sensitivity?: number;
}

export class PicovoicePorcupineProvider
  implements VoiceTriggerProvider
{
  readonly id = 'picovoice_porcupine' as const;

  private manager: PorcupineManager | null = null;
  private running = false;

  constructor(
    private readonly config: PicovoicePorcupineConfig,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(
    onTrigger: VoiceTriggerHandler,
  ): Promise<void> {
    if (this.running) {
      return;
    }

    const accessKey = this.config.accessKey.trim();
    const keywordPath = this.config.keywordPath.trim();
    const phrase = this.config.phrase.trim();

    if (!accessKey) {
      throw new Error(
        'Picovoice access key is not configured.',
      );
    }

    if (!keywordPath) {
      throw new Error(
        'Picovoice keyword model path is not configured.',
      );
    }

    if (!phrase) {
      throw new Error(
        'Picovoice keyword phrase is not configured.',
      );
    }

    const sensitivity =
      this.config.sensitivity ?? 0.5;

    if (
      !Number.isFinite(sensitivity) ||
      sensitivity < 0 ||
      sensitivity > 1
    ) {
      throw new Error(
        'Picovoice sensitivity must be between 0 and 1.',
      );
    }

    this.manager =
      await PorcupineManager.fromKeywordPaths(
        accessKey,
        [keywordPath],
        (keywordIndex) => {
          if (keywordIndex !== 0) {
            return;
          }

          void Promise.resolve(
            onTrigger({
              phrase,
              confidence: null,
              timestamp: Date.now(),
              provider: this.id,
            }),
          ).catch((error: unknown) => {
            console.log(
              '[voice-trigger] trigger handler failed',
              error,
            );
          });
        },
        (error) => {
          console.log(
            '[voice-trigger] Picovoice processing error',
            error,
          );
        },
        undefined,
        undefined,
        [sensitivity],
      );

    try {
      await this.manager.start();
      this.running = true;
    } catch (error) {
      this.manager.delete();
      this.manager = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const manager = this.manager;

    if (!manager) {
      this.running = false;
      return;
    }

    this.manager = null;
    this.running = false;

    try {
      await manager.stop();
    } finally {
      manager.delete();
    }
  }
}
