"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const d = require("./staging-migration-diagnostics.cjs"),
  { run } = require("./staging-migrate.cjs"),
  { collect } = require("./staging-readonly-diagnostics.cjs");
const secret = "fixture-super-secret",
  url =
    "postgresql://fixture-user:fixture-password@private.example.invalid/opa_staging?sslmode=require&token=fixture-token";
const initialize = async (pending, purpose, observe) => {
  assert.equal(purpose, "migration");
  observe("environment-preflight");
  observe("resource-binding-verification");
  observe("database-connectivity");
  if (!pending) {
    observe("migration-history-verification");
    observe("checksum-verification");
  }
};
async function wrapper(extra = {}) {
  let artifact;
  const result = await run({
    env: {
      OPA_ENVIRONMENT: "staging",
      DATABASE_URL: url,
      JWT_ACCESS_SECRET: secret,
    },
    initialize,
    resolveCli: () => "synthetic-cli",
    spawn: () => ({ status: 0, signal: null, stdout: "", stderr: "" }),
    write: (a) => (artifact = a),
    ...extra,
  });
  return { result, artifact };
}
test("Prisma failure retains exit code, stage and classified codes without raw text", async () => {
  const { result, artifact } = await wrapper({
    spawn: () => ({
      status: 1,
      signal: null,
      stderr: `Error: P3018\nDatabase error code: 42501\npermission denied ${url} ${secret}`,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(artifact.failureStage, "prisma-command-exit");
  assert.equal(artifact.process.exitCode, 1);
  assert.equal(artifact.process.prismaCode, "P3018");
  assert.equal(artifact.process.sqlstate, "42501");
  assert.equal(artifact.process.stderrClass, "permission-denied");
  assert(!JSON.stringify(artifact).includes(secret));
  assert(!JSON.stringify(artifact).includes("fixture-user"));
  assert(!JSON.stringify(artifact).includes("private.example.invalid"));
});
test("signal and duration retained", () => {
  const a = d.processResult(
    { status: null, signal: "SIGTERM", stderr: "timeout" },
    42.2,
  );
  assert.equal(a.signal, "SIGTERM");
  assert.equal(a.exitCode, null);
  assert.equal(a.durationMs, 42);
});
test("spawn failure retained", () =>
  assert.equal(
    d.processResult({ status: null, error: { code: "ENOENT" } }, 4).spawnError,
    "ENOENT",
  ));
for (const [label, input, forbidden] of [
  ["DATABASE_URL", url, "fixture-password"],
  ["Bearer", "Bearer fixture-token", "fixture-token"],
  ["query", "?option=fixture-query&other=second", "fixture-query"],
  ["password", "password=fixture-password", "fixture-password"],
  [
    "storage",
    "AccountName=fixture;AccountKey=fixture-key;EndpointSuffix=example.invalid",
    "fixture-key",
  ],
  ["known secret", secret, secret],
  [
    "known fingerprint",
    crypto.createHash("sha256").update(secret).digest("hex"),
    crypto.createHash("sha256").update(secret).digest("hex"),
  ],
])
  test("redacts " + label, () =>
    assert(!d.sanitize(input, [secret]).includes(forbidden)),
  );
test("unknown error falls back without arbitrary message", () =>
  assert.deepEqual(d.codes("opaque fixture-data"), {
    prismaCode: null,
    sqlstate: null,
    stderrClass: "unclassified-error",
  }));
test("known secret cannot become an error code", () =>
  assert.equal(d.codes("Error: P1234", ["P1234"]).prismaCode, null));
for (const stage of [
  "environment-preflight",
  "resource-binding-verification",
  "database-connectivity",
  "migration-history-verification",
  "checksum-verification",
])
  test("preserves stage " + stage, async () => {
    let calls = 0;
    const { artifact } = await wrapper({
      initialize: async (p, _purpose, observe) => {
        observe(stage);
        if (p || ++calls)
          throw Object.assign(Error("opaque"), { code: "42501" });
      },
      spawn: () => {
        throw Error("must not spawn");
      },
    });
    assert.equal(artifact.failureStage, stage);
    assert.equal(artifact.cleanup, "passed");
    assert.equal(artifact.failure.sqlstate, "42501");
  });
test("cleanup runs after Prisma failure and preserves primary failure", async () => {
  let cleaned = false;
  const { artifact } = await wrapper({
    spawn: () => ({ status: 2, stderr: "Error: P1001" }),
    cleanup: async () => {
      cleaned = true;
      throw Error(secret);
    },
  });
  assert(cleaned);
  assert.equal(artifact.failureStage, "prisma-command-exit");
  assert.equal(artifact.cleanup, "failed");
  assert.equal(artifact.process.prismaCode, "P1001");
  assert(!JSON.stringify(artifact).includes(secret));
});
test("successful wrapper keeps exact single migrate command and validates history", async () => {
  let commands = 0;
  const { result, artifact } = await wrapper({
    spawn: (_bin, args) => {
      commands++;
      assert.deepEqual(args.slice(1, 4), ["migrate", "deploy", "--schema"]);
      return { status: 0 };
    },
  });
  assert(result.ok);
  assert.equal(commands, 1);
  assert(artifact.events.some((e) => e.stage === "checksum-verification"));
  assert(
    artifact.events.some(
      (e) => e.stage === "prisma-validate" && e.state === "skipped",
    ),
  );
});
test("artifact projector discards unrecognized raw fields", async () => {
  const { artifact } = await wrapper();
  artifact.rawStderr = url;
  artifact.process.raw = secret;
  assert(!JSON.stringify(d.validate(artifact)).includes("fixture"));
});
test("invalid stage rejected", () =>
  assert.throws(() => d.recorder().stage(url)));
test("read-only diagnostic failure rolls back without writes", async () => {
  const statements = [];
  await assert.rejects(
    collect({
      query: async (sql) => {
        statements.push(sql);
        if (sql === "BEGIN READ ONLY" || sql === "ROLLBACK")
          return { rows: [] };
        throw Error("query failed");
      },
    }),
  );
  assert.equal(statements[0], "BEGIN READ ONLY");
  assert.equal(statements.at(-1), "ROLLBACK");
  assert(
    !statements.some((s) =>
      /^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)/i.test(s),
    ),
  );
});

test("post-migration checksum failure retains successful Prisma exit", async () => {
  const { artifact } = await wrapper({
    initialize: async (pending, _purpose, observe) => {
      observe(pending ? "environment-preflight" : "checksum-verification");
      if (!pending) throw Error("checksum mismatch");
    },
  });
  assert.equal(artifact.failureStage, "checksum-verification");
  assert.equal(artifact.process.exitCode, 0);
  assert.equal(artifact.status, "failed");
});

test("Node error codes are not mislabeled PostgreSQL SQLSTATE", () =>
  assert.equal(d.codes("pipe failed", [], "EPIPE").sqlstate, null));
