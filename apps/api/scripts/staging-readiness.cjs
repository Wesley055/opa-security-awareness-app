"use strict";
const { setTimeout, clearTimeout } = require("node:timers");
const { performance } = require("node:perf_hooks");
const MAX_ATTEMPTS = 3,
  DEADLINE_MS = 20000,
  BACKOFF = [500, 1500];
const TRANSIENT = new Set(["P1001", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"]);
function code(e) {
  const c = e?.errorCode || e?.code;
  return TRANSIENT.has(c) ? c : "NON_TRANSIENT";
}
function retryable(e) {
  // Message inspection is denial-only. Messages are never returned or retained.
  if (
    /auth|password|permission|certificate|TLS|SSL|sentinel|identity|config|assert|constraint|transaction/i.test(
      String(e?.message || ""),
    )
  )
    return false;
  return (
    ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(e?.code) ||
    (e?.name === "PrismaClientInitializationError" && e?.errorCode === "P1001")
  );
}
function session({
  emit = () => {},
  now = () => performance.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  let phase = "idle";
  const end = now() + DEADLINE_MS;
  const bounded = async (fn) => {
    const ms = end - now();
    if (ms <= 0) throw Error("READINESS_DEADLINE");
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("READINESS_DEADLINE")), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    close() {
      phase = "closed";
    },
    beginFixtures() {
      if (phase !== "ready") throw Error("READINESS_PHASE");
      phase = "test-started";
    },
    async verifyIdentity(promise) {
      if (phase !== "ready") throw Error("READINESS_PHASE");
      const start = now();
      try {
        await bounded(() => promise);
        if (now() >= end) throw Error("READINESS_DEADLINE");
      } catch (error) {
        phase = "closed";
        emit({
          event: error.message === "READINESS_DEADLINE" ? "deadline" : "failed",
          attempt: 1,
          code: "NON_TRANSIENT",
          durationMs: Math.max(0, now() - start),
        });
        throw error;
      }
    },
    async connect(client) {
      if (!["idle", "ready"].includes(phase)) throw Error("READINESS_PHASE");
      phase = "connecting";
      // No user-supplied application callback: only connection APIs are invoked.
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const start = now();
        try {
          await bounded(() => client.$connect());
          if (now() >= end) throw Error("READINESS_DEADLINE");
          if (phase !== "connecting") throw Error("READINESS_PHASE");
          phase = "ready";
          emit({
            event: attempt === 1 ? "ready" : "recovered",
            attempt,
            code: null,
            durationMs: Math.max(0, now() - start),
          });
          return;
        } catch (e) {
          emit({
            event: e.message === "READINESS_DEADLINE" ? "deadline" : "failed",
            attempt,
            code: code(e),
            durationMs: Math.max(0, now() - start),
          });
          // Timeout never retries an operation still in flight. Caller must abort
          // the suite process; no fixture or application callback has been run.
          if (e.message === "READINESS_DEADLINE") {
            phase = "closed";
            void Promise.resolve()
              .then(() => client.$disconnect())
              .catch(() => {});
            throw Error("READINESS_DEADLINE");
          }
          try {
            await bounded(() => client.$disconnect());
          } catch {
            phase = "closed";
            emit({
              event: "cleanup-failed",
              attempt,
              code: "NON_TRANSIENT",
              durationMs: 0,
            });
            throw Error("READINESS_CLEANUP");
          }
          if (!retryable(e) || attempt === MAX_ATTEMPTS) {
            phase = "closed";
            throw Error("READINESS_" + code(e));
          }
          await bounded(() => sleep(BACKOFF[attempt - 1]));
        }
      }
    },
  };
}
module.exports = { MAX_ATTEMPTS, DEADLINE_MS, BACKOFF, retryable, session };
