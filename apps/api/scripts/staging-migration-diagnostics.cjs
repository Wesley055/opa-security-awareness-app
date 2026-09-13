"use strict";
const crypto = require("node:crypto");
const SQLSTATE_CLASSES = new Set(
  "00 01 02 03 08 09 0A 0B 0F 0L 0P 0Z 20 21 22 23 24 25 26 27 28 2B 2D 2F 34 38 39 3B 3D 3F 40 42 44 53 54 55 57 58 F0 HV P0 XX".split(
    " ",
  ),
);
const isSqlstate = (value) =>
  typeof value === "string" &&
  /^[0-9A-Z]{5}$/.test(value) &&
  SQLSTATE_CLASSES.has(value.slice(0, 2));
const STAGES = [
  "environment-preflight",
  "resource-binding-verification",
  "database-connectivity",
  "prisma-command-start",
  "prisma-command-exit",
  "migration-history-verification",
  "checksum-verification",
  "prisma-validate",
  "cleanup",
];
function sanitize(text, secrets = []) {
  let value = String(text || "");
  for (const secret of secrets.filter(
    (s) => typeof s === "string" && s.length,
  )) {
    for (const part of [
      secret,
      encodeURIComponent(secret),
      crypto.createHash("sha256").update(secret).digest("hex"),
    ])
      value = value.split(part).join("[REDACTED]");
  }
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, "[REDACTED_URI]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:[a-z0-9_]*(?:password|passwd|secret|token|connection_string|database_url|accountkey|username|host)[a-z0-9_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;,]+)/gi,
      "[REDACTED_FIELD]",
    )
    .replace(/([?&][a-z0-9_%.-]+=)[^&\s]*/gi, "$1[REDACTED]");
}
function codes(text, secrets = [], errorCode) {
  const safe = sanitize(text, secrets);
  const prisma = safe.match(
    /\b(?:Error\s*:\s*|error_code["'\s:=]*)(P\d{4})\b/i,
  );
  const state = safe.match(
    /\b(?:SQLSTATE|database error code|postgres(?:ql)?(?: error)? code)\s*[:=]?\s*["']?([0-9A-Z]{5})\b/i,
  );
  const pg =
    isSqlstate(errorCode) &&
    !/^P\d{4}$/.test(errorCode) &&
    !secrets.includes(errorCode)
      ? errorCode
      : null;
  return {
    prismaCode: prisma ? prisma[1].toUpperCase() : null,
    sqlstate:
      state && isSqlstate(state[1].toUpperCase()) ? state[1].toUpperCase() : pg,
    stderrClass: /permission denied|insufficient privilege/i.test(safe)
      ? "permission-denied"
      : /timed? out|timeout/i.test(safe)
        ? "timeout"
        : /certificate|TLS|SSL/i.test(safe)
          ? "tls"
          : /can't reach database|connection refused|connection reset/i.test(
                safe,
              )
            ? "connectivity"
            : prisma
              ? "prisma-error"
              : safe.trim()
                ? "unclassified-error"
                : "none",
  };
}
function processResult(result, durationMs, secrets = []) {
  const signal = /^SIG[A-Z0-9]{1,16}$/.test(result.signal || "")
    ? result.signal
    : null;
  const spawnError = ["ENOENT", "EACCES", "ETIMEDOUT", "ENOBUFS"].includes(
    result.error?.code,
  )
    ? result.error.code
    : result.error
      ? "UNKNOWN"
      : null;
  return {
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal,
    durationMs: Math.max(0, Math.round(durationMs)),
    spawnError,
    ...codes(
      String(result.stderr || "") + "\n" + String(result.stdout || ""),
      secrets,
    ),
  };
}
function recorder() {
  const data = {
    version: 1,
    status: "running",
    stage: "environment-preflight",
    events: [],
    process: null,
    cleanup: "pending",
  };
  return {
    data,
    stage(stage, state = "start") {
      if (
        !STAGES.includes(stage) ||
        !["start", "passed", "failed", "skipped"].includes(state)
      )
        throw Error("DIAGNOSTIC_STAGE");
      if (state === "start") data.stage = stage;
      data.events.push({ stage, state });
    },
    failure(error, secrets) {
      data.status = "failed";
      data.failureStage = data.stage;
      data.failure = codes(error?.message, secrets, error?.code);
      this.stage(data.stage, "failed");
    },
  };
}
function validate(data) {
  if (
    !data ||
    data.version !== 1 ||
    !["passed", "failed"].includes(data.status) ||
    !STAGES.includes(data.stage) ||
    !Array.isArray(data.events) ||
    data.events.length > 100 ||
    !["passed", "failed"].includes(data.cleanup)
  )
    throw Error("DIAGNOSTIC_ARTIFACT_INVALID");
  const projected = {
    version: 1,
    status: data.status,
    stage: data.stage,
    cleanup: data.cleanup,
    events: data.events.map((e) => {
      if (
        !STAGES.includes(e.stage) ||
        !["start", "passed", "failed", "skipped"].includes(e.state)
      )
        throw Error("DIAGNOSTIC_ARTIFACT_INVALID");
      return { stage: e.stage, state: e.state };
    }),
  };
  if (data.failureStage) {
    if (!STAGES.includes(data.failureStage))
      throw Error("DIAGNOSTIC_ARTIFACT_INVALID");
    projected.failureStage = data.failureStage;
  }
  for (const field of ["failure", "process"])
    if (data[field]) {
      const x = data[field];
      const y = {
        prismaCode: /^P\d{4}$/.test(x.prismaCode || "") ? x.prismaCode : null,
        sqlstate: isSqlstate(x.sqlstate) ? x.sqlstate : null,
        stderrClass: [
          "permission-denied",
          "timeout",
          "tls",
          "connectivity",
          "prisma-error",
          "unclassified-error",
          "none",
        ].includes(x.stderrClass)
          ? x.stderrClass
          : "unclassified-error",
      };
      if (field === "process")
        Object.assign(y, {
          exitCode: Number.isInteger(x.exitCode) ? x.exitCode : null,
          signal: /^SIG[A-Z0-9]{1,16}$/.test(x.signal || "") ? x.signal : null,
          durationMs: Number.isFinite(x.durationMs)
            ? Math.max(0, Math.round(x.durationMs))
            : 0,
          spawnError: [
            "ENOENT",
            "EACCES",
            "ETIMEDOUT",
            "ENOBUFS",
            "UNKNOWN",
          ].includes(x.spawnError)
            ? x.spawnError
            : null,
        });
      projected[field] = y;
    }
  return projected;
}
module.exports = { STAGES, sanitize, codes, processResult, recorder, validate };
