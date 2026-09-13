import { PrismaClient } from "@prisma/client";
import { loadTestEnv } from "./env";
import { assertProductionSchema } from "./assert-schema";
const verifier = require("../../scripts/staging-database-verifier.cjs");
export default async function setup(): Promise<void> {
  const { url, dbName } = loadTestEnv();
  if (dbName !== "opa_staging_test")
    throw new Error("Staging test database required");
  verifier.databaseUrl(url, "test", process.env.OPA_STAGING_VALIDATION_LEASE);
  const { Client } = require("pg");
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await verifier.identity(
      db,
      "opa_staging_test",
      verifier.testRole(process.env.OPA_STAGING_VALIDATION_LEASE),
      process.env.OPA_STAGING_VALIDATION_SOURCE,
    );
    await verifier.testSentinel(
      db,
      process.env.OPA_STAGING_VALIDATION_SHA,
      process.env.OPA_STAGING_VALIDATION_LEASE,
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
