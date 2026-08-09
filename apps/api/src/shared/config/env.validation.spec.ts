import { validateEnv } from './env.validation';

/**
 * validateEnv is what AppModule passes to ConfigModule.forRoot({ validate }),
 * so it runs FIRST on every production boot - before any module loads.
 * Nothing else tested it.
 *
 * On 8 August 2026 removing REDIS_URL from App Service took production down:
 * this schema required it while readiness-policy.ts declared Redis optional.
 * Every existing spec assumes an already-validated environment and so could
 * not see the defect.
 *
 * Called DIRECTLY rather than through AppModule on purpose: ConfigModule
 * loads .env by default, and a local .env carrying REDIS_URL would
 * repopulate the very variable under test and produce a false green.
 */
describe('validateEnv', () => {
  const required = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/opa',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    ALLOWED_ORIGINS: 'http://localhost:3000',
    AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
    AZURE_STORAGE_CONTAINER: 'evidence',
  };

  it('validates with REDIS_URL ABSENT - the production boot case', () => {
    const parsed = validateEnv({ ...required });
    expect(parsed.REDIS_URL).toBeUndefined();
  });

  it('validates with REDIS_URL present', () => {
    const parsed = validateEnv({
      ...required,
      REDIS_URL: 'redis://cache:6379',
    });
    expect(parsed.REDIS_URL).toBe('redis://cache:6379');
  });

  it('rejects a REDIS_URL that is supplied but malformed', () => {
    // 'placeholder' was the App Service value for three days. Absent and
    // malformed are DIFFERENT failures and must stay distinguishable.
    expect(() =>
      validateEnv({ ...required, REDIS_URL: 'placeholder' }),
    ).toThrow();
  });

  it('still requires DATABASE_URL', () => {
    expect(() =>
      validateEnv({ ...required, DATABASE_URL: undefined }),
    ).toThrow();
  });

  it('applies defaults for the optional numeric and enum fields', () => {
    const parsed = validateEnv({ ...required });
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.API_PORT).toBe(3000);
    expect(parsed.BCRYPT_ROUNDS).toBe(12);
  });
});
