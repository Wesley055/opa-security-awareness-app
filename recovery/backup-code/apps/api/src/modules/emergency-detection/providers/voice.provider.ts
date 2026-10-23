import { Injectable } from '@nestjs/common';

export interface VoiceDetectionInput {
  detectedPhrase?: string;
  configuredPhrase?: string;
  language?: string;
  confidence?: number;
  repetitionCount?: number;
}

export interface VoiceDetectionResult {
  matched: boolean;
  normalizedDetectedPhrase?: string;
  normalizedConfiguredPhrase?: string;
  language: string;
  confidence: number;
  repetitionCount: number;
  reason: string;
  provider: string;
}

@Injectable()
export class VoiceProvider {
  readonly providerName = 'MockVoiceProvider';

  evaluateVoiceTrigger(
    input: VoiceDetectionInput,
  ): VoiceDetectionResult {
    const normalizedDetectedPhrase = input.detectedPhrase
      ? this.normalizePhrase(input.detectedPhrase)
      : undefined;

    const normalizedConfiguredPhrase = input.configuredPhrase
      ? this.normalizePhrase(input.configuredPhrase)
      : undefined;

    const confidence = input.confidence ?? 0;
    const repetitionCount = input.repetitionCount ?? 0;
    const language = input.language?.trim() || 'en-NG';

    if (!normalizedDetectedPhrase) {
      return {
        matched: false,
        language,
        confidence,
        repetitionCount,
        reason: 'No voice phrase was detected.',
        provider: this.providerName,
      };
    }

    if (!normalizedConfiguredPhrase) {
      return {
        matched: false,
        normalizedDetectedPhrase,
        language,
        confidence,
        repetitionCount,
        reason: 'No configured trigger phrase was provided.',
        provider: this.providerName,
      };
    }

    const matched =
      normalizedDetectedPhrase === normalizedConfiguredPhrase;

    return {
      matched,
      normalizedDetectedPhrase,
      normalizedConfiguredPhrase,
      language,
      confidence,
      repetitionCount,
      reason: matched
        ? 'Detected phrase matched the configured trigger phrase.'
        : 'Detected phrase did not match the configured trigger phrase.',
      provider: this.providerName,
    };
  }

  private normalizePhrase(phrase: string): string {
    return phrase
      .trim()
      .replace(/[.,!?;:]+/g, '')
      .replace(/\s+/g, ' ')
      .toUpperCase();
  }
}