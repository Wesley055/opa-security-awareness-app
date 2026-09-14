"use strict";
// Parse only complete Jest reports. Process exit and collection are independent outcomes.
const path = require("node:path");
function reports(text) {
  const found = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    for (
      let start = line.indexOf("{");
      start >= 0;
      start = line.indexOf("{", start + 1)
    ) {
      try {
        const value = JSON.parse(line.slice(start));
        if (
          Array.isArray(value.testResults) &&
          Number.isInteger(value.numTotalTests)
        )
          found.push(value);
      } catch {
        /* Other console output is not a Jest report. */
      }
    }
  }
  // Jest normally emits one JSON line; also support an otherwise clean pretty report.
  if (!found.length) {
    try {
      const value = JSON.parse(String(text || ""));
      if (Array.isArray(value.testResults)) found.push(value);
    } catch {
      /* Fail closed below. */
    }
  }
  return found;
}
function collect(result, redact) {
  if (typeof redact !== "function") throw new Error("REDACTOR_REQUIRED");
  const stdout = redact(String(result.stdout || ""));
  const stderr = redact(String(result.stderr || ""));
  const base = {
    exitCode: result.status,
    signal: result.signal || null,
    collector: "FAIL",
    testOutcome: "UNKNOWN",
    stdout,
    stderr,
  };
  const candidates = reports(stdout);
  if (candidates.length !== 1)
    return {
      ...base,
      collectionError: candidates.length
        ? "AMBIGUOUS_REPORT"
        : "REPORT_UNAVAILABLE",
    };
  const j = candidates[0];
  const counts = [
    j.numTotalTests,
    j.numPassedTests,
    j.numFailedTests,
    j.numPendingTests,
    j.numTodoTests || 0,
  ];
  if (
    counts.some((n) => !Number.isInteger(n) || n < 0) ||
    counts[0] !== counts.slice(1).reduce((a, b) => a + b, 0) ||
    typeof j.success !== "boolean" ||
    !j.testResults.every(
      (s) =>
        s &&
        typeof s.name === "string" &&
        ["passed", "failed", "pending", "skipped", "focused"].includes(
          s.status,
        ) &&
        Array.isArray(s.assertionResults) &&
        s.assertionResults.every(
          (t) =>
            t &&
            typeof t.fullName === "string" &&
            [
              "passed",
              "failed",
              "pending",
              "todo",
              "skipped",
              "disabled",
            ].includes(t.status) &&
            (!t.failureMessages ||
              (Array.isArray(t.failureMessages) &&
                t.failureMessages.every((m) => typeof m === "string"))),
        ),
    ) ||
    (j.success && j.numFailedTests > 0)
  )
    return { ...base, collectionError: "INVALID_REPORT" };
  return {
    ...base,
    collector: "PASS",
    testOutcome: j.success ? "PASS" : "FAIL",
    total: counts[0],
    passed: counts[1],
    failed: counts[2],
    pending: counts[3],
    todo: counts[4],
    suites: j.testResults.map((s) => ({
      file: path.basename(s.name),
      status: s.status,
      message: s.message,
      tests: s.assertionResults.map((t) => ({
        name: t.fullName,
        status: t.status,
        failures: t.failureMessages || [],
      })),
    })),
  };
}
function scopeEnvironment(base, suites, lease, isolation) {
  const v = require("./staging-database-verifier.cjs");
  v.check(
    base.NODE_ENV === "test" && isolation === "private-postgres-only",
    "TEST_ISOLATION",
  );
  v.databaseUrl(base.DATABASE_URL, "test", lease);
  v.check(
    base.OPA_ENVIRONMENT !== "production" &&
      !base.WEBSITE_INSTANCE_ID &&
      !base.OPA_DEPLOYMENT_RESOURCE_ID &&
      !base.OPA_ENVIRONMENT_POLICY_FILE,
    "RUNTIME_ENVIRONMENT",
  );
  v.check(Array.isArray(suites) && suites.length > 0, "TEST_SUITES");
  const hasSso = suites.includes("sso.int-spec.ts");
  v.check(!hasSso || suites.length === 1, "SSO_PROCESS_ISOLATION");
  // Fixture-only process: mock IdP transport plus enforced OS egress denial.
  // The supplied object and parent process.env are never mutated.
  return {
    ...base,
    OPA_ENVIRONMENT: "development",
    OPA_SSO_ENABLED: hasSso ? "true" : "false",
  };
}
module.exports = { collect, scopeEnvironment };
