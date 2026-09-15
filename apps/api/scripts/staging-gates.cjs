"use strict";
const { URL } = require("node:url");
const crypto = require("node:crypto");
const fs = require("node:fs");
const manifest = require("./staging-gates.json");
const v = require("./staging-database-verifier.cjs");
const ORDER = Object.freeze([
  "database",
  "security",
  "safety",
  "incident",
  "delivery",
  "admin",
]);
const COUNTS = [9, 69, 70, 6, 50, 9];
function canonical(x) {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
const hash = (x) =>
  crypto
    .createHash("sha256")
    .update(typeof x === "string" ? x : canonical(x))
    .digest("hex");
function gate(name) {
  const g = manifest.gates.find((g) => g.name === name);
  v.check(g, "GATE_NAME");
  return g;
}
function context(c) {
  v.check(
    c &&
      /^[a-f0-9]{40}$/.test(c.sha || "") &&
      /^[a-f0-9]{24}$/.test(c.lease || "") &&
      c.source === "10.72.4.4/32",
    "GATE_CONTEXT",
  );
  gate(c.gate);
  return c;
}
function database(c) {
  context(c);
  // Retain the existing integration harness's _test suffix assertion as well.
  return "opa_staging_test_" + c.gate + "_" + c.sha.slice(0, 12) + "_test";
}
function exactDatabase(name, c) {
  v.check(name === database(c) && name.length <= 63, "GATE_DATABASE");
  return name;
}
function environment(env) {
  return context({
    gate: env.OPA_STAGING_GATE,
    sha: env.OPA_STAGING_VALIDATION_SHA,
    lease: env.OPA_STAGING_VALIDATION_LEASE,
    source: env.OPA_STAGING_VALIDATION_SOURCE,
  });
}
function databaseUrl(value, c) {
  context(c);
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("GATE_DATABASE_URL");
  }
  exactDatabase(decodeURIComponent(u.pathname.slice(1)), c);
  v.check(
    u.searchParams.get("sslaccept") === "strict" &&
      u.searchParams.getAll("sslaccept").length === 1,
    "GATE_TLS_STRICT",
  );
  const legacy = new URL(u);
  legacy.searchParams.delete("sslaccept");
  legacy.pathname = "/" + v.TEST;
  v.databaseUrl(legacy.toString(), "test", c.lease);
  return u;
}
function inventory(files, m = manifest) {
  const names = m.gates.flatMap((g) => g.suites.map((s) => s.file));
  v.check(
    JSON.stringify(m.gates.map((g) => g.name)) === JSON.stringify(ORDER),
    "GATE_ORDER",
  );
  v.check(
    new Set(names).size === 20 &&
      names.length === 20 &&
      JSON.stringify([...names].sort()) === JSON.stringify([...files].sort()),
    "SUITE_COVERAGE",
  );
  for (const [i, g] of m.gates.entries()) {
    const ids = g.suites.flatMap((s) => s.tests.map((t) => s.file + ":" + t));
    v.check(
      g.count === COUNTS[i] &&
        ids.length === g.count &&
        new Set(ids).size === ids.length,
      "TEST_COVERAGE",
    );
  }
  v.check(
    m.total === 213 && m.gates.reduce((n, g) => n + g.count, 0) === 213,
    "TOTAL_COVERAGE",
  );
  return true;
}
function suiteResult(file, r) {
  const expected = manifest.gates
    .flatMap((g) => g.suites)
    .find((s) => s.file === file);
  v.check(
    expected &&
      r.collector === "PASS" &&
      r.exitCode === 0 &&
      !r.signal &&
      r.testOutcome === "PASS" &&
      r.failed === 0 &&
      r.pending === 0 &&
      r.todo === 0,
    "SUITE_FAILED",
  );
  v.check(
    r.suites.length === 1 &&
      r.suites[0].file === file &&
      r.suites[0].status === "passed",
    "SUITE_SCOPE",
  );
  const actual = r.suites[0].tests;
  v.check(
    actual.length === expected.tests.length &&
      r.total === actual.length &&
      r.passed === actual.length &&
      actual.every((t) => t.status === "passed") &&
      JSON.stringify(actual.map((t) => t.name).sort()) ===
        JSON.stringify([...expected.tests].sort()),
    "ASSERTION_COVERAGE",
  );
  // Store approved test IDs only, never raw messages, stdout or SQL.
  return {
    file,
    count: actual.length,
    passed: actual.length,
    failed: 0,
    skipped: 0,
    testIds: expected.tests.map((t) => hash(file + ":" + t)),
  };
}
function seal(value) {
  return { ...value, evidenceHash: hash(value) };
}
function integrity(receipt) {
  const { evidenceHash, ...body } = receipt;
  v.check(evidenceHash === hash(body), "RECEIPT_INTEGRITY");
  return body;
}
function readinessEvent(e) {
  v.check(
    e &&
      ["failed", "ready", "recovered", "deadline", "cleanup-failed"].includes(
        e.event,
      ) &&
      Number.isInteger(e.attempt) &&
      e.attempt >= 1 &&
      e.attempt <= 3 &&
      [
        null,
        "P1001",
        "ETIMEDOUT",
        "ECONNRESET",
        "EAI_AGAIN",
        "NON_TRANSIENT",
      ].includes(e.code) &&
      Number.isFinite(e.durationMs) &&
      e.durationMs >= 0 &&
      e.durationMs <= 21000,
    "READINESS_EVIDENCE",
  );
  return {
    event: e.event,
    attempt: e.attempt,
    code: e.code,
    durationMs: e.durationMs,
  };
}
function validateReceipt(r, sha) {
  const b = integrity(r),
    g = gate(b.gate);
  v.check(
    b.version === 1 &&
      b.candidateSha === sha &&
      b.manifestHash === hash(manifest) &&
      b.result === "PASS" &&
      b.expected === g.count &&
      b.actual === g.count &&
      b.passed === g.count &&
      b.failed === 0 &&
      b.skipped === 0 &&
      b.cleanup === "PASS",
    "RECEIPT_BINDING",
  );
  v.check(
    b.migrations.count === 35 &&
      b.migrations.failed === 0 &&
      b.migrations.checksums === "PASS" &&
      /^[a-f0-9]{64}$/.test(b.migrations.manifestHash),
    "RECEIPT_MIGRATIONS",
  );
  v.check(
    JSON.stringify(b.suites.map((s) => s.file)) ===
      JSON.stringify(g.suites.map((s) => s.file)),
    "RECEIPT_SUITES",
  );
  for (const s of b.suites) {
    const e = g.suites.find((x) => x.file === s.file);
    v.check(
      s.count === e.tests.length &&
        s.passed === s.count &&
        s.failed === 0 &&
        s.skipped === 0 &&
        JSON.stringify(s.testIds) ===
          JSON.stringify(e.tests.map((t) => hash(s.file + ":" + t))),
      "RECEIPT_TESTS",
    );
  }
  v.check(
    Number.isFinite(Date.parse(b.startedAt)) &&
      Date.parse(b.endedAt) >= Date.parse(b.startedAt) &&
      /^[a-f0-9]{64}$/.test(b.databaseFingerprint),
    "RECEIPT_METADATA",
  );
  v.check(
    Array.isArray(b.readiness) &&
      b.readiness.every(
        (e) =>
          [
            "failed",
            "ready",
            "recovered",
            "deadline",
            "cleanup-failed",
          ].includes(e.event) &&
          Number.isInteger(e.attempt) &&
          e.attempt >= 1 &&
          e.attempt <= 3,
      ),
    "RECEIPT_READINESS",
  );
  b.readiness.forEach(readinessEvent);
  return b;
}
function aggregate(receipts, sha) {
  v.check(
    /^[a-f0-9]{40}$/.test(sha) && receipts.length === 6,
    "RELEASE_RECEIPTS",
  );
  const bodies = receipts.map((r) => validateReceipt(r, sha));
  v.check(
    JSON.stringify(bodies.map((r) => r.gate)) === JSON.stringify(ORDER),
    "RELEASE_ORDER",
  );
  v.check(
    new Set(bodies.map((r) => r.migrations.manifestHash)).size === 1 &&
      new Set(bodies.map((r) => r.databaseFingerprint)).size === 6,
    "RELEASE_CONTEXT",
  );
  for (let i = 1; i < 6; i++)
    v.check(
      Date.parse(bodies[i].startedAt) >= Date.parse(bodies[i - 1].endedAt),
      "RELEASE_OVERLAP",
    );
  return seal({
    version: 1,
    candidateSha: sha,
    result: "PASS",
    total: 213,
    failed: 0,
    skipped: 0,
    cleanup: "PASS",
    gateHashes: receipts.map((r) => r.evidenceHash),
  });
}
function writeOnce(file, value) {
  fs.writeFileSync(file, canonical(value) + "\n", { flag: "wx", mode: 0o600 });
}
// Supervisor owns network/VM cleanup. It must hold a server-wide exclusive lease
// through this call and certify cleanup before a successful receipt is emitted.
async function run(c, adapter, selected = ORDER) {
  v.check(
    selected.length > 0 &&
      selected.every((n) => ORDER.includes(n)) &&
      new Set(selected).size === selected.length &&
      JSON.stringify(selected) ===
        JSON.stringify(ORDER.filter((n) => selected.includes(n))),
    "GATE_SELECTION",
  );
  const release = await adapter.lock();
  const receipts = [];
  try {
    await adapter.preflight(c);
    for (const name of selected) {
      const ctx = context({ ...c, gate: name }),
        g = gate(name),
        startedAt = new Date().toISOString();
      const events = [],
        suites = [];
      let migrations,
        failure,
        cleanup = false;
      try {
        await adapter.assertAbsent(ctx);
        await adapter.create(ctx);
        migrations = await adapter.migrateAndVerify(ctx);
        v.check(
          migrations.count === 35 &&
            migrations.failed === 0 &&
            migrations.checksums === "PASS",
          "GATE_MIGRATIONS",
        );
        for (const s of g.suites) {
          const r = await adapter.suite(ctx, s.file);
          events.push(...r.readiness);
          suites.push(suiteResult(s.file, r.result));
        }
      } catch (e) {
        failure = e;
      } finally {
        try {
          await adapter.cleanup(ctx);
          cleanup = true;
        } catch {
          failure = Error("GATE_CLEANUP_FAILED");
        }
      }
      if (failure) {
        await adapter.failure({
          candidateSha: c.sha,
          gate: name,
          result: "FAIL",
          cleanup: cleanup ? "PASS" : "FAIL",
          completedSuites: suites,
          readiness: events,
          code: /^[A-Z_]{1,64}$/.test(failure.message)
            ? failure.message
            : "GATE_FAILED",
        });
        throw failure;
      }
      const receipt = seal({
        version: 1,
        candidateSha: c.sha,
        gate: name,
        manifestHash: hash(manifest),
        result: "PASS",
        expected: g.count,
        actual: suites.reduce((n, s) => n + s.count, 0),
        passed: g.count,
        failed: 0,
        skipped: 0,
        suites,
        readiness: events,
        migrations,
        startedAt,
        endedAt: new Date().toISOString(),
        databaseFingerprint: hash(database(ctx)),
        cleanup: "PASS",
      });
      validateReceipt(receipt, c.sha);
      await adapter.receipt(receipt);
      receipts.push(receipt);
    }
    return selected.length === 6 ? aggregate(receipts, c.sha) : receipts;
  } finally {
    await release();
  }
}
module.exports = {
  readinessEvent,
  ORDER,
  manifest,
  hash,
  gate,
  context,
  database,
  exactDatabase,
  environment,
  databaseUrl,
  inventory,
  suiteResult,
  seal,
  integrity,
  validateReceipt,
  aggregate,
  writeOnce,
  run,
};
