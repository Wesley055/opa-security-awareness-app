import {
  buildVoiceProtectionConfig,
  isVoiceProtectionReady,
} from './voice-protection-config';

describe('voice-protection-config', () => {
  it('is disabled and not ready by default', () => {
    const config = buildVoiceProtectionConfig({});

    expect(config.enabled).toBe(false);
    expect(config.accessKey).toBeNull();
    expect(config.keywordPath).toBeNull();
    expect(config.phrase).toBe('HELP HELP');
    expect(isVoiceProtectionReady(config)).toBe(false);
  });

  it('is not ready when enabled without an access key', () => {
    const config = buildVoiceProtectionConfig({
      enabled: 'true',
      keywordPath: '/assets/voice/help-help.ppn',
    });

    expect(config.enabled).toBe(true);
    expect(config.accessKey).toBeNull();
    expect(isVoiceProtectionReady(config)).toBe(false);
  });

  it('is not ready when enabled without a keyword path', () => {
    const config = buildVoiceProtectionConfig({
      enabled: 'true',
      accessKey: 'test-access-key',
    });

    expect(config.enabled).toBe(true);
    expect(config.keywordPath).toBeNull();
    expect(isVoiceProtectionReady(config)).toBe(false);
  });

  it('is ready only when explicitly enabled with all required configuration', () => {
    const config = buildVoiceProtectionConfig({
      enabled: 'true',
      accessKey: 'test-access-key',
      keywordPath: '/assets/voice/help-help.ppn',
    });

    expect(config).toEqual({
      enabled: true,
      provider: 'picovoice_porcupine',
      phrase: 'HELP HELP',
      accessKey: 'test-access-key',
      keywordPath: '/assets/voice/help-help.ppn',
      sensitivity: 0.5,
    });

    expect(isVoiceProtectionReady(config)).toBe(true);
  });

  it('does not enable voice protection for non-exact boolean values', () => {
    const config = buildVoiceProtectionConfig({
      enabled: 'TRUE',
      accessKey: 'test-access-key',
      keywordPath: '/assets/voice/help-help.ppn',
    });

    expect(config.enabled).toBe(false);
    expect(isVoiceProtectionReady(config)).toBe(false);
  });
});
