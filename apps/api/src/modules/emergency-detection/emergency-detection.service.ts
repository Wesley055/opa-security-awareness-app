import { BadRequestException, Injectable } from '@nestjs/common';
import type { TriggerRequestDto } from './dto/trigger-request.dto';
import { ConfidenceProvider } from './providers/confidence.provider';
import { LanguageProvider } from './providers/language.provider';
import { ProfileProvider } from './providers/profile.provider';
import { SilentProvider } from './providers/silent.provider';
import { TriggerProvider } from './providers/trigger.provider';
import { VoiceProvider } from './providers/voice.provider';

@Injectable()
export class EmergencyDetectionService {
  constructor(
    private readonly profileProvider: ProfileProvider,
    private readonly voiceProvider: VoiceProvider,
    private readonly triggerProvider: TriggerProvider,
    private readonly languageProvider: LanguageProvider,
    private readonly confidenceProvider: ConfidenceProvider,
    private readonly silentProvider: SilentProvider,
  ) {}

  evaluate(dto: TriggerRequestDto) {
    const profile = this.profileProvider.getDefaultProfile();
    const language = this.languageProvider.normalizeLanguage(dto.language);

    if (!this.languageProvider.isSupported(language)) {
      throw new BadRequestException(
        `Unsupported detection language: ${dto.language}`,
      );
    }

    const configuredPhrase =
      profile.triggerPhrases.find(
        (item) => item.enabled && item.language === language,
      )?.phrase ?? profile.triggerPhrases[0]?.phrase;

    const voice = this.voiceProvider.evaluateVoiceTrigger({
      detectedPhrase: dto.detectedPhrase,
      configuredPhrase,
      language,
      confidence: dto.voiceConfidence,
      repetitionCount: dto.repetitionCount,
    });

    const decision = this.triggerProvider.evaluateTrigger({
      triggerType: dto.triggerType,
      mode: dto.mode,
      voiceMatched: voice.matched,
      userConfirmed: dto.userConfirmed,
      cancellationReceived: dto.cancellationReceived,
      confirmationSeconds:
        dto.confirmationSeconds ?? profile.confirmationSeconds,
    });

    const confidence = this.confidenceProvider.calculate({
      voiceMatched: voice.matched,
      voiceConfidence: dto.voiceConfidence,
      repetitionCount: dto.repetitionCount,
      userConfirmed: dto.userConfirmed,
      deviceInMotion: dto.deviceInMotion,
      isOffline: dto.isOffline,
    });

    const silent = this.silentProvider.evaluate({
      mode: dto.mode,
      silentProfileEnabled: profile.silentMode,
      screenLocked: true,
      concealActivation: true,
    });

    return {
      evaluatedAt: new Date().toISOString(),
      profile: {
        name: dto.profileName?.trim() || profile.name,
        language,
        confirmationSeconds:
          dto.confirmationSeconds ?? profile.confirmationSeconds,
        activeTriggerPhrase: configuredPhrase,
      },
      trigger: {
        type: dto.triggerType,
        mode: dto.mode,
        detectedPhrase: dto.detectedPhrase,
        decision,
      },
      voice,
      confidence,
      silent,
      outcome: {
        shouldActivate: decision.shouldActivate,
        requiresConfirmation: decision.requiresConfirmation,
        isSilent: silent.isSilent || decision.isSilent,
        confidenceScore: confidence.score,
        confidenceLevel: confidence.level,
      },
    };
  }

  getSupportedLanguages() {
    return this.languageProvider.listSupportedLanguages();
  }

  getDefaultProfile() {
    return this.profileProvider.getDefaultProfile();
  }
}