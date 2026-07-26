import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export const API_ROOT = path.resolve(__dirname, '..', '..');

export interface TestDbInfo {
  url: string;
  dbName: string;
}

/**
 * Resolves the integration-test database URL.
 *
 * Uses dotenv.parse, not dotenv.config: nothing already in process.env can
 * win, and behaviour does not depend on the `override` option, which older
 * dotenv versions lack.
 *
 * Refuses any database whose name does not end in _test. The harness
 * truncates every table it can see; the dev database holds Sprint 9 and 10A
 * data.
 */
export function loadTestEnv(): TestDbInfo {
  const envPath = path.join(API_ROOT, '.env.test.local');

  if (!fs.existsSync(envPath)) {
    throw new Error(
      'Missing apps/api/.env.test.local. From apps/api, run: ' +
        'node .\\scripts\\create-test-db.cjs',
    );
  }

  const parsedEnv = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  const url = parsedEnv.DATABASE_URL;

  if (!url) {
    throw new Error('.env.test.local does not define DATABASE_URL.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    throw new Error('DATABASE_URL in .env.test.local is not a parseable URL.');
  }

  const dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));

  if (!dbName.endsWith('_test')) {
    throw new Error(
      'REFUSING TO RUN INTEGRATION TESTS: resolved database is "' +
        dbName +
        '", which does not end in _test. The harness truncates every table ' +
        'it finds.',
    );
  }

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = parsedEnv.NODE_ENV || 'test';

  return { url, dbName };
}
