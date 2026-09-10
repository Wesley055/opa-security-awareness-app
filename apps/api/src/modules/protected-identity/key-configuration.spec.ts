import { randomBytes } from 'crypto';
import { configuredIdentityCrypto } from './protected-identity.module';
describe('production protected identity configuration', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    for (const key of Object.keys(process.env)) if (key.startsWith('PII_')) delete process.env[key];
  });
  it('fails startup when the production adapter/key configuration is missing', () => {
    expect(() => configuredIdentityCrypto()).toThrow('required in production');
  });
  it('rejects invalid key material without echoing it', () => {
    process.env.PII_CRYPTO_ADAPTER = 'local';
    process.env.PII_ENCRYPTION_KEYS_JSON = 'sensitive-invalid-value';
    expect(() => configuredIdentityCrypto()).toThrow('Invalid protected identity key configuration.');
  });
  it('accepts independently managed canonical keys', () => {
    process.env.PII_CRYPTO_ADAPTER = 'local';
    process.env.PII_ENCRYPTION_KEYS_JSON = JSON.stringify({ e1: randomBytes(32).toString('base64') });
    process.env.PII_ENCRYPTION_KEY_VERSION = 'e1';
    process.env.PII_LOOKUP_KEY = randomBytes(32).toString('base64');
    process.env.PII_LOOKUP_KEY_VERSION = 'h1';
    expect(configuredIdentityCrypto()).toBeDefined();
  });
});
