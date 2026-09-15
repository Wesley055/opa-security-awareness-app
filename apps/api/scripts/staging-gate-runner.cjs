"use strict";
const process = require("node:process");
const { Buffer } = require("node:buffer");
const { fetch, AbortSignal } = globalThis;
// Operator supervisor entry: signed invocation + in-memory credential transport.
// Not a GitHub push trigger. No execution without a fresh trusted staging policy.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  dns = require("node:dns").promises,
  os = require("node:os");
const { spawnSync } = require("node:child_process");
const v = require("./staging-database-verifier.cjs"),
  g = require("./staging-gates.cjs"),
  custody = require("./staging-gate-custodian.cjs");
const boundary = require("../../../packages/environment-policy/index.cjs");
const results = require("./staging-integration-results.cjs");
const diagnostics = require("./staging-modular-diagnostics.cjs");
const preflightReceipt = require("./staging-preflight-receipt.cjs");
const API = path.join(v.ROOT, "apps/api");
const SCOPE =
  "/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/rg-opa-staging";
function policy(envelope) {
  const p = boundary.verifyEnvelope(envelope, "staging", "modular-validation");
  return policyFields(p);
}
function policyFields(p) {
  g.context({
    sha: p.build,
    lease: p.lease,
    source: p.source,
    gate: "database",
  });
  v.check(
    p.repository === "Wesley055/opa-security-awareness-app" &&
      p.branch === "integration/institutional-security" &&
      p.execute === true &&
      p.mode === "disposable-validation" &&
      p.server === v.SERVER &&
      p.runtimeDatabase === v.RUNTIME &&
      p.identity ===
        SCOPE +
          "/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-opa-staging-migrations",
    "GATE_POLICY_TARGET",
  );
  v.check(
    p.productionAssignments === 0 &&
      p.productionRoutes === 0 &&
      p.publicVmIp === false &&
      p.subnet ===
        SCOPE +
          "/providers/Microsoft.Network/virtualNetworks/vnet-opa-staging/subnets/snet-opa-staging-runner" &&
      p.region === "southafricanorth" &&
      p.privatePostgres === "10.72.1.4" &&
      p.privateVault === "10.72.2.4" &&
      p.isolation === "private-postgres-only",
    "GATE_POLICY_NETWORK",
  );
  v.check(
    p.notifications === "disabled" &&
      p.sso === "synthetic-only" &&
      p.cleanupOwner === "operator-host" &&
      /^[a-f0-9]{64}$/.test(p.runtimeSecretSha256 || "") &&
      p.manifestHash === g.hash(g.manifest),
    "GATE_POLICY_BINDINGS",
  );
  v.check(
    Array.isArray(p.gates) &&
      p.gates.length > 0 &&
      JSON.stringify(p.gates) ===
        JSON.stringify(g.ORDER.filter((n) => p.gates.includes(n))),
    "GATE_POLICY_SELECTION",
  );
  v.check(
    Date.parse(p.expiresAt) > Date.now() &&
      Date.parse(p.expiresAt) <= Date.now() + 3600000,
    "GATE_POLICY_EXPIRY",
  );
  return p;
}
function git(d, ...args) {
  const started = Date.now();
  const r = spawnSync("git", ["-c", "safe.directory=" + v.ROOT, ...args], {
    cwd: v.ROOT,
    encoding: "utf8",
  });
  d.outcome({ ...r, durationMs: Date.now() - started });
  v.check(r.status === 0, "GIT_CHECK");
  return r.stdout.trim();
}
function cleanResult(r) {
  return {
    exitCode: r.status,
    signal: r.signal || null,
    prismaCodes: [
      ...new Set(
        (String(r.stdout || "") + String(r.stderr || "")).match(
          /\bP\d{4}\b/g,
        ) || [],
      ),
    ],
    errorClass: r.error ? "PROCESS_FAILURE" : null,
  };
}
async function endConnection(db, d) {
  try {
    await db.end();
  } catch (error) {
    d.cleanup("FAIL");
    d.capture(error);
    throw error;
  }
}
async function runInternal(input, d, prepareOnly) {
  d.mark("POLICY");
  const p = policy(input.policy),
    c = {
      sha: p.build,
      lease: p.lease,
      source: p.source,
      expiresAt: p.expiresAt,
    };
  d.mark("HOST");
  v.check(
    process.platform === "linux" &&
      process.getuid() === 0 &&
      process.version === "v22.23.2" &&
      os.totalmem() >= 4 * 1024 ** 3 &&
      os.cpus().length >= 2,
    "GATE_HOST",
  );
  d.mark("CHECKOUT");
  v.check(
    git(d, "rev-parse", "HEAD") === c.sha &&
      git(d, "branch", "--show-current") === p.branch &&
      git(d, "status", "--porcelain", "--untracked-files=all") === "",
    "GATE_CHECKOUT",
  );
  d.mark("MANIFEST");
  g.inventory(
    fs
      .readdirSync(path.join(API, "test/int"))
      .filter((n) => n.endsWith(".int-spec.ts")),
  );
  d.mark("FINGERPRINT");
  v.check(
    g.hash(input.runtimeUrl) === p.runtimeSecretSha256,
    "GATE_SECRET_FINGERPRINT",
  );
  const runtime = v.databaseUrl(input.runtimeUrl, "runtime");
  d.mark("DNS");
  for (const [host, ip] of [
    [v.SERVER, "10.72.1.4"],
    ["opa-kv-staging.vault.azure.net", "10.72.2.4"],
  ]) {
    const a = await dns.lookup(host, { all: true, family: 4 });
    v.check(
      a.length > 0 && a.every((x) => x.address === ip),
      "GATE_PRIVATE_DNS",
    );
  }
  d.mark("SOURCE_RECHECK");
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .map((x) => x.address);
  v.check(addresses.includes("10.72.4.4"), "GATE_SOURCE");
  d.mark("TOOLCHAIN");
  v.check(
    require("prisma/package.json").version === "6.19.3" &&
      require("@prisma/client/package.json").version === "6.19.3",
    "GATE_PRISMA_VERSION",
  );
  // Read fixed staging bootstrap secret through the existing protected transport.
  // Token claims must name the staging migration identity; no token is retained.
  d.mark("IDENTITY");
  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(input.vaultToken.split(".")[1], "base64url"),
    );
  } catch {
    throw Error("GATE_IDENTITY");
  }
  v.check(
    claims.oid === "737caf69-640d-485e-9be5-c0095633a27e" &&
      claims.tid === "adb3fb59-1ac3-42c2-b39a-d70c7006ccbc",
    "GATE_IDENTITY",
  );
  d.mark("VAULT");
  const response = await fetch(
    "https://opa-kv-staging.vault.azure.net/secrets/opa-staging-bootstrap-db-password?api-version=7.4",
    {
      headers: { Authorization: "Bearer " + input.vaultToken },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  d.outcome({ httpStatus: response.status });
  v.check(response.ok, "GATE_BOOTSTRAP_ACCESS");
  d.mark("BOOTSTRAP_SECRET");
  const secret = await response.json();
  delete input.vaultToken;
  v.check(
    typeof secret.value === "string" &&
      /^https:\/\/opa-kv-staging\.vault\.azure\.net\/secrets\/opa-staging-bootstrap-db-password\/[a-f0-9]{32}$/.test(
        secret.id,
      ),
    "GATE_BOOTSTRAP_SECRET",
  );
  const { Client } = require("pg");
  const connect = async (
    database,
    user = "opa_staging_bootstrap",
    password = secret.value,
    readOnly = false,
  ) => {
    v.check(
      database === "postgres" ||
        database === v.RUNTIME ||
        p.gates.some((gate) => database === g.database({ ...c, gate })),
      "GATE_CONNECT_TARGET",
    );
    const db = new Client({
      host: v.SERVER,
      port: 5432,
      database,
      user,
      password,
      ssl: { rejectUnauthorized: true, servername: v.SERVER },
      connectionTimeoutMillis: 5000,
      options: readOnly ? "-c default_transaction_read_only=on" : undefined,
    });
    try {
      await db.connect();
      if (database === v.RUNTIME) d.mark("RUNTIME_IDENTITY");
      await v.identity(db, database, user, c.source);
      return db;
    } catch (error) {
      d.capture(error);
      try {
        await db.end();
      } catch (closeError) {
        d.cleanup("FAIL");
        d.capture(closeError);
      }
      throw error;
    }
  };
  d.mark("TOOLCHAIN");
  const npmStarted = Date.now();
  const npmVersion = spawnSync(
    process.execPath,
    ["/opt/opa/node22/lib/node_modules/npm/bin/npm-cli.js", "--version"],
    { encoding: "utf8" },
  );
  d.outcome({ ...npmVersion, durationMs: Date.now() - npmStarted });
  v.check(
    npmVersion.status === 0 && npmVersion.stdout.trim() === "10.9.8",
    "GATE_NPM_VERSION",
  );
  const evidence =
    "/opt/opa/evidence/" +
    (prepareOnly ? "modular-preflight-" : "modular-") +
    c.lease;
  d.mark("RECEIPT_DIRECTORY");
  fs.mkdirSync(evidence, { recursive: false, mode: 0o700 });
  d.setWriter((report) =>
    g.writeOnce(path.join(evidence, "orchestration-failure.json"), report),
  );
  const base = {
    PATH: "/opt/opa/node22/bin:/usr/local/bin:/usr/bin:/bin",
    HOME: "/opt/opa/test-home",
    TMPDIR: "/tmp",
    LANG: "C.UTF-8",
    NODE_ENV: "test",
    OPA_NOTIFICATION_MODE: "disabled",
    OPA_SSO_ENABLED: "false",
    OPA_ENVIRONMENT: "development",
    CHECKPOINT_DISABLE: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
  };
  let access = null,
    admin = null;
  const command = (stage, args, env, timeout = 600000) => {
    const started = Date.now(),
      r = spawnSync(process.execPath, args, {
        cwd: API,
        env,
        uid: 1001,
        gid: 1001,
        encoding: "utf8",
        timeout,
        detached: true,
        maxBuffer: 64 * 1024 * 1024,
      });
    d.outcome({
      ...r,
      prismaCode: cleanResult(r).prismaCodes[0],
      durationMs: Date.now() - started,
    });
    if (r.pid) {
      try {
        process.kill(-r.pid, "SIGKILL");
      } catch (e) {
        if (e.code !== "ESRCH") {
          d.cleanup("FAIL");
          throw Error("GATE_CHILD_CLEANUP");
        }
      }
    }
    g.writeOnce(path.join(evidence, stage + ".json"), {
      stage,
      ...cleanResult(r),
      durationMs: Date.now() - started,
    });
    return r;
  };
  const prisma = require.resolve("prisma/build/index.js"),
    schema = path.join(API, "prisma/schema.prisma");
  d.mark("MIGRATION_MANIFEST");
  const expected = v.manifest();
  v.committed(v.ROOT, c.sha, expected);
  const runtimeCheck = async () => {
    d.mark("RUNTIME_CONNECT");
    const db = await connect(
      v.RUNTIME,
      decodeURIComponent(runtime.username),
      decodeURIComponent(runtime.password),
      true,
    );
    try {
      d.mark("RUNTIME_VERIFY");
      const proof = await v.verifyMigrated(db, expected, c.source);
      v.check(
        JSON.stringify(proof.history.map((x) => x.migration_name)) ===
          JSON.stringify(expected.map((x) => x.name)),
        "GATE_HISTORY_ORDER",
      );
      if (prepareOnly)
        g.writeOnce(path.join(evidence, "runtime-verification.json"), {
          result: "PASS",
          readOnly: true,
          migrationCount: 35,
          failedMigrations: 0,
          sentinel: "PASS",
          checksums: "PASS",
          order: "PASS",
          migrationManifestHash: v.manifestHash(expected),
        });
    } catch (error) {
      d.capture(error);
      throw error;
    } finally {
      d.mark("RUNTIME_CLOSE");
      await endConnection(db, d);
    }
  };
  const adapter = {
    async lock() {
      d.mark("ADMIN_CONNECT");
      admin = await connect("postgres");
      d.mark("LOCK");
      const held = (
        await admin.query("SELECT pg_try_advisory_lock(727204,213) AS held")
      ).rows[0].held;
      v.check(held, "GATE_EXCLUSIVE_LEASE");
      return async () => {
        d.mark("UNLOCK");
        try {
          await admin.end();
          admin = null;
        } catch (error) {
          d.cleanup("FAIL");
          d.capture(error);
          throw error;
        }
      };
    },
    async preflight() {
      if (!prepareOnly) {
        d.mark("PREFLIGHT_RECEIPT");
        preflightReceipt.verify(
          input.preflightReceipt,
          input.policy,
          p,
          v.manifestHash(expected),
        );
        return;
      }
      const dummy = {
        ...base,
        DATABASE_URL:
          "postgresql://synthetic:synthetic@127.0.0.1:5432/opa_staging_test?sslmode=require",
      };
      for (const [name, args] of [
        ["prisma-generate", [prisma, "generate", "--schema", schema]],
        ["prisma-validate", [prisma, "validate", "--schema", schema]],
        ["api-build", [require.resolve("@nestjs/cli/bin/nest.js"), "build"]],
      ]) {
        d.mark(
          {
            "prisma-generate": "BUILD_GENERATE",
            "prisma-validate": "BUILD_VALIDATE",
            "api-build": "BUILD_API",
          }[name],
        );
        v.check(command(name, args, dummy).status === 0, "GATE_BUILD");
      }
      await runtimeCheck();
      d.mark("SCHEMA_PARITY");
      const diff = command(
        "runtime-schema-parity",
        [
          prisma,
          "migrate",
          "diff",
          "--from-schema-datasource",
          schema,
          "--to-schema-datamodel",
          schema,
          "--exit-code",
        ],
        {
          ...base,
          DATABASE_URL: input.runtimeUrl,
          PGOPTIONS: "-c default_transaction_read_only=on",
        },
      );
      v.check(
        diff.status === 0 && !diff.signal && !diff.error,
        "GATE_SCHEMA_PARITY",
      );
    },
    diagnosticFailure(error) {
      d.capture(error);
    },
    async assertAbsent(ctx) {
      d.mark("AUTHORIZATION");
      policy(input.policy);
      d.mark("SOURCE_RECHECK");
      v.check(
        git(d, "rev-parse", "HEAD") === c.sha &&
          git(d, "status", "--porcelain", "--untracked-files=all") === "",
        "GATE_SOURCE_CHANGED",
      );
      d.mark("GATE_ABSENCE");
      await custody.operate(admin, connect, ctx, "absent");
    },
    async create(ctx) {
      d.mark("GATE_CREATE");
      access = await custody.operate(admin, connect, ctx, "create");
    },
    async migrateAndVerify(ctx) {
      d.mark("GATE_MIGRATE");
      policy(input.policy);
      g.databaseUrl(access, ctx);
      v.check(
        command(
          ctx.gate + "-migrations",
          [prisma, "migrate", "deploy", "--schema", schema],
          { ...base, DATABASE_URL: access },
        ).status === 0,
        "GATE_MIGRATION_FAILED",
      );
      d.mark("GATE_VERIFY");
      const u = g.databaseUrl(access, ctx),
        db = await connect(
          g.database(ctx),
          decodeURIComponent(u.username),
          decodeURIComponent(u.password),
        );
      try {
        await v.testSentinel(db, ctx.sha, ctx.lease, ctx);
        const rows = await v.history(db);
        v.historyCheck(rows, expected);
        v.check(
          JSON.stringify(rows.map((x) => x.migration_name)) ===
            JSON.stringify(expected.map((x) => x.name)),
          "GATE_HISTORY_ORDER",
        );
        await v.schemaSanity(db);
      } finally {
        await db.end();
      }
      return {
        count: 35,
        failed: 0,
        checksums: "PASS",
        manifestHash: v.manifestHash(expected),
      };
    },
    async suite(ctx, file) {
      d.mark("READINESS_INITIALIZATION");
      policy(input.policy);
      const tmp = fs.mkdtempSync("/tmp/opa-readiness-");
      fs.chownSync(tmp, 1001, 1001);
      fs.chmodSync(tmp, 0o700);
      const readiness = path.join(tmp, "events.jsonl");
      const env = {
        ...base,
        DATABASE_URL: access,
        OPA_STAGING_GATE: ctx.gate,
        OPA_STAGING_SUITE: file,
        OPA_STAGING_VALIDATION_SHA: ctx.sha,
        OPA_STAGING_VALIDATION_LEASE: ctx.lease,
        OPA_STAGING_VALIDATION_SOURCE: ctx.source,
        OPA_STAGING_READINESS_FILE: readiness,
        OPA_SSO_ENABLED: file === "sso.int-spec.ts" ? "true" : "false",
        PII_CRYPTO_ADAPTER: "local",
        PII_ENCRYPTION_KEY_VERSION: "test-v1",
        PII_LOOKUP_KEY_VERSION: "test-v1",
        PII_ENCRYPTION_KEYS_JSON: JSON.stringify({
          "test-v1": crypto.randomBytes(32).toString("base64"),
        }),
        PII_LOOKUP_KEY: crypto.randomBytes(32).toString("base64"),
      };
      try {
        d.mark("SUITE");
        const r = command(
          ctx.gate + "-" + file,
          [
            require.resolve("jest/bin/jest"),
            "--config",
            "jest-staging-validation.config.ts",
            "--runInBand",
            "--json",
            "--runTestsByPath",
            "test/int/" + file,
          ],
          env,
          1200000,
        );

        // Parse in memory, allowlist only approved test identifiers/statuses.
        d.mark("RESULT_COLLECTION");
        const parsed = results.collect(r, (x) => x);
        v.check(
          git(d, "rev-parse", "HEAD") === c.sha &&
            git(d, "status", "--porcelain", "--untracked-files=all") === "",
          "GATE_SOURCE_CHANGED",
        );
        const safe = {
          ...parsed,
          stdout: undefined,
          stderr: undefined,
          suites: (parsed.suites || []).map((s) => ({
            file: s.file,
            status: s.status,
            tests: s.tests.map((t) => ({ name: t.name, status: t.status })),
          })),
        };
        delete safe.stdout;
        delete safe.stderr;
        const events = fs.existsSync(readiness)
          ? fs
              .readFileSync(readiness, "utf8")
              .split("\n")
              .filter(Boolean)
              .map(JSON.parse)
          : [];
        v.check(events.length > 0, "GATE_READINESS_EVIDENCE");
        for (const e of events) g.readinessEvent(e);
        const allowed = g
          .gate(ctx.gate)
          .suites.find((s) => s.file === file).tests;
        const evidenceTests = safe.suites.flatMap((s) =>
          s.tests.map((t) => ({
            id: allowed.includes(t.name)
              ? g.hash(file + ":" + t.name)
              : "UNEXPECTED_TEST",
            status: [
              "passed",
              "failed",
              "pending",
              "todo",
              "skipped",
              "disabled",
            ].includes(t.status)
              ? t.status
              : "INVALID",
          })),
        );
        g.writeOnce(
          path.join(evidence, ctx.gate + "-" + file + "-results.json"),
          { file, ...cleanResult(r), tests: evidenceTests },
        );
        return {
          result: safe,
          readiness: events.map((e) => ({
            event: e.event,
            attempt: e.attempt,
            code: e.code,
            durationMs: e.durationMs,
          })),
        };
      } finally {
        for (const key of Object.keys(env)) delete env[key];
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
    async cleanup(ctx) {
      d.mark("GATE_CLEANUP");
      access = null;
      try {
        const proof = await custody.operate(admin, connect, ctx, "drop");
        v.check(proof.databaseAbsent && proof.roleAbsent, "GATE_CLEANUP");
        await runtimeCheck();
      } catch (error) {
        d.cleanup("FAIL");
        d.capture(error);
        throw error;
      }
    },
    async receipt(r) {
      d.mark("RECEIPT_WRITE");
      g.writeOnce(path.join(evidence, r.gate + "-receipt.json"), r);
    },
    async failure(r) {
      const diagnostic = d.report(new Error("GATE_FAILED"));
      g.writeOnce(path.join(evidence, r.gate + "-failure.json"), {
        ...r,
        code: diagnostic.errorCode,
        diagnostic,
      });
    },
  };
  // Capture at the adapter boundary before release/cleanup can change the stage.
  for (const [name, operation] of Object.entries(adapter)) {
    if (name === "diagnosticFailure") continue;
    adapter[name] = async (...args) => {
      try {
        return await operation(...args);
      } catch (error) {
        d.capture(error);
        throw error;
      }
    };
  }
  try {
    if (prepareOnly) {
      await adapter.preflight();
      d.mark("PREFLIGHT_RECEIPT");
      const files = [
        "prisma-generate",
        "prisma-validate",
        "api-build",
        "runtime-verification",
        "runtime-schema-parity",
      ].map((name) =>
        JSON.parse(
          fs.readFileSync(path.join(evidence, name + ".json"), "utf8"),
        ),
      );
      const receipt = preflightReceipt.draft(
        input.policy,
        p,
        g.hash(files),
        v.manifestHash(expected),
      );
      g.writeOnce(path.join(evidence, "preflight-unsigned.json"), receipt);
      return {
        result: "PASS",
        evidence,
        preflight: receipt,
        signatureRequired: true,
      };
    }
    const result = await g.run(c, adapter, p.gates);
    d.mark("ARTIFACT_WRITE");
    g.writeOnce(path.join(evidence, "result.json"), result);
    return { result: "PASS", evidence };
  } catch (error) {
    d.capture(error);
    throw error;
  } finally {
    access = null;
    secret.value = "";
    input.runtimeUrl = "";
    d.mark("FINAL_CLEANUP");
    if (admin) await endConnection(admin, d);
    d.cleanup("PASS");
  }
}
async function invoke(input, prepareOnly) {
  const d = diagnostics.tracker();
  try {
    return await runInternal(input, d, prepareOnly);
  } catch (error) {
    if (d.cleanupOutcome === "PENDING") d.cleanup("NOT_REQUIRED");
    const safe = new Error(d.report(error).errorCode);
    safe.diagnostic = d.report(error);
    safe.diagnostic.artifactOutcome = d.persist(safe.diagnostic);
    diagnostics.register(safe, safe.diagnostic);
    throw safe;
  } finally {
    if (input && typeof input === "object") {
      input.runtimeUrl = "";
      delete input.vaultToken;
    }
  }
}
const execute = (input) => invoke(input, false);
const preflight = (input) => invoke(input, true);
module.exports = {
  execute,
  preflight,
  policyFields,
  policy,
  cleanResult,
  failureRecord: diagnostics.failure,
};
if (require.main === module) {
  let text = "";
  process.stdin.on("data", (d) => {
    text += d;
    if (text.length > 131072) {
      text = "";
      process.stderr.write(
        JSON.stringify({
          result: "FAIL",
          diagnostic: diagnostics.classify(new RangeError(), "INPUT"),
        }) + "\n",
      );
      process.exit(1);
    }
  });
  process.stdin.on("end", () => {
    let input;
    try {
      input = JSON.parse(text);
      text = "";
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          result: "FAIL",
          diagnostic: diagnostics.classify(error, "INPUT"),
        }) + "\n",
      );
      process.exitCode = 1;
      return;
    }
    (input?.mode === "preflight" ? preflight : execute)(input)
      .then((r) => process.stdout.write(JSON.stringify(r) + "\n"))
      .catch((error) => {
        process.stderr.write(
          JSON.stringify({
            result: "FAIL",
            diagnostic: error.diagnostic || diagnostics.failure(error),
          }) + "\n",
        );
        process.exitCode = 1;
      });
  });
}
