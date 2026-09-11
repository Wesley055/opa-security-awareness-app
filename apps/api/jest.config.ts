import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': '<rootDir>/test/esm-transformer.cjs',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  transformIgnorePatterns: [
    'node_modules[/\\\\](?!(openid-client|oauth4webapi|jose)[/\\\\])',
  ],
};

export default config;
