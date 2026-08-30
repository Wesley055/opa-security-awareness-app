import { prismaTest, TEST_DB_NAME, truncateAll } from './prisma-test-client';
import { firstRow } from './rows';
import {
  assertMigrationsFullyApplied,
  assertPartialIndex,
  countMigrationDirectories,
  getServerVersion,
} from './assert-schema';

describe('integration harness', () => {
  it('is connected to the dedicated test database', async () => {
    const rows = await prismaTest.$queryRawUnsafe<{ db: string }[]>(
      'SELECT current_database() AS db',
    );

    expect(firstRow(rows).db).toBe(TEST_DB_NAME);
    expect(firstRow(rows).db.endsWith('_test')).toBe(true);
  });

  it('reports a postgres server version', async () => {
    const version = await getServerVersion(prismaTest);
    expect(version).toMatch(/^\d+/);
  });

  it('has every migration on disk applied, none half-applied', async () => {
    await expect(
      assertMigrationsFullyApplied(prismaTest),
    ).resolves.toBeUndefined();

    expect(countMigrationDirectories()).toBeGreaterThan(0);
  });

  it('kept the partial unique index with its exact semantics', async () => {
    const def = await assertPartialIndex(prismaTest);

    expect(def).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(def).toContain('"userId"');
    expect(def).toMatch(/\bWHERE\b/i);
    expect(def).toContain('STARTED');
    expect(def).toContain('ACTIVE');
    expect(def).not.toContain('ENDED');
  });

  it('kept the incident notification contact/channel partial unique index with its exact semantics', async () => {
    const rows = await prismaTest.$queryRawUnsafe<{ indexdef: string }[]>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'IncidentNotification'
        AND indexname = 'IncidentNotification_incidentId_contactId_channel_key'
    `);

    expect(rows).toHaveLength(1);

    const def = firstRow(rows).indexdef;

    expect(def).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(def).toContain('"incidentId"');
    expect(def).toContain('"contactId"');
    expect(def).toMatch(/\(?["']?channel["']?\)?/i);
    expect(def).toMatch(/\bWHERE\b/i);
    expect(def).toMatch(/"contactId"\s+IS\s+NOT\s+NULL/i);
  });

  it('truncates cleanly and preserves _prisma_migrations', async () => {
    await truncateAll();

    expect(await prismaTest.journeySession.count()).toBe(0);

    const rows = await prismaTest.$queryRawUnsafe<{ count: number }[]>(
      "SELECT COUNT(*)::int AS count FROM _prisma_migrations",
    );

    expect(Number(firstRow(rows).count)).toBe(countMigrationDirectories());
  });
});
