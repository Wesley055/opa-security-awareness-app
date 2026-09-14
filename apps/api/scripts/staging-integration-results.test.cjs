"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  collect,
  scopeEnvironment,
} = require("./staging-integration-results.cjs");
const j = {
  numTotalTests: 2,
  numPassedTests: 1,
  numFailedTests: 1,
  numPendingTests: 0,
  success: false,
  testResults: [
    {
      name: "/tmp/sso.int-spec.ts",
      status: "failed",
      assertionResults: [
        {
          fullName: "synthetic denial",
          status: "failed",
          failureMessages: ["sensitive-material"],
        },
      ],
    },
  ],
};
const redact = (s) => s.replaceAll("sensitive-material", "[REDACTED]");
const run = (stdout, status = 1) =>
  collect({ stdout, stderr: "", status, signal: null }, redact);
test("retains exact mixed-output Jest outcomes separately from exit", () => {
  const r = run("console output\n" + JSON.stringify(j) + "\nfinished");
  assert.equal(r.collector, "PASS");
  assert.equal(r.failed, 1);
  assert.equal(r.exitCode, 1);
  assert.equal(r.testOutcome, "FAIL");
  assert.equal(r.suites[0].tests[0].failures[0], "[REDACTED]");
});
test("accepts valid success and pretty reports", () => {
  const r = run(
    JSON.stringify(
      { ...j, numPassedTests: 2, numFailedTests: 0, success: true },
      null,
      2,
    ),
    0,
  );
  assert.equal(r.collector, "PASS");
  assert.equal(r.testOutcome, "PASS");
});
test("exit failure is not rewritten by passing Jest report", () => {
  const r = run(
    JSON.stringify({
      ...j,
      numPassedTests: 2,
      numFailedTests: 0,
      success: true,
    }),
    1,
  );
  assert.equal(r.exitCode, 1);
  assert.equal(r.testOutcome, "PASS");
});
test("parser failure remains UNKNOWN, never a test result", () => {
  for (const code of [0, 1, null]) {
    const r = run("not JSON", code);
    assert.equal(r.collector, "FAIL");
    assert.equal(r.testOutcome, "UNKNOWN");
    assert.equal(r.exitCode, code);
  }
});
test("retained sanitized prior stderr preserves original 213/191/22 evidence", () => {
  const s = fs.readFileSync(
    path.join(__dirname, "fixtures/staging-integration-prior-summary.txt"),
    "utf8",
  );
  const r = collect({ stdout: "", stderr: s, status: 1 }, redact);
  assert.equal(r.testOutcome, "UNKNOWN");
  assert.match(r.stderr, /22 failed, 191 passed, 213 total/);
  assert.match(r.stderr, /FAIL test\/int\/sso/);
});
test("rejects ambiguous and inconsistent reports", () => {
  assert.equal(
    run(JSON.stringify(j) + "\n" + JSON.stringify(j)).collectionError,
    "AMBIGUOUS_REPORT",
  );
  assert.equal(
    run(JSON.stringify({ ...j, numTotalTests: 3 })).collectionError,
    "INVALID_REPORT",
  );
});
test("retains pending and todo counts", () => {
  const r = run(
    JSON.stringify({
      ...j,
      numTotalTests: 4,
      numPendingTests: 1,
      numTodoTests: 1,
    }),
  );
  assert.equal(r.pending, 1);
  assert.equal(r.todo, 1);
});
test("requires redaction and preserves signal", () => {
  assert.throws(() => collect({}, null));
  assert.equal(
    collect(
      { signal: "SIGTERM", stdout: "sensitive-material", status: null },
      redact,
    ).stdout,
    "[REDACTED]",
  );
});
const lease = "a".repeat(24),
  base = {
    NODE_ENV: "test",
    OPA_SSO_ENABLED: "false",
    DATABASE_URL: `postgresql://opa_staging_validation_${lease}:synthetic@opa-pg-staging.postgres.database.azure.com:5432/opa_staging_test?sslmode=require&schema=public&connection_limit=10`,
  };
test("SSO enables only independent disposable fixture env", () => {
  const r = scopeEnvironment(
    base,
    ["sso.int-spec.ts"],
    lease,
    "private-postgres-only",
  );
  assert.equal(r.OPA_SSO_ENABLED, "true");
  assert.equal(r.OPA_ENVIRONMENT, "development");
  assert.equal(base.OPA_SSO_ENABLED, "false");
  assert.equal(
    scopeEnvironment(
      base,
      ["safewalk-reconciliation.int-spec.ts"],
      lease,
      "private-postgres-only",
    ).OPA_SSO_ENABLED,
    "false",
  );
});
test("rejects mixed SSO process, runtime database, deployment env and missing isolation", () => {
  assert.throws(() =>
    scopeEnvironment(
      base,
      ["sso.int-spec.ts", "another"],
      lease,
      "private-postgres-only",
    ),
  );
  assert.throws(() =>
    scopeEnvironment(
      {
        ...base,
        DATABASE_URL: base.DATABASE_URL.replace(
          "/opa_staging_test",
          "/opa_staging",
        ),
      },
      ["sso.int-spec.ts"],
      lease,
      "private-postgres-only",
    ),
  );
  assert.throws(() =>
    scopeEnvironment(
      { ...base, WEBSITE_INSTANCE_ID: "runtime" },
      ["sso.int-spec.ts"],
      lease,
      "private-postgres-only",
    ),
  );
  assert.throws(() =>
    scopeEnvironment(base, ["sso.int-spec.ts"], lease, "unknown"),
  );
});

test("malformed suite/test fields fail collection without changing process outcome", () => {
  for (const testResults of [
    [{ assertionResults: [] }],
    [{ name: "x", status: "passed", assertionResults: [{}] }],
  ]) {
    const r = run(JSON.stringify({ ...j, testResults }));
    assert.equal(r.collector, "FAIL");
    assert.equal(r.testOutcome, "UNKNOWN");
    assert.equal(r.exitCode, 1);
  }
});
test("inconsistent success and explicit production environment fail closed", () => {
  assert.equal(run(JSON.stringify({ ...j, success: true })).collector, "FAIL");
  assert.throws(() =>
    scopeEnvironment(
      { ...base, OPA_ENVIRONMENT: "production" },
      ["sso.int-spec.ts"],
      lease,
      "private-postgres-only",
    ),
  );
});

test("retained live Jest focused status preserves selected and filtered counts", () => {
  const raw = fs.readFileSync(
    path.join(__dirname, "fixtures/staging-integration-focused-report.json"),
    "utf8",
  );
  const r = run(raw, 0);
  assert.equal(r.collector, "PASS");
  assert.equal(r.passed, 1);
  assert.equal(r.pending, 7);
  assert.equal(r.suites[0].status, "focused");
  assert.equal(r.exitCode, 0);
});
