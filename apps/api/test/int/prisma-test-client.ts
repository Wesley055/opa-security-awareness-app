import { PrismaClient } from '@prisma/client';
import { loadTestEnv } from './env';
import { firstRow } from './rows';

const resolved = loadTestEnv();

export const TEST_DB_NAME = resolved.dbName;
export const TEST_DB_URL = resolved.url;

/**
 * datasourceUrl rather than datasources.db so this does not depend on the
 * datasource block in schema.prisma being named `db`.
 */
export const prismaTest = new PrismaClient({ datasourceUrl: resolved.url });

/** A second client, for tests that need genuinely concurrent connections. */
export function makeTestClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: resolved.url });
}

let databaseVerified = false;

async function assertTestDatabase(): Promise<void> {
  if (databaseVerified) return;

  const rows = await prismaTest.$queryRawUnsafe<{ db: string }[]>(
    'SELECT current_database() AS db',
  );
  const live = firstRow(rows).db;

  if (live !== TEST_DB_NAME || !live.endsWith('_test')) {
    throw new Error(
      'REFUSING TO TRUNCATE: connected to "' + live + '", expected "' +
        TEST_DB_NAME +
        '".',
    );
  }

  databaseVerified = true;
}

/**
 * Truncates every public table except _prisma_migrations. Truncating that
 * one would make every later run re-apply migrations into a populated
 * database. Enumerated from pg_tables so new models are covered.
 */
export async function truncateAll(): Promise<void> {
  await assertTestDatabase();

  const rows = await prismaTest.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' " +
      "AND tablename <> '_prisma_migrations' ORDER BY tablename",
  );

  if (rows.length === 0) return;

  const list = rows.map((r) => '"public"."' + r.tablename + '"').join(', ');

  await prismaTest.$executeRawUnsafe(
    'TRUNCATE TABLE ' + list + ' RESTART IDENTITY CASCADE',
  );
}
