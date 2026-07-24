import { redactSensitivePath } from './request-logging.middleware';

describe('redactSensitivePath', () => {
  it('redacts a tracking token so logs never contain a working link', () => {
    const path = '/public/tracking/dHa-H4nSGlE9F6gJEuQTAg';

    const result = redactSensitivePath(path);

    expect(result).toBe('/public/tracking/<redacted>');
    expect(result).not.toContain('dHa-H4nSGlE9F6gJEuQTAg');
  });

  it('drops any query string on a sensitive route', () => {
    // A token could appear in a query parameter too, so everything after the
    // prefix goes, not just the path segment.
    const result = redactSensitivePath(
      '/public/tracking/dHa-H4nSGlE9F6gJEuQTAg?ref=whatsapp',
    );

    expect(result).toBe('/public/tracking/<redacted>');
    expect(result).not.toContain('dHa-H4nSGlE9F6gJEuQTAg');
    expect(result).not.toContain('whatsapp');
  });

  it('leaves ordinary paths untouched', () => {
    expect(redactSensitivePath('/incident-orchestrator/activate')).toBe(
      '/incident-orchestrator/activate',
    );
    expect(redactSensitivePath('/health/ready')).toBe('/health/ready');
  });

  it('does not redact a path that merely resembles the prefix', () => {
    expect(redactSensitivePath('/public/tracking-config')).toBe(
      '/public/tracking-config',
    );
  });
});
