import {
  preflight,
  readPolicy,
  hash,
  type Diagnostic,
} from "../../../../../packages/environment-policy/index.cjs";
import { PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
let diagnostic: Diagnostic | undefined;
export function environmentDiagnostic(): Diagnostic {
  if (!diagnostic) throw new Error("Environment preflight has not completed");
  return { ...diagnostic };
}
export async function verifyDatabase(
  client: PrismaClient,
  allowPending = false,
  purpose: "api" | "migration" = "api",
): Promise<boolean> {
  const identity = await client.$queryRaw<
    Array<{ environment: string; database_name: string; role_name: string }>
  >`SELECT environment, current_database() AS database_name, current_user AS role_name FROM opa_deployment.environment_identity WHERE singleton = true`;
  const policy = readPolicy(
    process.env.OPA_ENVIRONMENT_POLICY_FILE,
    process.env.OPA_ENVIRONMENT!,
    purpose,
  );
  const database = policy.resources.database;
  if (
    identity.length !== 1 ||
    identity[0]?.environment !== process.env.OPA_ENVIRONMENT ||
    identity[0]?.database_name !== database.database ||
    identity[0]?.role_name !== database.role
  )
    throw new Error("Database identity rejected");
  const present = await client.$queryRaw<
    Array<{ present: string | null }>
  >`SELECT to_regclass('public._prisma_migrations')::text AS present`;
  if (!present[0]?.present) {
    if (allowPending) return false;
    throw new Error("Migrations pending");
  }
  const rows = await client.$queryRaw<
    Array<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>
  >`SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations`;
  const folder = resolve(__dirname, "../../../prisma/migrations");
  const expected = new Map(
    readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => [
        d.name,
        hash(readFileSync(resolve(folder, d.name, "migration.sql"), "utf8")),
      ]),
  );
  const active = rows.filter((r) => !r.rolled_back_at);
  if (
    active.some(
      (r) => !r.finished_at || expected.get(r.migration_name) !== r.checksum,
    ) ||
    new Set(active.map((r) => r.migration_name)).size !== active.length
  )
    throw new Error("Migration history rejected");
  const ready = active.length === expected.size;
  if (!ready && !allowPending) throw new Error("Migrations pending");
  return ready;
}
export async function initializeEnvironment(
  allowPending = false,
  purpose: "api" | "migration" = "api",
): Promise<void> {
  config();
  diagnostic = preflight(process.env, purpose);
  if (diagnostic.environment !== "development") {
    const client = new PrismaClient();
    try {
      await client.$connect();
      diagnostic.migrationReadiness = (await verifyDatabase(
        client,
        allowPending,
        purpose,
      ))
        ? "ready"
        : "pending";
    } finally {
      await client.$disconnect();
    }
  }
  console.info("[OPA-ENVIRONMENT]", JSON.stringify(diagnostic));
}
