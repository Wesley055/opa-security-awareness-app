import { createRequire } from "node:module";
const loadNodeModule = createRequire(__filename);
import { PrismaClient } from "@prisma/client";
import { loadTestEnv } from "./env";
import { firstRow } from "./rows";
import * as fs from "node:fs";
const readiness = loadNodeModule("../../scripts/staging-readiness.cjs");

const resolved = loadTestEnv();

export const TEST_DB_NAME = resolved.dbName;
export const TEST_DB_URL = resolved.url;

/**
 * datasourceUrl rather than datasources.db so this does not depend on the
 * datasource block in schema.prisma being named `db`.
 */
export const prismaTest = new PrismaClient({ datasourceUrl: resolved.url });

/** A second client, for tests that need genuinely concurrent connections. */
const preparedClients: PrismaClient[] = [];
const ownedClients: PrismaClient[] = [];
export function makeTestClient(): PrismaClient {
  if (process.env.OPA_STAGING_GATE) {
    const client = preparedClients.shift();
    if (!client) throw new Error("PRETEST_CLIENT_NOT_PREPARED");
    return client;
  }
  return new PrismaClient({ datasourceUrl: resolved.url });
}
export async function closePreparedConnections(): Promise<void> {
  preparedClients.length = 0;
  const pending = ownedClients.splice(0).map((client) => client.$disconnect());
  const results = await Promise.allSettled(pending);
  if (results.some((result) => result.status === "rejected"))
    throw new Error("PRETEST_CLIENT_CLEANUP");
}

let databaseVerified = false;
/** Run by the outer beforeEach, before truncation and all fixture hooks. */
export async function prepareTestConnection(): Promise<void> {
  const session = readiness.session({
    emit: (event: Record<string, unknown>) => {
      if (process.env.OPA_STAGING_READINESS_FILE) {
        fs.appendFileSync(
          process.env.OPA_STAGING_READINESS_FILE,
          JSON.stringify(event) + "\n",
          { mode: 0o600 },
        );
      }
    },
  });
  try {
    await session.connect(prismaTest);
    if (process.env.OPA_STAGING_GATE) {
      const suites = [
        "advisory-lock",
        "incident-lifecycle-concurrency",
        "incident-timeline-concurrency",
        "journey-session-concurrency",
      ].map((name) => name + ".int-spec.ts");
      if (suites.includes(process.env.OPA_STAGING_SUITE || "")) {
        for (let i = 0; i < 2; i++) {
          const client = new PrismaClient({ datasourceUrl: resolved.url });
          ownedClients.push(client);
          await session.connect(client);
          preparedClients.push(client);
        }
      }
    }
    // Identity queries are outside the retry loop and always fail closed.
    databaseVerified = false;
    await session.verifyIdentity(assertTestDatabase());
    session.beginFixtures();
  } finally {
    session.close();
  }
}

async function assertTestDatabase(): Promise<void> {
  if (databaseVerified) return;

  const rows = await prismaTest.$queryRawUnsafe<{ db: string }[]>(
    "SELECT current_database() AS db",
  );
  const live = firstRow(rows).db;

  if (live !== TEST_DB_NAME || !live.endsWith("_test")) {
    throw new Error(
      'REFUSING TO TRUNCATE: connected to "' +
        live +
        '", expected "' +
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

  const list = rows.map((r) => '"public"."' + r.tablename + '"').join(", ");

  await prismaTest.$executeRawUnsafe(
    "TRUNCATE TABLE " + list + " RESTART IDENTITY CASCADE",
  );
}
