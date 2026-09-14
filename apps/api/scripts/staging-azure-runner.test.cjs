/* global __dirname */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const a = require("./staging-azure-runner.cjs"),
  g = require("./staging-migration-trigger.cjs");
const c = { ...a.CONTRACT },
  now = Date.now(),
  sha = "a".repeat(40),
  id = "b".repeat(24);
function fixture() {
  return {
    id,
    approvedSha: sha,
    source: c.source,
    hostMounts: 0,
    cleanupOwner: c.cleanupOwner,
    runner: { ...c },
    azurePreflight: {
      postgresState: "Ready",
      principalId: c.principal,
      productionAssignments: 0,
      approvedSecretAssignments: 8,
      productionRoutes: 0,
      productionDnsBindings: 0,
      privatePostgres: "10.72.1.4",
      privateVault: "10.72.2.4",
      publicVmIp: false,
    },
  };
}
const env = { OPA_RUNNER_KIND: c.kind, RUNNER_NAME: c.name };
test("exact Azure contract and signed policy lease accepted", () => {
  const l = fixture();
  a.lease(l, { mode: "validation" }, env);
  a.policy({ runner: c, validationLease: id, build: sha }, l);
});
for (const key of Object.keys(c))
  test("reject altered Azure " + key, () => {
    const l = fixture();
    l.runner[key] = "unapproved";
    assert.throws(() => a.lease(l, { mode: "validation" }, env));
  });
for (const source of [
  "10.72.4.5/32",
  "10.72.4.4/28",
  "10.72.4.0/28",
  "172.27.240.2/32",
  "10.72.1.4/32",
])
  test("reject nonexact source " + source, () => {
    const l = fixture();
    l.source = source;
    assert.throws(() => a.lease(l, { mode: "validation" }, env));
  });
for (const [key, value] of [
  ["productionAssignments", 1],
  ["productionRoutes", 1],
  ["productionDnsBindings", 1],
  ["approvedSecretAssignments", 9],
  ["principalId", "other"],
  ["privatePostgres", "10.72.1.5"],
  ["privateVault", "10.72.2.5"],
  ["publicVmIp", true],
  ["postgresState", "Updating"],
])
  test("reject attestation " + key, () => {
    const l = fixture();
    l.azurePreflight[key] = value;
    assert.throws(() => a.lease(l, { mode: "validation" }, env));
  });
test("Azure runner cannot migrate runtime", () =>
  assert.throws(() => a.lease(fixture(), { mode: "migration" }, env)));
test("Azure kind and runner name required", () => {
  assert.throws(() => a.lease(fixture(), { mode: "validation" }, {}));
  assert.throws(() =>
    a.lease(
      fixture(),
      { mode: "validation" },
      { ...env, RUNNER_NAME: "other" },
    ),
  );
});
for (const key of ["validationLease", "build"])
  test("signed policy rejects wrong " + key, () =>
    assert.throws(() =>
      a.policy(
        { ...{ runner: c, validationLease: id, build: sha }, [key]: "wrong" },
        fixture(),
      ),
    ),
  );
for (const [host, ip] of Object.entries(a.DNS)) {
  test("exact private DNS " + host, () => a.dnsCheck(host, [ip, ip]));
  test("reject mixed public DNS " + host, () =>
    assert.throws(() => a.dnsCheck(host, [ip, "8.8.8.8"])),
  );
}
test("reject unknown production hostname", () =>
  assert.throws(() =>
    a.dnsCheck("opa-api-production.azurewebsites.net", ["10.72.1.4"]),
  ));
const state = {
  platform: "linux",
  uid: 1001,
  groups: [1001],
  dockerSocket: false,
  tmpfs: true,
  addresses: ["10.72.4.4"],
  leaseUid: 0,
  leaseMode: 0o444,
};
test("VM isolation does not require Docker marker", () => a.isolation(state));
for (const [k, v] of [
  ["uid", 0],
  ["groups", [0]],
  ["tmpfs", false],
  ["dockerSocket", true],
  ["addresses", ["172.27.240.2"]],
  ["leaseUid", 1001],
  ["leaseMode", 0o666],
])
  test("reject VM isolation " + k, () =>
    assert.throws(() => a.isolation({ ...state, [k]: v })),
  );
test("workflow requires protected Azure labels and exact SHA", () => {
  const s = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../.github/workflows/opa-staging-migration-execution.yml",
    ),
    "utf8",
  );
  assert.match(
    s,
    /runs-on: \[self-hosted, linux, opa-staging-azure-validation, "\$\{\{ github.sha \}\}"\]/,
  );
  assert.match(s, /environment: staging/);
  assert.match(s, /OPA_RUNNER_KIND: azure-ephemeral/);
  assert.doesNotMatch(s, /setup-node|runs-on:.*opa-staging-ephemeral/);
});
test("supervisor contract matches job contract", () =>
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../ops/staging/azure-runner-contract.json",
        ),
        "utf8",
      ),
    ),
    c,
  ));
test("expired Azure lease still fails common trigger guard", () => {
  const l = {
    ...fixture(),
    repository: g.REPO,
    mode: "migration-validation",
    expiresAt: new Date(now - 1).toISOString(),
  };
  const e = {
    ...env,
    GITHUB_REPOSITORY: g.REPO,
    GITHUB_REF: g.REF,
    GITHUB_EVENT_NAME: "push",
    OPA_GITHUB_ENVIRONMENT: "staging",
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: "1",
    GITHUB_RUN_ATTEMPT: "1",
  };
  const t = {
    version: 1,
    mode: "validation",
    execute: false,
    environment: "staging",
    server: "opa-pg-staging",
    runtimeDatabase: "opa_staging",
    testDatabase: "opa_staging_test",
    identity: "id-opa-staging-migrations",
    lease: id,
    approvedParentSha: "c".repeat(40),
    executableShaBinding: "github-event-sha+signed-policy+runner-lease",
    migrationChainSha256: "d".repeat(64),
    expiresAt: new Date(now + 100000).toISOString(),
  };
  assert.throws(() =>
    g.validate(
      e,
      {
        after: sha,
        before: t.approvedParentSha,
        ref: g.REF,
        repository: { full_name: g.REPO },
      },
      t,
      l,
      now,
    ),
  );
});
