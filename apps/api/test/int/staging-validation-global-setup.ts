import { createRequire } from "node:module";
const loadNodeModule = createRequire(__filename);
import { PrismaClient } from "@prisma/client";
import { loadTestEnv } from "./env";
import { assertProductionSchema } from "./assert-schema";
const verifier = loadNodeModule("../../scripts/staging-database-verifier.cjs");
export default async function setup(): Promise<void> {
  const { url, dbName } = loadTestEnv();
  const gates = loadNodeModule("../../scripts/staging-gates.cjs");
  const gateContext = process.env.OPA_STAGING_GATE
    ? gates.environment(process.env)
    : undefined;
  if (
    dbName !== (gateContext ? gates.database(gateContext) : "opa_staging_test")
  )
    throw new Error("Staging test database required");
  if (gateContext) gates.databaseUrl(url, gateContext);
  else
    verifier.databaseUrl(url, "test", process.env.OPA_STAGING_VALIDATION_LEASE);
  const { Client } = loadNodeModule("pg");
  const parsed = new URL(url);
  const db = new Client(
    gateContext
      ? {
          host: verifier.SERVER,
          port: 5432,
          database: dbName,
          user: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password),
          ssl: { rejectUnauthorized: true, servername: verifier.SERVER },
          connectionTimeoutMillis: 5000,
        }
      : { connectionString: url },
  );
  await db.connect();
  try {
    await verifier.identity(
      db,
      dbName,
      verifier.testRole(process.env.OPA_STAGING_VALIDATION_LEASE),
      process.env.OPA_STAGING_VALIDATION_SOURCE,
    );
    await verifier.testSentinel(
      db,
      process.env.OPA_STAGING_VALIDATION_SHA,
      process.env.OPA_STAGING_VALIDATION_LEASE,
      gateContext,
    );
    verifier.historyCheck(await verifier.history(db), verifier.manifest());
    const allowed = await db.query(
      "SELECT has_database_privilege(current_user,'opa_staging','CONNECT') AS allowed",
    );
    if (allowed.rows[0].allowed)
      throw new Error("Validation role can access runtime database");
  } finally {
    await db.end();
  }
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await assertProductionSchema(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
