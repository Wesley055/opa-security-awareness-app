"use strict";
const { Buffer } = require("node:buffer");
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const runner = require("./staging-gate-runner.cjs"),
  g = require("./staging-gates.cjs"),
  cust = require("./staging-gate-custodian.cjs");
const scope =
  "/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/rg-opa-staging";
function policy() {
  return {
    build: "a".repeat(40),
    lease: "b".repeat(24),
    source: "10.72.4.4/32",
    repository: "Wesley055/opa-security-awareness-app",
    branch: "integration/institutional-security",
    execute: true,
    mode: "disposable-validation",
    server: "opa-pg-staging.postgres.database.azure.com",
    runtimeDatabase: "opa_staging",
    identity:
      scope +
      "/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-opa-staging-migrations",
    productionAssignments: 0,
    productionRoutes: 0,
    publicVmIp: false,
    subnet:
      scope +
      "/providers/Microsoft.Network/virtualNetworks/vnet-opa-staging/subnets/snet-opa-staging-runner",
    region: "southafricanorth",
    privatePostgres: "10.72.1.4",
    privateVault: "10.72.2.4",
    isolation: "private-postgres-only",
    notifications: "disabled",
    sso: "synthetic-only",
    cleanupOwner: "operator-host",
    runtimeSecretSha256: "c".repeat(64),
    manifestHash: g.hash(g.manifest),
    gates: g.ORDER,
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
  };
}
test("signed policy required; untrusted envelope cannot execute", () => {
  assert.throws(() =>
    runner.policy({
      payload: Buffer.from(JSON.stringify(policy())).toString("base64"),
      keyId: "untrusted",
      signature: "x",
    }),
  );
});
test("policy pins candidate, staging identity, targets, private path, isolation and no production", () => {
  runner.policyFields(policy());
  for (const [key, value] of Object.entries({
    branch: "main",
    execute: false,
    build: "HEAD",
    source: "10.72.4.0/28",
    identity: "production",
    runtimeDatabase: "opa_production",
    productionAssignments: 1,
    productionRoutes: 1,
    publicVmIp: true,
    privatePostgres: "1.1.1.1",
    notifications: "live",
    sso: "true",
    isolation: "internet",
    manifestHash: "d".repeat(64),
    gates: ["security", "database"],
    expiresAt: "2000-01-01T00:00:00Z",
  })) {
    assert.throws(
      () => runner.policyFields({ ...policy(), [key]: value }),
      key,
    );
  }
});
test("custodian refuses wrong owner/marker and never issues DROP", async () => {
  const c = {
      sha: "a".repeat(40),
      lease: "b".repeat(24),
      source: "10.72.4.4/32",
      gate: "database",
    },
    queries = [];
  const admin = {
    query: async (sql) => {
      queries.push(sql);
      return {
        rows: [{ datname: g.database(c), owner: "other", marker: "other" }],
      };
    },
  };
  await assert.rejects(cust.operate(admin, null, c, "drop"), /OWNERSHIP/);
  assert.ok(!queries.some((q) => q.startsWith("DROP")));
});
test("cleanup verifies database absence before role removal", async () => {
  const c = {
      sha: "a".repeat(40),
      lease: "b".repeat(24),
      source: "10.72.4.4/32",
      gate: "database",
    },
    b = cust.binding(c),
    queries = [];
  let dropped = false;
  const admin = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.startsWith("DROP DATABASE")) {
        dropped = true;
        return { rows: [] };
      }
      if (sql.includes("FROM pg_database"))
        return {
          rows: dropped
            ? []
            : [{ datname: b.name, owner: b.role, marker: b.marker }],
        };
      return { rows: [] };
    },
  };
  const proof = await cust.operate(admin, null, c, "drop");
  assert.equal(proof.databaseAbsent, true);
  assert.equal(proof.roleAbsent, true);
  assert.equal(queries.filter((q) => q.includes("FROM pg_database")).length, 2);
});
test("failed drop verification blocks role removal", async () => {
  const c = {
      sha: "a".repeat(40),
      lease: "b".repeat(24),
      source: "10.72.4.4/32",
      gate: "database",
    },
    b = cust.binding(c),
    queries = [];
  const admin = {
    query: async (sql) => {
      queries.push(sql);
      return {
        rows: sql.includes("FROM pg_database")
          ? [{ datname: b.name, owner: b.role, marker: b.marker }]
          : [],
      };
    },
  };
  await assert.rejects(cust.operate(admin, null, c, "drop"), /DROP_VERIFY/);
  assert.ok(!queries.some((q) => q.startsWith("DROP ROLE")));
});
test("source hooks place connection readiness before truncation without changing any assertion suite", () => {
  const setup = fs.readFileSync(
    path.join(path.dirname(module.filename), "../test/int/setup-after-env.ts"),
    "utf8",
  );
  assert.ok(
    setup.indexOf("await prepareTestConnection()") <
      setup.indexOf("await truncateAll()"),
  );
  const client = fs.readFileSync(
    path.join(
      path.dirname(module.filename),
      "../test/int/prisma-test-client.ts",
    ),
    "utf8",
  );
  assert.ok(client.includes("PRETEST_CLIENT_NOT_PREPARED"));
  assert.ok(client.includes("Promise.allSettled"));
});
test("process diagnostics discard raw stderr, stdout, URL and secret values", () => {
  const r = runner.cleanResult({
    status: 1,
    signal: null,
    stderr: "postgresql://user:secret@host/db P1001",
    stdout: "SELECT pii",
  });
  assert.deepEqual(r.prismaCodes, ["P1001"]);
  assert.ok(!JSON.stringify(r).includes("secret"));
  assert.ok(!JSON.stringify(r).includes("SELECT"));
});

test("unowned existing role cannot be removed when database is absent", async () => {
  const c = {
      sha: "a".repeat(40),
      lease: "b".repeat(24),
      source: "10.72.4.4/32",
      gate: "database",
    },
    queries = [];
  const admin = {
    query: async (sql) => {
      queries.push(sql);
      return {
        rows: sql.includes("FROM pg_roles")
          ? [{ rolname: "existing", marker: "unrelated" }]
          : [],
      };
    },
  };
  await assert.rejects(
    cust.operate(admin, null, c, "drop"),
    /GATE_ROLE_OWNERSHIP/,
  );
  assert.ok(!queries.some((q) => q.startsWith("DROP ROLE")));
});
