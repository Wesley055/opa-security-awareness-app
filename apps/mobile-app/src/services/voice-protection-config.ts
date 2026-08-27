export interface VoiceProtectionConfig {
  enabled: boolean;
  provider: 'picovoice_porcupine';
  phrase: string;
  accessKey: string | null;
  keywordPath: string | null;
  sensitivity: number;
}

export interface VoiceProtectionConfigInput {
  enabled?: string;
  accessKey?: string;
  keywordPath?: string;
}

export function buildVoiceProtectionConfig(
  input: VoiceProtectionConfigInput,
): VoiceProtectionConfig {
  return {
    enabled: input.enabled === 'true',
    provider: 'picovoice_porcupine',
    phrase: 'HELP HELP',
    accessKey: input.accessKey?.trim() || null,
    keywordPath: input.keywordPath?.trim() || null,
    sensitivity: 0.5,
  };
}

export function getVoiceProtectionConfig(): VoiceProtectionConfig {
  return buildVoiceProtectionConfig({
    enabled:
      process.env.EXPO_PUBLIC_VOICE_PROTECTION_ENABLED,
    accessKey:
      process.env.EXPO_PUBLIC_PICOVOICE_ACCESS_KEY,
    keywordPath:
      process.env.EXPO_PUBLIC_PICOVOICE_KEYWORD_PATH,
  });
}

export function isVoiceProtectionReady(
  config: VoiceProtectionConfig,
): boolean {
  return (
    config.enabled &&
    config.accessKey !== null &&
    config.keywordPath !== null
  );
}
