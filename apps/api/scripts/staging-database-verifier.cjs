"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "../../..");
const SERVER = "opa-pg-staging.postgres.database.azure.com";
const RUNTIME = "opa_staging";
const TEST = "opa_staging_test";
function check(value, code) {
  if (!value) throw new Error(code);
}
function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function manifest(root = ROOT) {
  const names = execFileSync(
    "git",
    [
      "-c",
      "safe.directory=" + root.replace(/\\/g, "/"),
      "ls-tree",
      "-r",
      "--name-only",
      "HEAD",
      "--",
      "apps/api/prisma/migrations",
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .trim()
    .split("\n")
    .filter((x) => x.endsWith("/migration.sql"))
    .sort();
  return names.map((file) => ({
    name: file.split("/").at(-2),
    checksum: hash(
      execFileSync(
        "git",
        [
          "-c",
          "safe.directory=" + root.replace(/\\/g, "/"),
          "show",
          "HEAD:" + file,
        ],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      ),
    ),
  }));
}
function manifestHash(rows) {
  return hash(JSON.stringify(rows));
}
function historyCheck(rows, expected) {
  check(rows.length === expected.length, "HISTORY_COUNT");
  const found = new Set();
  for (const row of rows) {
    const match = expected.find((x) => x.name === row.migration_name);
    check(
      match &&
        !found.has(row.migration_name) &&
        row.checksum === match.checksum &&
        row.finished_at &&
        !row.rolled_back_at &&
        row.applied_steps_count === 1,
      "HISTORY_MISMATCH",
    );
    found.add(row.migration_name);
  }
}
function testRole(lease) {
  check(/^[a-f0-9]{24}$/.test(lease), "LEASE");
  return "opa_staging_validation_" + lease;
}
function databaseUrl(value, kind, lease) {
  const u = new URL(value);
  check(
    u.protocol === "postgresql:" || u.protocol === "postgres:",
    "DATABASE_PROTOCOL",
  );
  check(
    u.hostname === SERVER && (!u.port || u.port === "5432") && !u.hash,
    "DATABASE_SERVER",
  );
  const expected = kind === "runtime" ? RUNTIME : kind === "test" ? TEST : null;
  check(
    expected && decodeURIComponent(u.pathname) === "/" + expected,
    "DATABASE_NAME",
  );
  check(
    decodeURIComponent(u.username) ===
      (kind === "runtime" ? "opa_staging_migrations" : testRole(lease)),
    "DATABASE_ROLE",
  );
  const keys = [...u.searchParams.keys()];
  check(
    new Set(keys).size === keys.length &&
      keys.every((k) =>
        ["sslmode", "schema", "connection_limit", "pool_timeout"].includes(k),
      ) &&
      (!u.searchParams.has("schema") ||
        u.searchParams.get("schema") === "public"),
    "DATABASE_OPTIONS",
  );
  check(
    Boolean(u.password) && u.searchParams.get("sslmode") === "require",
    "DATABASE_TLS",
  );
  return u;
}
function identityCheck(rows, database, role, source) {
  check(
    rows.length === 1 &&
      rows[0].database === database &&
      rows[0].role === role &&
      rows[0].address === source.split("/")[0],
    "DATABASE_IDENTITY_ADDRESS",
  );
}
async function identity(db, database, role, source) {
  identityCheck(
    (
      await db.query(
        "SELECT current_database() AS database,current_user AS role,host(inet_client_addr()) AS address",
      )
    ).rows,
    database,
    role,
    source,
  );
}
async function history(db) {
  const exists = (
    await db.query(
      "SELECT to_regclass('public._prisma_migrations') AS table_name",
    )
  ).rows[0].table_name;
  return exists
    ? (
        await db.query(
          "SELECT migration_name,checksum,finished_at,rolled_back_at,applied_steps_count FROM public._prisma_migrations ORDER BY started_at,migration_name",
        )
      ).rows
    : [];
}
async function runtimeSentinel(db) {
  const rows = (
    await db.query(
      "SELECT environment FROM opa_deployment.environment_identity WHERE singleton=true",
    )
  ).rows;
  check(
    rows.length === 1 && rows[0].environment === "staging",
    "RUNTIME_SENTINEL",
  );
}
async function testSentinel(db, sha, lease) {
  const rows = (
    await db.query(
      "SELECT environment,database_name,approved_sha,lease FROM opa_deployment.validation_identity WHERE singleton=true",
    )
  ).rows;
  check(
    rows.length === 1 &&
      rows[0].environment === "staging-test" &&
      rows[0].database_name === TEST &&
      rows[0].approved_sha === sha &&
      rows[0].lease === lease,
    "TEST_SENTINEL",
  );
}
async function baseline(db) {
  await runtimeSentinel(db);
  const tables = (
    await db.query(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' ORDER BY schemaname,tablename",
    )
  ).rows;
  const schemas = (
    await db.query(
      "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname",
    )
  ).rows;
  const rows = await history(db);
  check(
    rows.length === 0 &&
      tables.every(
        (x) =>
          (x.schemaname === "opa_deployment" &&
            x.tablename === "environment_identity") ||
          (x.schemaname === "public" && x.tablename === "_prisma_migrations"),
      ) &&
      schemas.every((x) => ["public", "opa_deployment"].includes(x.nspname)),
    "DATABASE_NOT_EMPTY",
  );
  check(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM opa_deployment.environment_identity",
      )
    ).rows[0].count === 1,
    "SENTINEL_ROWS",
  );
  return {
    tables,
    schemas,
    history: rows,
    migrationCount: 0,
    sizeBytes: (
      await db.query(
        "SELECT pg_database_size(current_database())::text AS bytes",
      )
    ).rows[0].bytes,
  };
}
async function schemaSanity(db) {
  const { Prisma } = require("@prisma/client");
  const columns = (
    await db.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'",
    )
  ).rows;
  for (const model of Prisma.dmmf.datamodel.models) {
    const table = model.dbName || model.name;
    for (const field of model.fields.filter((x) => x.kind !== "object"))
      check(
        columns.some(
          (x) =>
            x.table_name === table &&
            x.column_name === (field.dbName || field.name),
        ),
        "MODEL_COLUMN_MISSING",
      );
  }
  const index = (
    await db.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='journey_session_one_active_per_user'",
    )
  ).rows;
  check(
    index.length === 1 &&
      /UNIQUE/.test(index[0].indexdef) &&
      /STARTED/.test(index[0].indexdef) &&
      /ACTIVE/.test(index[0].indexdef) &&
      !/ENDED/.test(index[0].indexdef),
    "JOURNEY_INDEX",
  );
}
function committed(root, sha, expected) {
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "safe.directory=" + root.replace(/\\/g, "/"), ...args],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  check(git("rev-parse", "HEAD") === sha, "CHECKOUT_SHA");
  const paths = git(
    "ls-tree",
    "-r",
    "--name-only",
    sha,
    "--",
    "apps/api/prisma/migrations",
  )
    .split("\n")
    .filter((x) => x.endsWith("/migration.sql"));
  check(paths.length === 35 && expected.length === 35, "MIGRATION_COUNT");
  const actualDirectories = fs
    .readdirSync(path.join(root, "apps/api/prisma/migrations"), {
      withFileTypes: true,
    })
    .filter((x) => x.isDirectory())
    .map((x) => x.name)
    .sort();
  check(
    JSON.stringify(actualDirectories) ===
      JSON.stringify(expected.map((x) => x.name).sort()),
    "UNCOMMITTED_MIGRATION_DIRECTORY",
  );
  if (process.platform === "win32")
    git("diff", "--exit-code", sha, "--", "apps/api/prisma/migrations");
  for (const entry of expected) {
    const file = "apps/api/prisma/migrations/" + entry.name + "/migration.sql";
    if (process.platform !== "win32")
      check(
        hash(fs.readFileSync(path.join(root, file))) === entry.checksum,
        "RUNNER_MIGRATION_BYTES_CHANGED",
      );
    check(
      paths.includes(file) &&
        hash(
          execFileSync(
            "git",
            [
              "-c",
              "safe.directory=" + root.replace(/\\/g, "/"),
              "show",
              sha + ":" + file,
            ],
            {
              cwd: root,
              stdio: ["ignore", "pipe", "pipe"],
            },
          ),
        ) === entry.checksum,
      "MIGRATION_BYTES_CHANGED",
    );
  }
}
module.exports = {
  ROOT,
  SERVER,
  RUNTIME,
  TEST,
  check,
  hash,
  manifest,
  manifestHash,
  historyCheck,
  testRole,
  databaseUrl,
  identityCheck,
  identity,
  history,
  runtimeSentinel,
  testSentinel,
  baseline,
  schemaSanity,
  committed,
};
