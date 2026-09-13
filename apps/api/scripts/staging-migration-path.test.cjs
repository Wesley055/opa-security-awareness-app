"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const v = require("./staging-database-verifier.cjs"),
  g = require("./staging-migration-trigger.cjs"),
  c = require("./staging-validation-custodian.cjs");
const { controlledExecution } = require("./staging-migration-path.cjs");
const NOW = Date.now(),
  SHA = "a".repeat(40),
  PARENT = "b".repeat(40),
  LEASE = "c".repeat(24);
function fixture() {
  return {
    env: {
      GITHUB_REPOSITORY: g.REPO,
      GITHUB_REF: g.REF,
      GITHUB_EVENT_NAME: "push",
      GITHUB_SHA: SHA,
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      OPA_GITHUB_ENVIRONMENT: "staging",
    },
    event: {
      after: SHA,
      before: PARENT,
      ref: g.REF,
      repository: { full_name: g.REPO },
      forced: false,
      deleted: false,
    },
    t: {
      version: 1,
      mode: "migration",
      execute: false,
      environment: "staging",
      server: "opa-pg-staging",
      runtimeDatabase: v.RUNTIME,
      testDatabase: v.TEST,
      identity: "id-opa-staging-migrations",
      approvedParentSha: PARENT,
      executableShaBinding: "github-event-sha+signed-policy+runner-lease",
      lease: LEASE,
      expiresAt: new Date(NOW + 86400000).toISOString(),
      migrationChainSha256: "d".repeat(64),
    },
    lease: {
      id: LEASE,
      repository: g.REPO,
      approvedSha: SHA,
      mode: "migration-review",
      source: "172.27.240.2/32",
      expiresAt: new Date(NOW + 3000000).toISOString(),
      hostMounts: 0,
      cleanupOwner: "operator-host",
    },
  };
}
function valid(f) {
  return g.validate(f.env, f.event, f.t, f.lease, NOW);
}
test("review trigger resolves exact fixed targets with execution disabled", () =>
  assert.equal(valid(fixture()).execute, false));
for (const [key, value] of [
  ["GITHUB_REPOSITORY", "other/repo"],
  ["GITHUB_REF", "refs/heads/main"],
  ["GITHUB_EVENT_NAME", "workflow_dispatch"],
  ["OPA_GITHUB_ENVIRONMENT", "other"],
  ["GITHUB_SHA", "e".repeat(40)],
  ["GITHUB_RUN_ID", "bad"],
  ["GITHUB_RUN_ATTEMPT", "bad"],
])
  test("reject invocation " + key, () => {
    const f = fixture();
    f.env[key] = value;
    assert.throws(() => valid(f));
  });
for (const [key, value] of [
  ["after", "e".repeat(40)],
  ["before", "e".repeat(40)],
  ["ref", "refs/heads/main"],
  ["forced", true],
  ["deleted", true],
])
  test("reject event " + key, () => {
    const f = fixture();
    f.event[key] = value;
    assert.throws(() => valid(f));
  });
for (const [key, value] of [
  ["version", 2],
  ["mode", "auth-only"],
  ["execute", "true"],
  ["server", "other-server"],
  ["environment", "other"],
  ["runtimeDatabase", v.TEST],
  ["testDatabase", v.RUNTIME],
  ["identity", "other-identity"],
  ["executableShaBinding", "unbound"],
  ["lease", "bad"],
  ["expiresAt", new Date(NOW - 1).toISOString()],
  ["migrationChainSha256", "bad"],
])
  test("reject trigger " + key, () => {
    const f = fixture();
    f.t[key] = value;
    assert.throws(() => valid(f));
  });
for (const [key, value] of [
  ["id", "e".repeat(24)],
  ["repository", "other/repo"],
  ["approvedSha", "e".repeat(40)],
  ["mode", "migration"],
  ["source", "172.27.240.2/24"],
  ["source", "172.27.240.999/32"],
  ["source", "10.72.1.4/32"],
  ["hostMounts", 1],
  ["cleanupOwner", "job"],
  ["expiresAt", new Date(NOW - 1).toISOString()],
])
  test("reject lease " + key + " " + value, () => {
    const f = fixture();
    f.lease[key] = value;
    assert.throws(() => valid(f));
  });
test("execute requires additional exact-SHA authorization", () => {
  const f = fixture();
  f.t.execute = true;
  f.lease.mode = "migration";
  assert.throws(() => valid(f));
  f.env.OPA_STAGING_MIGRATION_AUTHORIZATION = JSON.stringify({
    sha: SHA,
    lease: LEASE,
    action: "MIGRATE_OPA_STAGING",
    expiresAt: new Date(NOW + 600000).toISOString(),
  });
  assert.equal(valid(f).execute, true);
  f.env.OPA_STAGING_MIGRATION_AUTHORIZATION =
    f.env.OPA_STAGING_MIGRATION_AUTHORIZATION.replace(SHA, PARENT);
  assert.throws(() => valid(f));
});
function url(kind) {
  return (
    "postgresql://" +
    (kind === "runtime" ? "opa_staging_migrations" : v.testRole(LEASE)) +
    ":synthetic@" +
    v.SERVER +
    ":5432/" +
    (kind === "runtime" ? v.RUNTIME : v.TEST) +
    "?sslmode=require" +
    (kind === "runtime" ? "&sslaccept=strict" : "")
  );
}
test("separate fixed database URLs accepted", () => {
  v.databaseUrl(url("runtime"), "runtime");
  v.databaseUrl(url("test"), "test", LEASE);
});
test("runtime accepts exact committed Prisma TLS option contract in either order", () => {
  const approved = url("runtime");
  v.databaseUrl(approved, "runtime");
  v.databaseUrl(
    approved.replace(
      "sslmode=require&sslaccept=strict",
      "sslaccept=strict&sslmode=require",
    ),
    "runtime",
  );
});
for (const [title, transform] of [
  ["unknown option", (u) => u + "&unknown=synthetic"],
  ["host override", (u) => u + "&host=example.invalid"],
  ["extra schema option", (u) => u + "&schema=public"],
  ["extra pool option", (u) => u + "&connection_limit=1"],
  ["duplicate strict option", (u) => u + "&sslaccept=strict"],
  ["duplicate TLS option", (u) => u + "&sslmode=require"],
  ["encoded duplicate option", (u) => u + "&ssl%61ccept=strict"],
  ["missing strict option", (u) => u.replace("&sslaccept=strict", "")],
  ["missing TLS option", (u) => u.replace("sslmode=require&", "")],
  [
    "invalid certificate bypass",
    (u) => u.replace("sslaccept=strict", "sslaccept=accept_invalid_certs"),
  ],
  [
    "unknown strict value",
    (u) => u.replace("sslaccept=strict", "sslaccept=other"),
  ],
  ["empty strict value", (u) => u.replace("sslaccept=strict", "sslaccept=")],
  ["TLS disabled", (u) => u.replace("sslmode=require", "sslmode=disable")],
  [
    "production server",
    (u) => u.replace("opa-pg-staging", "opa-pg-production"),
  ],
  [
    "production database",
    (u) => u.replace("/opa_staging?", "/opa_production?"),
  ],
  [
    "disposable database",
    (u) => u.replace("/opa_staging?", "/opa_staging_test?"),
  ],
  ["arbitrary database", (u) => u.replace("/opa_staging?", "/other?")],
  [
    "wrong identity",
    (u) => u.replace("opa_staging_migrations", "opa_staging_runtime"),
  ],
])
  test("runtime URL rejects " + title, () =>
    assert.throws(() => v.databaseUrl(transform(url("runtime")), "runtime")),
  );
for (const [title, transform] of [
  ["runtime URL used for tests", () => url("runtime")],
  ["other server", (u) => u.replace(v.SERVER, "example.invalid")],
  ["wrong role", (u) => u.replace(v.testRole(LEASE), "opa_staging_migrations")],
  ["runtime database", (u) => u.replace(v.TEST, v.RUNTIME)],
  ["arbitrary test database", (u) => u.replace(v.TEST, "other_test")],
  ["unsafe TLS", (u) => u.replace("require", "disable")],
  ["query host override", (u) => u + "&host=example.invalid"],
  ["duplicate TLS", (u) => u + "&sslmode=disable"],
  ["other schema", (u) => u + "&schema=other"],
])
  test("test URL rejects " + title, () =>
    assert.throws(() => v.databaseUrl(transform(url("test")), "test", LEASE)),
  );
const good = {
  database: v.RUNTIME,
  role: "opa_staging_migrations",
  address: "172.27.240.2",
};
test("identity exact address succeeds", () =>
  v.identityCheck([good], v.RUNTIME, good.role, "172.27.240.2/32"));
for (const wrong of [
  [],
  [good, good],
  [{ ...good, address: "172.27.240.3" }],
  [{ ...good, address: "172.27.240.2/32" }],
  [{ ...good, database: v.TEST }],
  [{ ...good, role: v.testRole(LEASE) }],
])
  test("identity rejects " + JSON.stringify(wrong), () =>
    assert.throws(() =>
      v.identityCheck(wrong, v.RUNTIME, good.role, "172.27.240.2/32"),
    ),
  );
const expected = [
  { name: "a", checksum: "1".repeat(64) },
  { name: "b", checksum: "2".repeat(64) },
];
function rows() {
  return expected.map((x) => ({
    migration_name: x.name,
    checksum: x.checksum,
    finished_at: new Date(),
    rolled_back_at: null,
    applied_steps_count: 1,
  }));
}
test("complete exact migration history accepted", () =>
  v.historyCheck(rows(), expected));
for (const [name, mutate] of [
  ["missing", (r) => r.pop()],
  ["duplicate", (r) => (r[1] = { ...r[0] })],
  ["checksum", (r) => (r[0].checksum = "x")],
  ["failed", (r) => (r[0].finished_at = null)],
  ["rolled back", (r) => (r[0].rolled_back_at = new Date())],
  ["steps", (r) => (r[0].applied_steps_count = 0)],
])
  test("history rejects " + name, () => {
    const r = rows();
    mutate(r);
    assert.throws(() => v.historyCheck(r, expected));
  });
function fakeBaseline(extra = false) {
  return {
    query: async (sql) => {
      assert.ok(sql.startsWith("SELECT"));
      if (sql.includes("SELECT environment"))
        return { rows: [{ environment: "staging" }] };
      if (sql.includes("FROM pg_tables"))
        return {
          rows: [
            { schemaname: "opa_deployment", tablename: "environment_identity" },
            ...(extra ? [{ schemaname: "public", tablename: "User" }] : []),
          ],
        };
      if (sql.includes("pg_namespace"))
        return { rows: [{ nspname: "public" }, { nspname: "opa_deployment" }] };
      if (sql.includes("to_regclass")) return { rows: [{ table_name: null }] };
      if (sql.includes("count(*)")) return { rows: [{ count: 1 }] };
      if (sql.includes("pg_database_size"))
        return { rows: [{ bytes: "8192" }] };
      throw Error("Unexpected query");
    },
  };
}
test("empty baseline is read-only", async () =>
  assert.equal((await v.baseline(fakeBaseline())).migrationCount, 0));
test("unexpected application table stops empty-database gate", async () =>
  assert.rejects(v.baseline(fakeBaseline(true)), /DATABASE_NOT_EMPTY/));
function ops(calls, fail) {
  return Object.fromEntries(
    [
      "beforeWrite",
      "migrateRuntime",
      "verifyRuntime",
      "createTest",
      "validateTest",
      "dropTest",
    ].map((name) => [
      name,
      async () => {
        calls.push(name);
        if (name === fail) throw new Error(name);
      },
    ]),
  );
}
test("review mode performs no mutation lifecycle calls", async () => {
  const calls = [];
  await controlledExecution({ execute: false }, ops(calls));
  assert.deepEqual(calls, []);
});
test("real migration failure stops before test creation", async () => {
  const calls = [];
  await assert.rejects(
    controlledExecution({ execute: true }, ops(calls, "migrateRuntime")),
  );
  assert.deepEqual(calls, ["beforeWrite", "migrateRuntime"]);
});
test("real verification failure stops before test creation", async () => {
  const calls = [];
  await assert.rejects(
    controlledExecution({ execute: true }, ops(calls, "verifyRuntime")),
  );
  assert.deepEqual(calls, ["beforeWrite", "migrateRuntime", "verifyRuntime"]);
});
test("test failure cleans only disposable path", async () => {
  const calls = [];
  await assert.rejects(
    controlledExecution({ execute: true }, ops(calls, "validateTest")),
    /validateTest/,
  );
  assert.deepEqual(calls, [
    "beforeWrite",
    "migrateRuntime",
    "verifyRuntime",
    "createTest",
    "validateTest",
    "dropTest",
  ]);
});
test("test creation failure still requests disposable cleanup", async () => {
  const calls = [];
  await assert.rejects(
    controlledExecution({ execute: true }, ops(calls, "createTest")),
  );
  assert.equal(calls.at(-1), "dropTest");
});
test("cleanup failure does not hide original validation failure", async () => {
  const calls = [];
  const o = ops(calls, "validateTest");
  o.dropTest = async () => {
    throw Error("cleanup");
  };
  await assert.rejects(
    controlledExecution({ execute: true }, o),
    (e) => e.message === "validateTest" && e.cleanupFailed === true,
  );
});
const input = {
  action: "drop",
  sha: SHA,
  lease: LEASE,
  source: "172.27.240.2/32",
  expiresAt: new Date(NOW + 10000).toISOString(),
};
test("only owned disposable database can be dropped", () =>
  c.disposable(
    v.TEST,
    v.testRole(LEASE),
    JSON.stringify({ environment: "staging-test", sha: SHA, lease: LEASE }),
    input,
  ));
for (const [name, owner, marker] of [
  [v.RUNTIME, v.testRole(LEASE), ""],
  ["other_test", v.testRole(LEASE), ""],
  [v.TEST, "opa_staging_migrations", ""],
  [v.TEST, v.testRole(LEASE), "unrelated"],
])
  test("cleanup refuses " + name + " " + owner + " " + marker, () =>
    assert.throws(() => c.disposable(name, owner, marker, input)),
  );
test("expired owned lease can still be cleaned, never created", () => {
  const expired = { ...input, expiresAt: new Date(NOW - 60000).toISOString() };
  c.context(expired);
  assert.throws(() => c.context({ ...expired, action: "create" }));
});
test("arbitrary custodian action rejected", () =>
  assert.throws(() => c.context({ ...input, action: "reset" })));

test("validation mode requires distinct SHA-bound authorization and lease", () => {
  const f = fixture();
  f.t.mode = "validation";
  f.t.execute = true;
  f.lease.mode = "migration-validation";
  f.env.OPA_STAGING_MIGRATION_AUTHORIZATION = JSON.stringify({
    sha: SHA,
    lease: LEASE,
    action: "MIGRATE_OPA_STAGING",
    expiresAt: new Date(NOW + 600000).toISOString(),
  });
  assert.throws(() => valid(f));
  f.env.OPA_STAGING_MIGRATION_AUTHORIZATION =
    f.env.OPA_STAGING_MIGRATION_AUTHORIZATION.replace(
      "MIGRATE_OPA_STAGING",
      "VALIDATE_MIGRATED_OPA_STAGING",
    );
  assert.equal(valid(f).mode, "validation");
});
test("validation skips runtime migration and retains access through verification", async () => {
  const order = [];
  let access = true;
  await controlledExecution(
    { execute: true, mode: "validation" },
    {
      beforeWrite: async () => order.push("gate"),
      migrateRuntime: async () => {
        throw Error("FORBIDDEN");
      },
      verifyRuntime: async () => {
        assert(access);
        order.push("verify");
      },
      createTest: async () => order.push("create"),
      validateTest: async () => order.push("tests"),
      dropTest: async () => {
        order.push("drop");
        access = false;
      },
    },
  );
  assert.deepEqual(order, ["gate", "verify", "create", "tests", "drop"]);
});
test("migrated verification uses only reads and rollback", async () => {
  const statements = [];
  const expected = [{ name: "migration", checksum: "hash" }];
  const db = {
    query: async (sql) => {
      statements.push(sql);
      if (sql.startsWith("SHOW"))
        return { rows: [{ transaction_read_only: "on" }] };
      if (sql.includes("host(inet_client_addr"))
        return {
          rows: [
            {
              database: v.RUNTIME,
              role: "opa_staging_migrations",
              address: "172.27.240.2",
            },
          ],
        };
      if (sql.includes("SELECT environment"))
        return { rows: [{ environment: "staging" }] };
      if (sql.includes("to_regclass"))
        return { rows: [{ table_name: "_prisma_migrations" }] };
      if (sql.includes("SELECT migration_name"))
        return {
          rows: [
            {
              migration_name: "migration",
              checksum: "hash",
              finished_at: "now",
              rolled_back_at: null,
              applied_steps_count: 1,
            },
          ],
        };
      return { rows: [] };
    },
  };
  const proof = await v.verifyMigrated(
    db,
    expected,
    "172.27.240.2/32",
    async () => {},
  );
  assert.equal(proof.migrationCount, 1);
  assert.equal(statements[0], "BEGIN READ ONLY");
  assert.equal(statements.at(-1), "ROLLBACK");
  assert(
    statements.every((s) => /^(SELECT|SHOW|BEGIN READ ONLY|ROLLBACK)/.test(s)),
  );
  await assert.rejects(
    v.verifyMigrated(
      db,
      [{ name: "wrong", checksum: "hash" }],
      "172.27.240.2/32",
      async () => {},
    ),
  );
  assert.equal(statements.at(-1), "ROLLBACK");
});
