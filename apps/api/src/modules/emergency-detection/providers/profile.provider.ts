import { Injectable } from '@nestjs/common';

export interface TriggerPhraseProfile {
  phrase: string;
  language: string;
  enabled: boolean;
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface EmergencyDetectionProfile {
  name: string;
  isActive: boolean;
  silentMode: boolean;
  immediateSosEnabled: boolean;
  voiceDetectionEnabled: boolean;
  offlineDetectionEnabled: boolean;
  confirmationSeconds: number;
  language: string;
  triggerPhrases: TriggerPhraseProfile[];
}

@Injectable()
export class ProfileProvider {
  getDefaultProfile(): EmergencyDetectionProfile {
    return {
      name: 'Default',
      isActive: true,
      silentMode: false,
      immediateSosEnabled: true,
      voiceDetectionEnabled: true,
      offlineDetectionEnabled: true,
      confirmationSeconds: 5,
      language: 'en-NG',
      triggerPhrases: [
        {
          phrase: 'HELP HELP',
          language: 'en-NG',
          enabled: true,
          sensitivity: 'HIGH',
        },
      ],
    };
  }

  getNigeriaLanguageProfiles(): EmergencyDetectionProfile[] {
    return [
      {
        ...this.getDefaultProfile(),
        name: 'English',
        language: 'en-NG',
      },
      {
        ...this.getDefaultProfile(),
        name: 'Nigerian Pidgin',
        language: 'pcm-NG',
        triggerPhrases: [
          {
            phrase: 'HELP ME',
            language: 'pcm-NG',
            enabled: true,
            sensitivity: 'HIGH',
          },
        ],
      },
      {
        ...this.getDefaultProfile(),
        name: 'Yoruba',
        language: 'yo-NG',
        triggerPhrases: [],
      },
      {
        ...this.getDefaultProfile(),
        name: 'Hausa',
        language: 'ha-NG',
        triggerPhrases: [],
      },
      {
        ...this.getDefaultProfile(),
        name: 'Igbo',
        language: 'ig-NG',
        triggerPhrases: [],
      },
    ];
  }

  findActivePhrase(
    profile: EmergencyDetectionProfile,
    detectedPhrase: string,
  ): TriggerPhraseProfile | undefined {
    const normalizedDetectedPhrase = this.normalizePhrase(detectedPhrase);

    return profile.triggerPhrases.find(
      (triggerPhrase) =>
        triggerPhrase.enabled &&
        this.normalizePhrase(triggerPhrase.phrase) === normalizedDetectedPhrase,
    );
  }

  private normalizePhrase(phrase: string): string {
    return phrase.trim().replace(/\s+/g, ' ').toUpperCase();
  }
}