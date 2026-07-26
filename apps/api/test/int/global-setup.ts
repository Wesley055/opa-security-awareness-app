import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { API_ROOT, loadTestEnv } from './env';
import { firstRow } from './rows';
import {
  assertProductionSchema,
  countMigrationDirectories,
  getServerVersion,
} from './assert-schema';

/**
 * Uses `prisma migrate deploy`, never `db push`. deploy replays the real
 * migration files, the only way the hand-added partial index exists here.
 * db push would drop it, and the one-active-session test would then pass
 * against a schema that does not match production.
 */
export default async function globalSetup(): Promise<void> {
  const { url, dbName } = loadTestEnv();

  console.log('\n[int-harness] target database: ' + dbName);

  execSync('npx prisma migrate deploy', {
    cwd: API_ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { DATABASE_URL: url }),
  });

  const prisma = new PrismaClient({ datasourceUrl: url });

  try {
    const dbRows = await prisma.$queryRawUnsafe<{ db: string }[]>(
      'SELECT current_database() AS db',
    );

    if (firstRow(dbRows).db !== dbName) {
      throw new Error(
        'migrate deploy ran against "' + firstRow(dbRows).db + '", not "' + dbName + '".',
      );
    }

    const version = await getServerVersion(prisma);
    console.log('[int-harness] postgres ' + version);

    await assertProductionSchema(prisma);

    console.log(
      '[int-harness] ' +
        countMigrationDirectories() +
        ' migrations applied; partial index semantics verified\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}
