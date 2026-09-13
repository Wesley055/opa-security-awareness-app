"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  dns = require("node:dns").promises;
const { spawnSync } = require("node:child_process");
const v = require("./staging-database-verifier.cjs"),
  trigger = require("./staging-migration-trigger.cjs");
const diagnostics = require("./staging-migration-diagnostics.cjs");
const boundary = require("../../../packages/environment-policy/index.cjs");
const { validatePolicy } = require("./staging-oidc.cjs");
const { REPO, REF } = trigger;
const TENANT = "adb3fb59-1ac3-42c2-b39a-d70c7006ccbc",
  CLIENT = "453f70fc-09c5-43ea-8a63-6c3304cf5dfc",
  PRINCIPAL = "737caf69-640d-485e-9be5-c0095633a27e";
function reject() {
  throw new Error("IDENTITY_OR_REQUEST_REJECTED");
}
function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
  } catch {
    reject();
  }
}
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) reject();
  return response.json();
}
async function oidc(env) {
  const endpoint = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL || "");
  if (
    endpoint.protocol !== "https:" ||
    !endpoint.hostname.endsWith(".actions.githubusercontent.com")
  )
    reject();
  endpoint.searchParams.set("audience", "api://AzureADTokenExchange");
  const github = await jsonRequest(endpoint, {
    headers: { Authorization: "Bearer " + env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
  });
  const claims = jwtClaims(github.value);
  if (
    claims.iss !== "https://token.actions.githubusercontent.com" ||
    claims.sub !== `repo:${REPO}:environment:staging` ||
    claims.aud !== "api://AzureADTokenExchange" ||
    claims.repository !== REPO ||
    claims.ref !== REF ||
    claims.sha !== env.GITHUB_SHA ||
    claims.workflow_ref !== `${REPO}/${trigger.WORKFLOW}@${REF}`
  )
    reject();
  const response = await jsonRequest(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT,
        scope: "https://vault.azure.net/.default",
        grant_type: "client_credentials",
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: github.value,
      }),
    },
  );
  const azure = jwtClaims(response.access_token);
  if (
    azure.tid !== TENANT ||
    azure.oid !== PRINCIPAL ||
    (azure.appid || azure.azp) !== CLIENT
  )
    reject();
  return response.access_token;
}
async function privatePath() {
  for (const host of [
    "opa-pg-staging.postgres.database.azure.com",
    "opa-redis-staging.southafricanorth.redis.azure.net",
    "opa-kv-staging.vault.azure.net",
    "opastagingevidence.blob.core.windows.net",
  ]) {
    const addresses = await dns.lookup(host, { all: true, family: 4 });
    if (
      !addresses.length ||
      addresses.some((x) => !x.address.startsWith("10.72."))
    )
      reject();
  }
}

const SUITES = [
  "tenant-isolation",
  "protected-identity",
  "super-admin",
  "enrollment",
  "delivery-confirmation",
  "sso",
  "safewalk-confirmations",
  "safewalk-guardian-escalation",
  "safewalk-reconciliation",
  "incident-lifecycle-concurrency",
  "incident-timeline-concurrency",
  "locationless-incident",
  "journey-session-concurrency",
  "journey-session-constraints",
  "journey-session-service",
  "advisory-lock",
];
function command(script, args, env, stage, timeout = 600000, observe) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [script, ...args], {
    env,
    cwd: path.join(v.ROOT, "apps/api"),
    stdio: "pipe",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (observe) observe(r, Date.now() - started);
  v.check(r.status === 0, stage);
  return r;
}
function prisma(args, env, stage) {
  return command(
    require.resolve("prisma/build/index.js"),
    [...args, "--schema", path.join(v.ROOT, "apps/api/prisma/schema.prisma")],
    env,
    stage,
  );
}
async function waitFor(name, run, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fs.existsSync(name)) {
      const result = JSON.parse(fs.readFileSync(name, "utf8"));
      v.check(
        result.sha === run.sha &&
          result.lease === run.lease &&
          result.status === "ready",
        "CUSTODIAN_RESPONSE",
      );
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("CUSTODIAN_TIMEOUT");
}
function request(action, run) {
  fs.writeFileSync(
    "/runner/opa-staging-custodian-request.json",
    JSON.stringify({ action, sha: run.sha, lease: run.lease }),
    { mode: 0o600 },
  );
}
async function tests(access, run, audit) {
  v.databaseUrl(access.databaseUrl, "test", run.lease);
  const { Client } = require("pg");
  const db = new Client({ connectionString: access.databaseUrl });
  await db.connect();
  try {
    await v.identity(db, v.TEST, v.testRole(run.lease), run.source);
    await v.testSentinel(db, run.sha, run.lease);
  } finally {
    await db.end();
  }
  // A fresh environment prevents runtime tokens, keys, database URLs or OIDC request credentials entering test children.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.RUNNER_TEMP,
    NODE_ENV: "test",
    DATABASE_URL: access.databaseUrl,
    OPA_STAGING_VALIDATION_SHA: run.sha,
    OPA_STAGING_VALIDATION_LEASE: run.lease,
    OPA_STAGING_VALIDATION_SOURCE: run.source,
    OPA_NOTIFICATION_MODE: "disabled",
    OPA_SSO_ENABLED: "false",
  };
  const envFile = path.join(v.ROOT, "apps/api/.env.test.local");
  let written = false;
  try {
    fs.writeFileSync(
      envFile,
      "DATABASE_URL=" +
        JSON.stringify(access.databaseUrl) +
        "\nNODE_ENV=test\n",
      { flag: "wx", mode: 0o600 },
    );
    written = true;
    prisma(["migrate", "deploy"], env, "TEST_MIGRATION_FAILED");
    const verify = new Client({ connectionString: access.databaseUrl });
    await verify.connect();
    try {
      await v.testSentinel(verify, run.sha, run.lease);
      v.historyCheck(await v.history(verify), run.manifest);
      await v.schemaSanity(verify);
    } finally {
      await verify.end();
    }
    const args = [
      "--config",
      "jest-staging-validation.config.ts",
      "--runInBand",
      "--silent",
      "--json",
      "--runTestsByPath",
      ...SUITES.map((x) => "test/int/" + x + ".int-spec.ts"),
    ];
    const result = spawnSync(
      process.execPath,
      [require.resolve("jest/bin/jest"), ...args],
      {
        cwd: path.join(v.ROOT, "apps/api"),
        env,
        stdio: "pipe",
        timeout: 1200000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    let summary;
    try {
      summary = JSON.parse(result.stdout.toString());
    } catch {
      throw new Error("TEST_RESULT_UNAVAILABLE");
    }
    audit.testAttempt = {
      attempt: 1,
      exitCode: result.status,
      passed: summary.numPassedTests,
      failed: summary.numFailedTests,
      pending: summary.numPendingTests,
      suites: (summary.testResults || []).map((x) => ({
        file: path.basename(x.name),
        status: x.status,
        passed: x.assertionResults.filter((t) => t.status === "passed").length,
        failed: x.assertionResults.filter((t) => t.status === "failed").length,
      })),
    };
    v.check(
      result.status === 0 &&
        summary.success === true &&
        summary.numFailedTests === 0 &&
        summary.numPassedTests > 0 &&
        audit.testAttempt.suites.length === SUITES.length &&
        audit.testAttempt.suites.every((x) => x.status === "passed"),
      "VALIDATION_TEST_FAILURE",
    );
  } finally {
    if (written) fs.unlinkSync(envFile);
    delete env.DATABASE_URL;
    delete access.databaseUrl;
  }
}
async function controlledExecution(run, ops) {
  if (!run.execute) return;
  await ops.beforeWrite();
  if (run.mode !== "validation") await ops.migrateRuntime();
  await ops.verifyRuntime();
  let original;
  try {
    await ops.createTest();
    await ops.validateTest();
  } catch (error) {
    original = error;
  }
  try {
    await ops.dropTest();
  } catch (error) {
    if (!original) original = error;
    else original.cleanupFailed = true;
  }
  if (original) throw original;
}
async function main() {
  const run = trigger.load();
  const envelope = JSON.parse(
    process.env.OPA_STAGING_MIGRATION_POLICY || "null",
  );
  const policy = validatePolicy(envelope, run.sha);
  if (process.argv.includes("--guard-only")) {
    console.log(
      "Immutable staging migration trigger and signed policy guards passed",
    );
    return;
  }
  const lease = JSON.parse(
    fs.readFileSync("/runner/opa-staging-lease.json", "utf8"),
  );
  v.check(
    lease.azurePreflight &&
      lease.azurePreflight.postgresState === "Ready" &&
      lease.azurePreflight.principalId === PRINCIPAL &&
      lease.azurePreflight.productionAssignments === 0 &&
      lease.azurePreflight.approvedSecretAssignments === 8,
    "AZURE_PREFLIGHT_ATTESTATION",
  );
  const audit = {
    status: "running",
    mode:
      run.mode === "validation"
        ? "post-migration-validation"
        : run.execute
          ? "migration"
          : "review-only",
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    sha: run.sha,
    environment: "staging",
    identity: "id-opa-staging-migrations",
    server: "opa-pg-staging",
    runtimeDatabase: v.RUNTIME,
    testDatabase: v.TEST,
    source: run.source,
    migrationsExecuted: false,
    testDatabaseCreated: false,
    notifications: "disabled",
    sso: false,
  };
  let runtime, policyDir;
  let phase = "authentication";
  try {
    await privatePath();
    const token = await oidc(process.env);
    audit.oidc = "PASS";
    audit.azureIdentity = "PASS";
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.GITHUB_TOKEN;
    runtime = { ...process.env };
    for (const n of [...boundary.secretNames, ...boundary.settingNames])
      delete runtime[n];
    Object.assign(runtime, {
      OPA_ENVIRONMENT: "staging",
      NODE_ENV: "production",
      OPA_BUILD_SHA: run.sha,
      OPA_DEPLOYMENT_RESOURCE_ID: policy.resources.app.id,
    });
    for (const [k, value] of Object.entries(policy.settings))
      if (value !== null) runtime[k] = value;
    phase = "versioned-secret-verification";
    audit.secretVersions = [];
    for (const [name, b] of Object.entries(policy.secrets)) {
      const data = await jsonRequest(b.secretId + "?api-version=7.4", {
        headers: { Authorization: "Bearer " + token },
      });
      v.check(
        data.id === b.secretId &&
          typeof data.value === "string" &&
          boundary.hash(data.value) === b.sha256,
        "SECRET_BINDING",
      );
      runtime[name] = data.value;
      audit.secretVersions.push({
        name,
        secretId: b.secretId,
        sha256: b.sha256,
      });
    }
    v.databaseUrl(runtime.DATABASE_URL, "runtime");
    policyDir = fs.mkdtempSync(
      path.join(process.env.RUNNER_TEMP, "opa-migration-policy-"),
    );
    runtime.OPA_ENVIRONMENT_POLICY_FILE = path.join(policyDir, "policy.json");
    fs.writeFileSync(
      runtime.OPA_ENVIRONMENT_POLICY_FILE,
      JSON.stringify(envelope),
      { mode: 0o600 },
    );
    boundary.preflight(runtime, "migration");
    Object.assign(process.env, runtime);
    phase = "empty-database-baseline";
    const { Client } = require("pg");
    const db = new Client({ connectionString: runtime.DATABASE_URL });
    await db.connect();
    try {
      await v.identity(db, v.RUNTIME, "opa_staging_migrations", run.source);
      if (run.mode === "validation") {
        audit.baseline = await v.verifyMigrated(db, run.manifest, run.source);
      } else audit.baseline = await v.baseline(db);
      if (!run.execute) phase = "read-only-permission-diagnostics";
      if (!run.execute)
        audit.readOnlyDiagnostics =
          await require("./staging-readonly-diagnostics.cjs").collect(db);
    } finally {
      await db.end();
    }
    phase = "prisma-engine-connectivity";
    await require("../dist/shared/config/environment.js").initializeEnvironment(
      run.mode !== "validation",
      "migration",
    );
    audit.prismaEngineConnectivity = "PASS";
    phase = "prisma-validate";
    prisma(["validate"], runtime, "PRISMA_VALIDATE");
    audit.privateConnectivity = "PASS";
    audit.databasePreflight = "PASS";
    audit.finalAddressCheck = "PASS";
    audit.prismaValidate = "PASS";
    if (!run.execute) {
      audit.status = "Passed";
      audit.schemaWrites = 0;
      audit.disposableValidation = "DESIGN_ONLY";
      return;
    }
    let access;
    await controlledExecution(run, {
      beforeWrite: async () => {
        phase = "custodian-readiness";
        await waitFor("/runner/opa-staging-custodian-ready.json", run);
        trigger.load();
        validatePolicy(envelope, run.sha);
        boundary.preflight(runtime, "migration");
      },
      migrateRuntime: async () => {
        phase = "runtime-migration";
        audit.migrationAttempted = true;
        runtime.OPA_MIGRATION_DIAGNOSTICS_FILE =
          "/runner/opa-staging-wrapper-diagnostics.json";
        audit.diagnosticArtifactPath = runtime.OPA_MIGRATION_DIAGNOSTICS_FILE;
        command(
          path.join(__dirname, "staging-migrate.cjs"),
          [],
          runtime,
          "RUNTIME_MIGRATION_FAILED",
          1200000,
          (result, durationMs) => {
            audit.wrapperExit = diagnostics.processResult(
              result,
              durationMs,
              Object.entries(runtime)
                .filter(
                  ([name]) =>
                    boundary.secretNames.includes(name) ||
                    /TOKEN|PASSWORD|SECRET/i.test(name),
                )
                .map(([, value]) => value),
            );
            if (fs.existsSync(runtime.OPA_MIGRATION_DIAGNOSTICS_FILE)) {
              const data = fs.readFileSync(
                runtime.OPA_MIGRATION_DIAGNOSTICS_FILE,
                "utf8",
              );
              v.check(data.length <= 65536, "DIAGNOSTIC_ARTIFACT_SIZE");
              audit.wrapper = diagnostics.validate(JSON.parse(data));
              audit.wrapperStage =
                audit.wrapper.failureStage || audit.wrapper.stage;
              audit.wrapperFailureClass =
                audit.wrapper.failure?.stderrClass ||
                audit.wrapper.process?.stderrClass ||
                "none";
            } else
              audit.wrapperFailureClass = "diagnostic-artifact-unavailable";
          },
        );
        audit.migrationsExecuted = true;
      },
      verifyRuntime: async () => {
        phase = "runtime-verification";
        runtime.OPA_MIGRATION_DIAGNOSTICS_FILE =
          "/runner/opa-staging-wrapper-diagnostics.json";
        command(
          path.join(__dirname, "staging-migrate.cjs"),
          ["--verify-only"],
          runtime,
          "POST_MIGRATION_RECONNECT",
          600000,
          (result, durationMs) => {
            audit.postVerifierExit = diagnostics.processResult(
              result,
              durationMs,
              boundary.secretNames.map((name) => runtime[name]),
            );
            if (fs.existsSync(runtime.OPA_MIGRATION_DIAGNOSTICS_FILE)) {
              const data = fs.readFileSync(
                runtime.OPA_MIGRATION_DIAGNOSTICS_FILE,
                "utf8",
              );
              v.check(data.length <= 65536, "DIAGNOSTIC_ARTIFACT_SIZE");
              audit.postVerifier = diagnostics.validate(JSON.parse(data));
            }
          },
        );
        const after = new Client({
          connectionString: runtime.DATABASE_URL,
          options: "-c default_transaction_read_only=on",
        });
        await after.connect();
        try {
          const proof = await v.verifyMigrated(after, run.manifest, run.source);
          audit.history = proof.history;
          audit.postMigrationCount = proof.migrationCount;
          audit.runtimeReadOnlyVerification = "PASS";
          audit.runtimeMigrationRerun = run.mode !== "validation";
        } finally {
          await after.end();
        }
        prisma(["validate"], runtime, "PRISMA_VALIDATE");
        command(
          require.resolve("prisma/build/index.js"),
          [
            "migrate",
            "diff",
            "--from-schema-datasource",
            path.join(v.ROOT, "apps/api/prisma/schema.prisma"),
            "--to-schema-datamodel",
            path.join(v.ROOT, "apps/api/prisma/schema.prisma"),
            "--exit-code",
          ],
          runtime,
          "RUNTIME_SCHEMA_DIFF",
        );
      },
      createTest: async () => {
        phase = "disposable-creation";
        request("create", run);
        access = await waitFor("/runner/opa-staging-test-access.json", run);
        fs.unlinkSync("/runner/opa-staging-test-access.json");
        audit.testDatabaseCreated = true;
      },
      validateTest: async () => {
        phase = "disposable-validation";
        await tests(access, run, audit);
      },
      dropTest: async () => {
        request("drop", run);
        await waitFor("/runner/opa-staging-test-cleaned.json", run);
        audit.testDatabaseDropped = true;
      },
    });
    audit.status = "Passed";
  } catch (error) {
    audit.status = "Failed";
    audit.failureStage = phase;
    audit.cleanupFailed = Boolean(error.cleanupFailed);
    audit.errorDiagnostic = diagnostics.codes(
      error.message,
      runtime
        ? Object.entries(runtime)
            .filter(
              ([name]) =>
                boundary.secretNames.includes(name) ||
                /TOKEN|PASSWORD|SECRET/i.test(name),
            )
            .map(([, value]) => value)
        : [],
      error.code,
    );
    audit.errorCode = /^[A-Z0-9_]{1,64}$/.test(error.message || "")
      ? error.message
      : "DETAILS_SUPPRESSED";
    process.exitCode = 1;
  } finally {
    if (run.execute) request("cleanup", run);
    for (const name of boundary.secretNames) {
      if (runtime) delete runtime[name];
      delete process.env[name];
    }
    try {
      if (policyDir) fs.rmSync(policyDir, { recursive: true, force: true });
      audit.localCleanup = "passed";
    } catch {
      audit.localCleanup = "failed";
      audit.cleanupFailed = true;
      if (audit.status !== "Failed") audit.failureStage = "cleanup";
      audit.status = "Failed";
      process.exitCode = 1;
    }
    fs.writeFileSync(
      "/runner/opa-staging-migration-audit.json",
      JSON.stringify(audit),
      { mode: 0o600 },
    );
    console.log("OPA_MIGRATION_AUDIT " + JSON.stringify(audit));
  }
}
module.exports = { SUITES, tests, controlledExecution };
if (require.main === module)
  main().catch(() => {
    console.error("Staging migration invocation rejected before execution");
    process.exitCode = 1;
  });
