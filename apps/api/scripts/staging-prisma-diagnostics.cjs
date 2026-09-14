"use strict";
// Test-only observations: never retain SQL, bind values, URLs, messages or rows.
function instrument(engine, emit) {
  for (const method of ["start", "transaction"]) {
    const original = engine[method];
    if (typeof original !== "function") continue;
    engine[method] = async function (...args) {
      const observed = method === "start" || args[0] === "start";
      const start = performance.now();
      let error;
      try {
        return await original.apply(this, args);
      } catch (e) {
        error = e;
        throw e;
      } finally {
        if (observed)
          emit({
            operation:
              method === "start" ? "engine-connect" : "transaction-start",
            durationMs: performance.now() - start,
            exceptionClass: error
              ? /^[A-Za-z0-9_]+$/.test(error.constructor?.name || "")
                ? error.constructor.name
                : "Error"
              : null,
            prismaCode: /^P[0-9]{4}$/.test(error?.code || "")
              ? error.code
              : null,
            sqlstate: /^[0-9A-Z]{5}$/.test(error?.meta?.code || "")
              ? error.meta.code
              : null,
          });
      }
    };
  }
  return engine;
}
function install() {
  const fs = require("node:fs");
  const file = process.env.OPA_TEST_CONNECTION_DIAGNOSTICS;
  if (!file) return;
  const v = require("./staging-database-verifier.cjs");
  v.check(
    process.env.NODE_ENV === "test" &&
      /^\/run\/opa-test-env\/diag-[a-z0-9-]+\.jsonl$/.test(file),
    "DIAGNOSTICS_SCOPE",
  );
  v.databaseUrl(
    process.env.DATABASE_URL,
    "test",
    process.env.OPA_STAGING_VALIDATION_LEASE,
  );
  const p = require("@prisma/client"),
    Original = p.PrismaClient;
  p.PrismaClient = new Proxy(Original, {
    construct(target, args, newTarget) {
      const client = Reflect.construct(target, args, newTarget);
      instrument(client._engine, (record) =>
        fs.appendFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 }),
      );
      return client;
    },
  });
}
module.exports = { instrument };
install();
