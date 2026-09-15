"use strict";
const { URL } = require("node:url");
const { structuredClone } = globalThis;
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const g = require("./staging-gates.cjs"),
  v = require("./staging-database-verifier.cjs");
const c = {
  sha: "a".repeat(40),
  lease: "b".repeat(24),
  source: "10.72.4.4/32",
};
const all = g.manifest.gates.flatMap((g) => g.suites.map((s) => s.file));
function result(file) {
  const s = g.manifest.gates
    .flatMap((g) => g.suites)
    .find((s) => s.file === file);
  return {
    collector: "PASS",
    exitCode: 0,
    signal: null,
    testOutcome: "PASS",
    total: s.tests.length,
    passed: s.tests.length,
    failed: 0,
    pending: 0,
    todo: 0,
    suites: [
      {
        file,
        status: "passed",
        tests: s.tests.map((name) => ({ name, status: "passed" })),
      },
    ],
  };
}
function fake(overrides = {}) {
  const log = [],
    receipts = [],
    failures = [];
  return {
    log,
    receipts,
    failures,
    adapter: {
      lock: async () => {
        log.push("lock");
        return async () => log.push("unlock");
      },
      preflight: async () => log.push("preflight"),
      assertAbsent: async (c) => log.push("absent:" + g.database(c)),
      create: async (c) => log.push("create:" + c.gate),
      migrateAndVerify: async () => ({
        count: 35,
        failed: 0,
        checksums: "PASS",
        manifestHash: "c".repeat(64),
      }),
      suite: async (c, file) => {
        log.push("suite:" + c.gate);
        return {
          result: result(file),
          readiness: [
            { event: "ready", attempt: 1, code: null, durationMs: 1 },
          ],
        };
      },
      cleanup: async (c) => log.push("cleanup:" + c.gate),
      receipt: async (r) => receipts.push(r),
      failure: async (r) => failures.push(r),
      ...overrides,
    },
  };
}
test("exact 20 source suites and 213 unique assertion IDs map once", () => {
  const files = fs
    .readdirSync(path.join(path.dirname(module.filename), "../test/int"))
    .filter((n) => n.endsWith(".int-spec.ts"));
  assert.equal(g.inventory(files), true);
  assert.deepEqual(
    g.manifest.gates.map((g) => g.count),
    [9, 69, 70, 6, 50, 9],
  );
  assert.equal(
    g.manifest.gates.flatMap((g) => g.suites.flatMap((s) => s.tests)).length,
    213,
  );
});
test("omission and duplicates fail", () => {
  assert.throws(() => g.inventory(all.slice(1)));
  assert.throws(() => g.inventory([...all, all[0]]));
  const m = structuredClone(g.manifest);
  m.gates[0].suites[0].tests[0] = m.gates[0].suites[0].tests[1];
  assert.throws(() => g.inventory(all, m));
});
test("every approved test identifier required, even if total unchanged", () => {
  const f = all[0],
    r = result(f);
  r.suites[0].tests[0].name = "replacement";
  assert.throws(() => g.suiteResult(f, r), /ASSERTION_COVERAGE/);
});
test("unexpected suite, missing assertions, skipped, failed and nonzero process rejected", () => {
  for (const change of [
    (r) => (r.exitCode = 1),
    (r) => (r.failed = 1),
    (r) => (r.pending = 1),
    (r) => r.suites.push(r.suites[0]),
    (r) => r.suites[0].tests.pop(),
  ]) {
    const r = result(all[0]);
    change(r);
    assert.throws(() => g.suiteResult(all[0], r));
  }
});
test("derived exact database blocks runtime, production, arbitrary prefixes and wrong SHA", () => {
  const ctx = { ...c, gate: "database" },
    name = g.database(ctx);
  assert.ok(name.startsWith("opa_staging_test_database_"));
  assert.ok(name.endsWith("_test"));
  assert.ok(name.length <= 63);
  for (const n of [
    "opa_staging",
    "opa_production",
    "opa_staging_test_bad",
    name.replace("aaaaaaaaaaaa", "dddddddddddd"),
  ])
    assert.throws(() => g.exactDatabase(n, ctx));
});
test("new URL guard keeps server, role, TLS, duplicate and option guards", () => {
  const ctx = { ...c, gate: "security" },
    u = new URL(
      "postgresql://" +
        v.SERVER +
        ":5432/" +
        g.database(ctx) +
        "?sslmode=require&sslaccept=strict",
    );
  u.username = v.testRole(c.lease);
  u.password = "synthetic";
  g.databaseUrl(u.toString(), ctx);
  for (const mutate of [
    (u) => (u.hostname = "production.example"),
    (u) => (u.pathname = "/opa_staging"),
    (u) => (u.username = "admin"),
    (u) => u.searchParams.set("sslmode", "disable"),
    (u) => u.searchParams.append("sslmode", "require"),
    (u) => u.searchParams.append("sslaccept", "strict"),
    (u) => u.searchParams.set("unknown", "x"),
  ]) {
    const bad = new URL(u);
    mutate(bad);
    assert.throws(() => g.databaseUrl(bad.toString(), ctx));
  }
});
test("legacy guard still rejects modular name", () => {
  const u = new URL(
    "postgresql://" +
      v.SERVER +
      "/" +
      g.database({ ...c, gate: "database" }) +
      "?sslmode=require&sslaccept=strict",
  );
  u.username = v.testRole(c.lease);
  u.password = "synthetic";
  assert.throws(
    () => v.databaseUrl(u.toString(), "test", c.lease),
    /DATABASE_NAME/,
  );
});
test("six gates serial, fresh database each, cleanup before next and 213 accounted", async () => {
  const f = fake(),
    r = await g.run(c, f.adapter);
  assert.equal(r.total, 213);
  assert.equal(f.receipts.length, 6);
  assert.equal(new Set(f.log.filter((x) => x.startsWith("absent:"))).size, 6);
  for (let i = 1; i < 6; i++)
    assert.ok(
      f.log.indexOf("cleanup:" + g.ORDER[i - 1]) <
        f.log.indexOf("create:" + g.ORDER[i]),
    );
  assert.equal(f.log.at(-1), "unlock");
});
test("cleanup failure stops before next create and prevents successful receipt", async () => {
  const f = fake({
    cleanup: async () => {
      throw Error("cleanup");
    },
  });
  await assert.rejects(g.run(c, f.adapter), /GATE_CLEANUP_FAILED/);
  assert.equal(f.receipts.length, 0);
  assert.equal(f.failures[0].cleanup, "FAIL");
  assert.ok(!f.log.includes("create:security"));
  assert.equal(f.log.at(-1), "unlock");
});
test("suite failure retained, cleanup runs and no retry", async () => {
  let attempts = 0;
  const f = fake({
    suite: async () => {
      attempts++;
      throw Error("SUITE_FAILED");
    },
  });
  await assert.rejects(g.run(c, f.adapter));
  assert.equal(attempts, 1);
  assert.ok(f.log.includes("cleanup:database"));
  assert.equal(f.failures.length, 1);
});
test("partial create failure invokes ownership-checked cleanup", async () => {
  const f = fake({
    create: async () => {
      throw Error("CREATE_FAILED");
    },
  });
  await assert.rejects(g.run(c, f.adapter));
  assert.ok(f.log.includes("cleanup:database"));
});
test("candidate binding, tampering, omission, overlap and duplicate receipts rejected", async () => {
  const f = fake();
  await g.run(c, f.adapter);
  assert.throws(() => g.aggregate(f.receipts, "d".repeat(40)));
  assert.throws(() => g.aggregate(f.receipts.slice(1), c.sha));
  for (const mutation of [
    (rs) => rs[0].passed--,
    (rs) => (rs[1] = rs[0]),
    (rs) => {
      const b = g.integrity(rs[1]);
      b.startedAt = "2000-01-01T00:00:00Z";
      rs[1] = g.seal(b);
    },
  ]) {
    const rs = structuredClone(f.receipts);
    mutation(rs);
    assert.throws(() => g.aggregate(rs, c.sha));
  }
});
test("receipt write refuses overwrite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opa-receipt-"));
  try {
    const f = path.join(dir, "r.json");
    g.writeOnce(f, { ok: true });
    assert.throws(() => g.writeOnce(f, { ok: false }), /EEXIST/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("focused gate is independent, cannot imply six-gate approval", async () => {
  const f = fake(),
    r = await g.run(c, f.adapter, ["safety"]);
  assert.equal(r.length, 1);
  assert.equal(r[0].actual, 70);
  assert.throws(() => g.aggregate(r, c.sha));
});
test("recovered readiness retained in receipt and arbitrary secret fields rejected", async () => {
  const f = fake({
    suite: async (c, file) => ({
      result: result(file),
      readiness: [
        { event: "failed", attempt: 1, code: "P1001", durationMs: 5 },
        { event: "recovered", attempt: 2, code: null, durationMs: 1 },
      ],
    }),
  });
  await g.run(c, f.adapter, ["database"]);
  assert.equal(f.receipts[0].readiness[0].event, "failed");
  assert.equal(f.receipts[0].readiness[1].event, "recovered");
  assert.throws(() =>
    g.readinessEvent({
      event: "secret",
      attempt: 1,
      code: "password",
      durationMs: 1,
    }),
  );
});
test("wrong order rejected before lock", async () => {
  const f = fake();
  await assert.rejects(
    g.run(c, f.adapter, ["admin", "database"]),
    /GATE_SELECTION/,
  );
  assert.equal(f.log.length, 0);
});
