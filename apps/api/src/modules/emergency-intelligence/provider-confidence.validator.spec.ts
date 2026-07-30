import { Logger } from '@nestjs/common';
import { ProviderConfidenceValidator } from './provider-confidence.validator';
import type { DataConfidence } from './data-confidence';

/**
 * The validator is a SAFETY gate: it decides whether an application that
 * would serve fabricated emergency data is allowed to start at all. These
 * tests pin its CURRENT behaviour exactly, including the cases that must
 * keep failing. They are written to describe what the validator already
 * does, so that any future change to its boot policy has to change a test
 * deliberately rather than slip through.
 *
 * Constructed directly rather than through Test.createTestingModule:
 * jest.config.ts declares no setupFiles, so reflect-metadata is not loaded
 * globally and a Nest testing module cannot read decorated constructor
 * metadata here.
 */

interface ProviderStub {
  providerName: string;
  dataConfidence: DataConfidence;
}

type ValidatorCtor = new (...args: unknown[]) => ProviderConfidenceValidator;

const CTOR = ProviderConfidenceValidator as unknown as ValidatorCtor;

// Constructor order: geocoding, hospital, places, police, routing, safePlace.
const NAMES = [
  'MockGeocodingProvider',
  'MockHospitalProvider',
  'MockPlacesProvider',
  'MockPoliceProvider',
  'MockRoutingProvider',
  'MockSafePlaceProvider',
];

const buildValidator = (
  confidences: Partial<Record<number, DataConfidence>> = {},
): ProviderConfidenceValidator => {
  const stubs: ProviderStub[] = NAMES.map((providerName, index) => ({
    providerName,
    dataConfidence: confidences[index] ?? 'PRODUCTION',
  }));

  const [a, b, c, d, e, f] = stubs;
  return new CTOR(a, b, c, d, e, f);
};

describe('ProviderConfidenceValidator', () => {
  const originalEnv = process.env;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPA_ALLOW_MOCK_PROVIDERS;
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('when every provider is production-grade', () => {
    it('starts, and says so exactly once', () => {
      const validator = buildValidator();
      expect(() => validator.onModuleInit()).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('VERIFIED confidence', () => {
    // VERIFIED is real data from an unverified source. It is not mock data,
    // and it must not be treated as a startup problem.
    it('is not treated as mocked', () => {
      const validator = buildValidator({ 0: 'VERIFIED', 3: 'VERIFIED' });
      expect(() => validator.onModuleInit()).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('when a provider returns MOCK and no override is set', () => {
    it('refuses to start', () => {
      const validator = buildValidator({ 1: 'MOCK' });
      expect(() => validator.onModuleInit()).toThrow(/Refusing to start/);
    });

    it('names every mocked provider, and only those', () => {
      const validator = buildValidator({ 0: 'MOCK', 2: 'MOCK', 4: 'MOCK' });

      let message = '';
      try {
        validator.onModuleInit();
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain('MockGeocodingProvider');
      expect(message).toContain('MockPlacesProvider');
      expect(message).toContain('MockRoutingProvider');
      expect(message).not.toContain('MockHospitalProvider');
      expect(message).not.toContain('MockPoliceProvider');
    });

    it('reports the count of mocked providers', () => {
      const validator = buildValidator({ 0: 'MOCK', 1: 'MOCK' });
      expect(() => validator.onModuleInit()).toThrow(/2 emergency/);
    });
  });

  describe('OPA_ALLOW_MOCK_PROVIDERS', () => {
    it('permits startup with a warning when the value is exactly true', () => {
      process.env.OPA_ALLOW_MOCK_PROVIDERS = 'true';
      const validator = buildValidator({ 1: 'MOCK' });
      expect(() => validator.onModuleInit()).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns in terms strong enough to be noticed', () => {
      process.env.OPA_ALLOW_MOCK_PROVIDERS = 'true';
      const validator = buildValidator({ 1: 'MOCK' });
      validator.onModuleInit();

      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('MockHospitalProvider');
      expect(message).toContain('NEVER');
    });

    // Deliberately strict, and this is the test most worth keeping. A safety
    // override must not be satisfiable by a value someone assumed was
    // truthy. If this is ever loosened, the loosening should be a decision
    // rather than a convenience.
    it.each(['TRUE', 'True', '1', 'yes', 'on', 'false', ''])(
      'does not accept %p as permission',
      (value) => {
        process.env.OPA_ALLOW_MOCK_PROVIDERS = value;
        const validator = buildValidator({ 1: 'MOCK' });
        expect(() => validator.onModuleInit()).toThrow(/Refusing to start/);
      },
    );

    it('is irrelevant when no provider is mocked', () => {
      process.env.OPA_ALLOW_MOCK_PROVIDERS = 'true';
      const validator = buildValidator();
      expect(() => validator.onModuleInit()).not.toThrow();
      expect(log).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
