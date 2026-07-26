import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { API_ROOT } from './env';
import { firstRow } from './rows';

export const PARTIAL_INDEX = 'journey_session_one_active_per_user';

type RawClient = Pick<PrismaClient, '$queryRawUnsafe'>;

/** Number of real migration directories on disk. */
export function countMigrationDirectories(): number {
  const dir = path.join(API_ROOT, 'prisma', 'migrations');

  if (!fs.existsSync(dir)) {
    throw new Error('No prisma/migrations directory at ' + dir);
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(path.join(dir, entry.name, 'migration.sql')),
    ).length;
}

export async function getServerVersion(prisma: RawClient): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(
    "SELECT current_setting('server_version') AS v",
  );
  return firstRow(rows).v;
}

/**
 * Every migration directory must be applied, and none may be half-applied.
 * Derived from disk rather than hardcoded so adding a migration does not
 * require editing a test.
 */
export async function assertMigrationsFullyApplied(
  prisma: RawClient,
): Promise<void> {
  const expected = countMigrationDirectories();

  const unfinished = await prisma.$queryRawUnsafe<{ count: number }[]>(
    "SELECT COUNT(*)::int AS count FROM _prisma_migrations " +
      "WHERE finished_at IS NULL",
  );

  if (Number(firstRow(unfinished).count) > 0) {
    throw new Error(
      Number(firstRow(unfinished).count) +
        ' migration(s) in the test database are unfinished. The database is ' +
        'in a partially-applied state; drop it and re-bootstrap.',
    );
  }

  const applied = await prisma.$queryRawUnsafe<{ count: number }[]>(
    "SELECT COUNT(*)::int AS count FROM _prisma_migrations " +
      "WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
  );

  if (Number(firstRow(applied).count) !== expected) {
    throw new Error(
      'Migration mismatch: ' +
        expected +
        ' migration directories on disk but ' +
        Number(firstRow(applied).count) +
        ' applied in the test database.',
    );
  }
}

/**
 * The partial unique index cannot be expressed in schema.prisma, so Prisma
 * cannot see it and a future generated migration can emit DROP INDEX for it.
 * This is the mechanical defence.
 *
 * Checking only for existence plus a WHERE clause is not enough: an index
 * narrowed to WHERE status = STARTED would still pass that, while permitting
 * two ACTIVE sessions for one user. Semantics are asserted, not just shape.
 */
export async function assertPartialIndex(prisma: RawClient): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<
    { indexdef: string; tablename: string }[]
  >(
    "SELECT indexdef, tablename FROM pg_indexes " +
      "WHERE schemaname = 'public' AND indexname = '" + PARTIAL_INDEX + "'",
  );

  if (rows.length === 0) {
    throw new Error(
      'The partial unique index ' +
        PARTIAL_INDEX +
        ' is missing. Either migrate deploy did not replay the hand-added ' +
        'SQL, or a later migration dropped it.',
    );
  }

  const def = firstRow(rows).indexdef;

  if (firstRow(rows).tablename !== 'JourneySession') {
    throw new Error(
      PARTIAL_INDEX + ' is on table ' + firstRow(rows).tablename + ', not JourneySession.',
    );
  }

  const required = [
    { name: 'UNIQUE', pattern: /CREATE\s+UNIQUE\s+INDEX/i },
    { name: '"userId" column', pattern: /"userId"/ },
    { name: 'WHERE clause', pattern: /\bWHERE\b/i },
    { name: 'STARTED in predicate', pattern: /STARTED/ },
    { name: 'ACTIVE in predicate', pattern: /ACTIVE/ },
  ];

  const missing = required
    .filter((check) => !check.pattern.test(def))
    .map((check) => check.name);

  if (missing.length > 0) {
    throw new Error(
      PARTIAL_INDEX +
        ' no longer has the expected semantics. Missing: ' +
        missing.join(', ') +
        '. Actual definition: ' +
        def,
    );
  }

  // ENDED must NOT be in the predicate: including it would forbid a user
  // from ever having more than one ended session.
  if (/ENDED/.test(def)) {
    throw new Error(
      PARTIAL_INDEX +
        ' includes ENDED in its predicate, which would forbid more than one ' +
        'ended session per user. Actual definition: ' +
        def,
    );
  }

  return def;
}

/** Everything the test database must satisfy before any test is trusted. */
export async function assertProductionSchema(
  prisma: RawClient,
): Promise<void> {
  await assertMigrationsFullyApplied(prisma);
  await assertPartialIndex(prisma);
}
