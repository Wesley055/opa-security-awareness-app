"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const v = require("./staging-database-verifier.cjs");
const REPO = "Wesley055/opa-security-awareness-app";
const REF = "refs/heads/integration/institutional-security";
const TRIGGER = "ops/staging/migration-trigger.json";
const WORKFLOW = ".github/workflows/opa-staging-migration-execution.yml";
function validate(env, event, t, lease, now = Date.now()) {
  v.check(
    env.GITHUB_REPOSITORY === REPO &&
      env.GITHUB_REF === REF &&
      env.GITHUB_EVENT_NAME === "push" &&
      env.OPA_GITHUB_ENVIRONMENT === "staging",
    "INVOCATION",
  );
  v.check(
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "") &&
      /^\d+$/.test(env.GITHUB_RUN_ID || "") &&
      /^\d+$/.test(env.GITHUB_RUN_ATTEMPT || ""),
    "EXECUTION_ID",
  );
  v.check(
    event.after === env.GITHUB_SHA &&
      event.before === t.approvedParentSha &&
      event.ref === REF &&
      event.repository.full_name === REPO &&
      !event.forced &&
      !event.deleted,
    "PUSH_BINDING",
  );
  v.check(
    t.version === 1 &&
      t.mode === "migration" &&
      typeof t.execute === "boolean" &&
      t.environment === "staging" &&
      t.server === "opa-pg-staging" &&
      t.runtimeDatabase === v.RUNTIME &&
      t.testDatabase === v.TEST &&
      t.identity === "id-opa-staging-migrations",
    "TRIGGER_TARGET",
  );
  v.check(
    t.executableShaBinding === "github-event-sha+signed-policy+runner-lease" &&
      /^[a-f0-9]{40}$/.test(t.approvedParentSha) &&
      /^[a-f0-9]{24}$/.test(t.lease) &&
      /^[a-f0-9]{64}$/.test(t.migrationChainSha256),
    "TRIGGER_BINDING",
  );
  v.check(
    Date.parse(t.expiresAt) > now &&
      Date.parse(t.expiresAt) <= now + 48 * 3600 * 1000,
    "TRIGGER_EXPIRY",
  );
  v.check(
    lease.id === t.lease &&
      lease.repository === REPO &&
      lease.approvedSha === env.GITHUB_SHA &&
      lease.mode === (t.execute ? "migration" : "migration-review") &&
      /^172\.27\.240\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])\/32$/.test(
        lease.source,
      ) &&
      Date.parse(lease.expiresAt) > now &&
      Date.parse(lease.expiresAt) <= now + 3600000 &&
      lease.hostMounts === 0 &&
      lease.cleanupOwner === "operator-host",
    "RUNNER_LEASE",
  );
  if (t.execute) {
    const a = JSON.parse(env.OPA_STAGING_MIGRATION_AUTHORIZATION || "null");
    v.check(
      a &&
        a.sha === env.GITHUB_SHA &&
        a.lease === t.lease &&
        a.action === "MIGRATE_OPA_STAGING" &&
        Date.parse(a.expiresAt) > now &&
        Date.parse(a.expiresAt) <= now + 3600000,
      "EXECUTION_AUTHORIZATION",
    );
  }
  return {
    execute: t.execute,
    sha: env.GITHUB_SHA,
    lease: t.lease,
    source: lease.source,
    expiresAt: lease.expiresAt,
  };
}
function load(env = process.env) {
  v.check(
    process.platform === "linux" &&
      fs.existsSync("/.dockerenv") &&
      !fs.existsSync("/var/run/docker.sock"),
    "RUNNER_ISOLATION",
  );
  execFileSync("git", ["diff", "--exit-code", "HEAD", "--"], {
    cwd: v.ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const t = JSON.parse(fs.readFileSync(path.join(v.ROOT, TRIGGER), "utf8"));
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  const lease = JSON.parse(
    fs.readFileSync("/runner/opa-staging-lease.json", "utf8"),
  );
  const result = validate(env, event, t, lease);
  const parent = execFileSync("git", ["rev-parse", "HEAD^"], {
    cwd: v.ROOT,
    encoding: "utf8",
  }).trim();
  v.check(parent === t.approvedParentSha, "SINGLE_COMMIT_PUSH");
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", parent, env.GITHUB_SHA, "--", TRIGGER],
    { cwd: v.ROOT, encoding: "utf8" },
  ).trim();
  v.check(changed === TRIGGER, "DEDICATED_TRIGGER_UNCHANGED");
  const manifest = v.manifest();
  v.committed(v.ROOT, env.GITHUB_SHA, manifest);
  v.check(
    v.manifestHash(manifest) === t.migrationChainSha256,
    "MIGRATION_CHAIN_BINDING",
  );
  for (const file of [
    TRIGGER,
    WORKFLOW,
    "apps/api/scripts/staging-migrate.cjs",
    "apps/api/scripts/staging-migration-diagnostics.cjs",
    "apps/api/scripts/staging-readonly-diagnostics.cjs",
    "apps/api/src/shared/config/environment.ts",
    "apps/api/scripts/staging-oidc.cjs",
    "apps/api/scripts/staging-database-verifier.cjs",
    "apps/api/scripts/staging-migration-path.cjs",
    "apps/api/scripts/staging-migration-trigger.cjs",
    "apps/api/scripts/staging-validation-custodian.cjs",
    "packages/environment-policy/index.cjs",
    "packages/environment-policy/trusted-signers.json",
  ]) {
    const committed = execFileSync(
      "git",
      ["show", env.GITHUB_SHA + ":" + file],
      { cwd: v.ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    v.check(
      v.hash(committed) === v.hash(fs.readFileSync(path.join(v.ROOT, file))),
      "EXECUTABLE_BYTES_CHANGED",
    );
  }
  return { ...result, manifest };
}
module.exports = { REPO, REF, TRIGGER, WORKFLOW, validate, load };
