import type { Config } from 'jest';

/**
 * Integration config, separate from jest.config.ts so the unit suite is
 * untouched.
 *
 * testRegex matches '.int-spec.ts'. The unit config requires a literal
 * ".spec.ts", so these files are excluded from `npm test`. Naming them
 * *.int.spec.ts would silently pull database tests into the unit run.
 *
 * maxWorkers 1: pg_advisory_xact_lock keys are database-wide, so parallel
 * workers would interfere with lock tests. Concurrency within a test is then
 * explicit, which is what actually exercises the lock.
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': '<rootDir>/test/esm-transformer.cjs',
  },
  testEnvironment: 'node',
  transformIgnorePatterns: [
    'node_modules[/\\\\](?!(openid-client|oauth4webapi|jose)[/\\\\])',
  ],
  globalSetup: '<rootDir>/test/int/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/test/int/setup-after-env.ts'],
  maxWorkers: 1,
  testTimeout: 30000,
};

export default config;
