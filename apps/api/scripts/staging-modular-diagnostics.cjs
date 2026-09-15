"use strict";
const records = new WeakMap();
const guards = new Set([
  "CUSTODIAN_ACTION",
  "DATABASE_IDENTITY_ADDRESS",
  "DATABASE_NAME",
  "DATABASE_NOT_EMPTY",
  "DATABASE_OPTIONS",
  "DATABASE_PROTOCOL",
  "DATABASE_ROLE",
  "DATABASE_SERVER",
  "DATABASE_TLS",
  "GATE_ABSENCE",
  "GATE_ALREADY_EXISTS",
  "GATE_BOOTSTRAP_ACCESS",
  "GATE_BOOTSTRAP_SECRET",
  "GATE_BUILD",
  "GATE_CHECKOUT",
  "GATE_CHILD_CLEANUP",
  "GATE_CLEANUP",
  "GATE_CLEANUP_FAILED",
  "GATE_CONNECT_TARGET",
  "GATE_CONTEXT",
  "GATE_CREATE",
  "GATE_DATABASE",
  "GATE_DATABASE_EXISTS",
  "GATE_DATABASE_URL",
  "GATE_DROP_OWNERSHIP",
  "GATE_DROP_VERIFY",
  "GATE_EXCLUSIVE_LEASE",
  "GATE_FAILED",
  "GATE_HISTORY_ORDER",
  "GATE_HOST",
  "GATE_IDENTITY",
  "GATE_LEASE_EXPIRY",
  "GATE_MIGRATE",
  "GATE_MIGRATIONS",
  "GATE_MIGRATION_FAILED",
  "GATE_NAME",
  "GATE_NPM_VERSION",
  "GATE_ORDER",
  "GATE_POLICY_BINDINGS",
  "GATE_POLICY_EXPIRY",
  "GATE_POLICY_NETWORK",
  "GATE_POLICY_SELECTION",
  "GATE_POLICY_TARGET",
  "GATE_PRISMA_VERSION",
  "GATE_PRIVATE_DNS",
  "GATE_READINESS_EVIDENCE",
  "GATE_ROLE_DROP_VERIFY",
  "GATE_ROLE_OWNERSHIP",
  "GATE_RUNTIME_ACCESS",
  "GATE_SCHEMA_PARITY",
  "GATE_SECRET_FINGERPRINT",
  "GATE_SELECTION",
  "GATE_SENTINEL_BINDING",
  "GATE_SOURCE",
  "GATE_SOURCE_CHANGED",
  "GATE_TLS_STRICT",
  "GIT_CHECK",
  "HISTORY_COUNT",
  "HISTORY_MISMATCH",
  "MIGRATION_BYTES_CHANGED",
  "MIGRATION_COUNT",
  "MIGRATION_MANIFEST",
  "PREFLIGHT_AUTHORITY",
  "PREFLIGHT_BINDING",
  "PREFLIGHT_FRESHNESS",
  "PREFLIGHT_PROOF",
  "PREFLIGHT_RECEIPT",
  "READ_ONLY_REQUIRED",
  "RECEIPT_BINDING",
  "RECEIPT_DIRECTORY",
  "RECEIPT_INTEGRITY",
  "RECEIPT_METADATA",
  "RECEIPT_MIGRATIONS",
  "RECEIPT_READINESS",
  "RECEIPT_SUITES",
  "RECEIPT_TESTS",
  "RECEIPT_WRITE",
  "RUNTIME_CLOSE",
  "RUNTIME_CONNECT",
  "RUNTIME_IDENTITY",
  "RUNTIME_SENTINEL",
  "RUNTIME_VERIFY",
  "TEST_COVERAGE",
  "TEST_SENTINEL",
]);
const operations = Object.freeze([
  "INPUT",
  "POLICY",
  "HOST",
  "CHECKOUT",
  "MANIFEST",
  "FINGERPRINT",
  "DNS",
  "IDENTITY",
  "VAULT",
  "BOOTSTRAP_SECRET",
  "TOOLCHAIN",
  "RECEIPT_DIRECTORY",
  "MIGRATION_MANIFEST",
  "ADMIN_CONNECT",
  "LOCK",
  "BUILD_GENERATE",
  "BUILD_VALIDATE",
  "BUILD_API",
  "RUNTIME_CONNECT",
  "RUNTIME_IDENTITY",
  "RUNTIME_VERIFY",
  "RUNTIME_CLOSE",
  "SCHEMA_PARITY",
  "PREFLIGHT_RECEIPT",
  "AUTHORIZATION",
  "SOURCE_RECHECK",
  "GATE_ABSENCE",
  "GATE_CREATE",
  "GATE_MIGRATE",
  "GATE_VERIFY",
  "READINESS_INITIALIZATION",
  "SUITE",
  "RESULT_COLLECTION",
  "GATE_CLEANUP",
  "RECEIPT_WRITE",
  "UNLOCK",
  "FINAL_CLEANUP",
  "ARTIFACT_WRITE",
]);
const systemCodes = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EACCES",
  "EPERM",
  "ENOENT",
  "EEXIST",
  "ENOSPC",
  "ENOMEM",
  "ABORT_ERR",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);
const classes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "TimeoutError",
  "PrismaClientInitializationError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
]);
const signals = new Set(["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGINT"]);
function classify(error, operation, durationMs = 0, outcome = {}) {
  if (!operations.includes(operation)) operation = "INPUT";
  let origin = outcome.error || error;
  for (let depth = 0; depth < 4 && origin?.cause && !origin.code; depth++)
    origin = origin.cause;
  const code = typeof origin?.code === "string" ? origin.code : "";
  const prismaCode = /^P[0-9]{4}$/.test(code)
    ? code
    : /^P[0-9]{4}$/.test(outcome.prismaCode || "")
      ? outcome.prismaCode
      : null;
  const sqlstate =
    /^(?:08|22|23|25|28|40|42|53|54|55|57|58|XX)[A-Z0-9]{3}$/.test(code)
      ? code
      : null;
  const errorClass = classes.has(error?.constructor?.name)
    ? error.constructor.name
    : "Error";
  const timeout =
    ["ETIMEDOUT", "ABORT_ERR"].includes(code) ||
    ["AbortError", "TimeoutError"].includes(errorClass);
  const transport = ["ENOTFOUND", "EAI_AGAIN"].includes(code)
    ? "DNS"
    : ["ECONNREFUSED", "ECONNRESET"].includes(code)
      ? "TCP"
      : /TLS|CERT|SIGNATURE/.test(code) && systemCodes.has(code)
        ? "TLS"
        : timeout
          ? "TIMEOUT"
          : null;
  return {
    version: 1,
    stage: operation,
    substage: operation.split("_").slice(1).join("_") || operation,
    operationId: "modular." + operation.toLowerCase(),
    exceptionClass: errorClass,
    errorCode:
      systemCodes.has(code) || sqlstate
        ? code
        : prismaCode
          ? prismaCode
          : guards.has(error?.message)
            ? error.message
            : "UNKNOWN_" + operation,
    exitCode: Number.isInteger(outcome.status) ? outcome.status : null,
    signal: signals.has(outcome.signal) ? outcome.signal : null,
    durationMs: Math.max(
      0,
      Math.round(
        Number.isFinite(outcome.durationMs)
          ? outcome.durationMs
          : Number.isFinite(durationMs)
            ? durationMs
            : 0,
      ),
    ),
    timeoutClassification: timeout ? "TIMEOUT" : "NOT_ESTABLISHED",
    prismaCode,
    sqlstate,
    httpStatus:
      Number.isInteger(outcome.httpStatus) &&
      outcome.httpStatus >= 100 &&
      outcome.httpStatus <= 599
        ? outcome.httpStatus
        : null,
    transportClassification: transport,
    resourceClassification: [
      "ENOMEM",
      "ENOSPC",
      "EACCES",
      "EPERM",
      "ENOENT",
      "EEXIST",
    ].includes(code)
      ? code
      : null,
    readinessClassification:
      operation === "READINESS_INITIALIZATION"
        ? "PRE_TEST_ONLY"
        : "NOT_REACHED_OR_NOT_APPLICABLE",
    cleanupOutcome: "PENDING",
  };
}
function tracker() {
  let operation = "INPUT",
    since = Date.now(),
    primary,
    outcome = {},
    cleanup = "PENDING";
  const timeline = [];
  let writer = null;
  return {
    setWriter(fn) {
      writer = fn;
    },
    persist(report) {
      if (!writer) return "UNAVAILABLE";
      try {
        writer(report);
        return "PASS";
      } catch {
        return "FAIL";
      }
    },
    mark(next) {
      if (!operations.includes(next)) throw new Error("DIAGNOSTIC_OPERATION");
      operation = next;
      since = Date.now();
      outcome = {};
      timeline.push({
        operationId: "modular." + next.toLowerCase(),
        at: new Date().toISOString(),
      });
    },
    outcome(value) {
      outcome = value;
    },
    capture(error) {
      if (!primary)
        primary = classify(error, operation, Date.now() - since, outcome);
      if (error && typeof error === "object") records.set(error, primary);
      return primary;
    },
    cleanup(value) {
      if (!["PASS", "FAIL", "NOT_REQUIRED"].includes(value))
        throw new Error("DIAGNOSTIC_CLEANUP");
      if (cleanup !== "FAIL") cleanup = value;
      if (primary) primary.cleanupOutcome = cleanup;
    },
    report(error) {
      const failure = this.capture(error);
      return {
        ...failure,
        cleanupOutcome: cleanup,
        timeline: timeline.slice(),
      };
    },
    get cleanupOutcome() {
      return cleanup;
    },
    get timeline() {
      return timeline.slice();
    },
  };
}
function failure(error) {
  return records.get(error) || classify(error, "INPUT");
}
function register(error, report) {
  records.set(error, report);
}
module.exports = { operations, classify, tracker, failure, register };
