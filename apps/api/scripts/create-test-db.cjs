#!/usr/bin/env node
/**
 * create-test-db.cjs — Sprint 10B integration-harness bootstrap.
 *
 * Creates the `<devdb>_test` database if it does not already exist, then writes
 * apps/api/.env.test.local and apps/api/.env.test.example.
 *
 * SAFETY PROPERTIES (deliberate, do not weaken):
 *   - Never drops, truncates, or alters anything. CREATE only.
 *   - Refuses to run if DATABASE_URL already ends in `_test` (would target the
 *     test database as if it were dev and derive `_test_test`).
 *   - Refuses to CREATE unless the admin connection reports
 *     current_database() = 'postgres', so a bad edit to adminUrl.pathname fails
 *     loudly instead of creating databases from the wrong maintenance context.
 *   - Verifies the database exists after CREATE by re-querying pg_database.
 *   - Verifies the generated test URL round-trips: re-parsed pathname must
 *     decode to exactly the expected database name.
 *   - Leaves an existing env file untouched.
 *   - NEVER prints a connection string. Output is safe to paste into chat.
 *     Database names and file paths only.
 *
 * Lives at apps/api/scripts/. Resolves the api root itself, so it works both
 * from apps/api/ and from apps/api/scripts/. Run it from apps/api so that
 * require('pg') resolves. .cjs extension so it runs regardless of any
 * "type": "module".
 */

const SCRIPT_VERSION = 'create-test-db v5 (2026-07-26, pg-based, relocatable)';

const fs = require('fs');
const path = require('path');

let Client;
try {
  ({ Client } = require('pg'));
} catch (err) {
  fail(
    'Could not require("pg"). This script must live in apps/api (module ' +
      'resolution starts at the script directory). Install with: ' +
      'npm i -D pg -w apps/api',
  );
}

function fail(message) {
  console.error('\nFAILED: ' + message + '\n');
  process.exit(1);
}

function ok(message) {
  console.log('  ok   ' + message);
}

function info(message) {
  console.log('  ..   ' + message);
}

/**
 * The script may sit at apps/api/ or apps/api/scripts/. Everything it reads and
 * writes (.env, .env.test.local, .env.test.example) belongs at the api root, so
 * resolve that once rather than scattering __dirname joins.
 */
const API_ROOT =
  path.basename(__dirname) === 'scripts' ? path.join(__dirname, '..') : __dirname;

/** Quote a Postgres identifier. Belt and braces: also whitelist-validated. */
function quoteIdent(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}

function loadEnv() {
  if (process.env.DATABASE_URL) {
    info('DATABASE_URL taken from the existing environment');
    return;
  }

  let dotenv;
  try {
    dotenv = require('dotenv');
  } catch (err) {
    fail('DATABASE_URL is not set and dotenv could not be required.');
  }

  const candidates = [
    path.join(API_ROOT, '.env'),
    path.join(API_ROOT, '..', '..', '.env'),
    path.join(process.cwd(), '.env'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    dotenv.config({ path: candidate });
    if (process.env.DATABASE_URL) {
      info('DATABASE_URL loaded from ' + candidate);
      return;
    }
  }

  fail(
    'DATABASE_URL is not set and was not found in any of:\n  ' +
      candidates.join('\n  '),
  );
}

async function main() {
  console.log('\n' + SCRIPT_VERSION);
  console.log('-'.repeat(SCRIPT_VERSION.length) + '\n');

  loadEnv();

  // ---- 1. Parse the dev URL, derive the test database name ----------------
  let devUrl;
  try {
    devUrl = new URL(process.env.DATABASE_URL);
  } catch (err) {
    fail('DATABASE_URL is not a parseable URL.');
  }

  const devDbName = decodeURIComponent(devUrl.pathname.replace(/^\//, ''));
  if (!devDbName) {
    fail('DATABASE_URL has no database name in its path.');
  }
  ok('dev database name: ' + devDbName);

  if (devDbName.endsWith('_test')) {
    fail(
      'DATABASE_URL already points at a database ending in "_test" (' +
        devDbName +
        '). This script derives the test database from the DEV url; running ' +
        'it against a test url would produce "' +
        devDbName +
        '_test". Point DATABASE_URL at the development database and re-run.',
    );
  }

  const testDbName = devDbName + '_test';
  if (!/^[A-Za-z0-9_]+$/.test(testDbName)) {
    fail(
      'Derived test database name is not a plain identifier: ' + testDbName,
    );
  }
  ok('test database name: ' + testDbName);

  // ---- 2. Admin connection to the maintenance database -------------------
  const adminUrl = new URL(devUrl.toString());
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });

  try {
    await client.connect();
  } catch (err) {
    fail(
      'Could not connect to the "postgres" maintenance database. Is the ' +
        'server running and does the DATABASE_URL user have access? ' +
        'Driver said: ' +
        err.message,
    );
  }

  try {
    // ---- 3. Guard: we must actually be in `postgres` ----------------------
    const ctx = await client.query('SELECT current_database() AS db');
    const currentDb = ctx.rows[0].db;
    if (currentDb !== 'postgres') {
      fail(
        'Admin connection landed in database "' +
          currentDb +
          '", not "postgres". Refusing to run CREATE DATABASE from the wrong ' +
          'maintenance context.',
      );
    }
    ok('admin connection is in the postgres maintenance database');

    // ---- 4. Create if absent (never drop) --------------------------------
    const before = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [testDbName],
    );

    if (before.rowCount > 0) {
      ok('database ' + testDbName + ' already exists — nothing created');
    } else {
      info('creating database ' + testDbName + ' ...');
      await client.query('CREATE DATABASE ' + quoteIdent(testDbName));

      // ---- 5. Verify it exists now ---------------------------------------
      const after = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [testDbName],
      );
      if (after.rowCount === 0) {
        fail(
          'CREATE DATABASE reported success but ' +
            testDbName +
            ' is not in pg_database.',
        );
      }
      ok('database ' + testDbName + ' created and verified present');
    }
  } finally {
    await client.end();
  }

  // ---- 6. Build the test URL and verify it round-trips -------------------
  const testUrl = new URL(devUrl.toString());
  testUrl.pathname = '/' + encodeURIComponent(testDbName);

  const reparsed = new URL(testUrl.toString());
  const reparsedDbName = decodeURIComponent(
    reparsed.pathname.replace(/^\//, ''),
  );
  if (reparsedDbName !== testDbName) {
    fail(
      'Generated test URL does not round-trip: its path decodes to "' +
        reparsedDbName +
        '" but should be "' +
        testDbName +
        '".',
    );
  }
  if (reparsed.hostname !== devUrl.hostname || reparsed.port !== devUrl.port) {
    fail('Generated test URL changed host or port. Refusing to write it.');
  }
  ok('generated test URL round-trips to ' + testDbName);

  // ---- 7. Write env files (never overwrite) ------------------------------
  const localPath = path.join(API_ROOT, '.env.test.local');
  const examplePath = path.join(API_ROOT, '.env.test.example');

  const localBody =
    '# Generated by ' +
    SCRIPT_VERSION +
    '\n' +
    '# Real credentials. Gitignored. Do not commit, do not paste into chat.\n' +
    'DATABASE_URL=' +
    testUrl.toString() +
    '\n' +
    'NODE_ENV=test\n';

  const exampleBody =
    '# Template for apps/api/.env.test.local — committed, no secrets.\n' +
    '# Must point at a database whose name ends in _test. The harness\n' +
    '# globalSetup refuses to run otherwise.\n' +
    'DATABASE_URL=\n' +
    'NODE_ENV=test\n';

  if (fs.existsSync(localPath)) {
    ok('.env.test.local already exists — left untouched');
  } else {
    fs.writeFileSync(localPath, localBody, { encoding: 'utf8' });
    ok('wrote .env.test.local (contents not printed)');
  }

  if (fs.existsSync(examplePath)) {
    ok('.env.test.example already exists — left untouched');
  } else {
    fs.writeFileSync(examplePath, exampleBody, { encoding: 'utf8' });
    ok('wrote .env.test.example');
  }

  // ---- 8. Exact next commands -------------------------------------------
  console.log('\nDone. Next commands, in order, from C:\\Projects\\OPA :\n');
  console.log('  git status --short');
  console.log('  git add apps/api/scripts/create-test-db.cjs');
  console.log(
    '  git commit -m "Sprint 10B: add idempotent opa_test bootstrap script"',
  );
  console.log('');
  console.log(
    '  Re-running this script is safe and is the intended check: it creates\n' +
      '  nothing that exists and overwrites no env file. A second run that\n' +
      '  reports "already exists" and "left untouched" proves idempotency.\n',
  );
}

main().catch((err) => {
  fail('Unexpected error: ' + (err && err.stack ? err.stack : err));
});
