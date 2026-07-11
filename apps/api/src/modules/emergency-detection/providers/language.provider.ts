import { Injectable } from '@nestjs/common';

export interface SupportedLanguage {
  code: string;
  name: string;
  region: string;
  enabled: boolean;
}

@Injectable()
export class LanguageProvider {
  private readonly supportedLanguages: SupportedLanguage[] = [
    {
      code: 'en-NG',
      name: 'English',
      region: 'Nigeria',
      enabled: true,
    },
    {
      code: 'pcm-NG',
      name: 'Nigerian Pidgin',
      region: 'Nigeria',
      enabled: true,
    },
    {
      code: 'yo-NG',
      name: 'Yoruba',
      region: 'Nigeria',
      enabled: true,
    },
    {
      code: 'ha-NG',
      name: 'Hausa',
      region: 'Nigeria',
      enabled: true,
    },
    {
      code: 'ig-NG',
      name: 'Igbo',
      region: 'Nigeria',
      enabled: true,
    },
  ];

  listSupportedLanguages(): SupportedLanguage[] {
    return this.supportedLanguages;
  }

  isSupported(languageCode?: string): boolean {
    if (!languageCode) {
      return true;
    }

    return this.supportedLanguages.some(
      (language) =>
        language.enabled &&
        language.code.toLowerCase() === languageCode.toLowerCase(),
    );
  }

  normalizeLanguage(languageCode?: string): string {
    if (!languageCode) {
      return 'en-NG';
    }

    const supportedLanguage = this.supportedLanguages.find(
      (language) =>
        language.enabled &&
        language.code.toLowerCase() === languageCode.toLowerCase(),
    );

    return supportedLanguage?.code ?? 'en-NG';
  }
}