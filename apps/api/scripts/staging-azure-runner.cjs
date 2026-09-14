"use strict";
const process = require("node:process");
const fs = require("node:fs"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const v = require("./staging-database-verifier.cjs");
const SCOPE =
  "/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/rg-opa-staging";
const CONTRACT = Object.freeze({
  kind: "azure-ephemeral",
  label: "opa-staging-azure-validation",
  name: "opa-staging-azure-validation-01",
  vm:
    SCOPE +
    "/providers/Microsoft.Compute/virtualMachines/vm-opa-staging-validation-01",
  vnet: SCOPE + "/providers/Microsoft.Network/virtualNetworks/vnet-opa-staging",
  subnet:
    SCOPE +
    "/providers/Microsoft.Network/virtualNetworks/vnet-opa-staging/subnets/snet-opa-staging-runner",
  cidr: "10.72.4.0/28",
  source: "10.72.4.4/32",
  identity:
    SCOPE +
    "/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-opa-staging-migrations",
  principal: "737caf69-640d-485e-9be5-c0095633a27e",
  cleanupOwner: "operator-host-azure",
  runtimeDatabase: "opa_staging",
  testDatabase: "opa_staging_test",
});
const DNS = Object.freeze({
  "opa-pg-staging.postgres.database.azure.com": "10.72.1.4",
  "opa-kv-staging.vault.azure.net": "10.72.2.4",
});
function binding(value) {
  v.check(
    value && Object.keys(value).length === Object.keys(CONTRACT).length,
    "AZURE_RUNNER_BINDING",
  );
  for (const [key, expected] of Object.entries(CONTRACT))
    v.check(value[key] === expected, "AZURE_RUNNER_" + key.toUpperCase());
}
function lease(value, trigger, env) {
  v.check(
    trigger.mode === "validation" &&
      env.OPA_RUNNER_KIND === CONTRACT.kind &&
      env.RUNNER_NAME === CONTRACT.name,
    "AZURE_VALIDATION_ONLY",
  );
  binding(value.runner);
  v.check(
    value.source === CONTRACT.source &&
      value.cleanupOwner === CONTRACT.cleanupOwner &&
      value.hostMounts === 0,
    "AZURE_LEASE_SOURCE",
  );
  const p = value.azurePreflight;
  v.check(
    p &&
      p.postgresState === "Ready" &&
      p.principalId === CONTRACT.principal &&
      p.productionAssignments === 0 &&
      p.approvedSecretAssignments === 8 &&
      p.productionRoutes === 0 &&
      p.productionDnsBindings === 0 &&
      p.privatePostgres === DNS[Object.keys(DNS)[0]] &&
      p.privateVault === DNS[Object.keys(DNS)[1]] &&
      p.publicVmIp === false,
    "AZURE_LIVE_ATTESTATION",
  );
}
function policy(p, value) {
  binding(p.runner);
  v.check(
    p.validationLease === value.id && p.build === value.approvedSha,
    "AZURE_POLICY_LEASE_BINDING",
  );
}
function dnsCheck(host, addresses) {
  v.check(
    Object.hasOwn(DNS, host) &&
      addresses.length > 0 &&
      addresses.every((x) => x === DNS[host]),
    "AZURE_PRIVATE_DNS",
  );
}
function isolation(state) {
  v.check(
    state.platform === "linux" &&
      state.uid === 1001 &&
      !state.groups.includes(0) &&
      !state.dockerSocket &&
      state.tmpfs &&
      state.addresses.includes("10.72.4.4") &&
      state.leaseUid === 0 &&
      (state.leaseMode & 0o022) === 0,
    "AZURE_VM_ISOLATION",
  );
}
function live() {
  const st = fs.statSync("/opt/opa/lease.json");
  isolation({
    platform: process.platform,
    uid: process.getuid(),
    groups: process.getgroups(),
    dockerSocket: fs.existsSync("/var/run/docker.sock"),
    tmpfs: fs
      .readFileSync("/proc/self/mountinfo", "utf8")
      .split("\n")
      .some((l) => l.split(" ")[4] === "/runner" && l.includes(" - tmpfs ")),
    addresses: Object.values(os.networkInterfaces())
      .flat()
      .map((x) => x.address),
    leaseUid: st.uid,
    leaseMode: st.mode,
  });
  for (const host of Object.keys(DNS))
    dnsCheck(
      host,
      execFileSync("/usr/bin/getent", ["ahostsv4", host], { encoding: "utf8" })
        .trim()
        .split("\n")
        .map((x) => x.trim().split(/\s+/)[0]),
    );
}
module.exports = {
  CONTRACT,
  DNS,
  binding,
  lease,
  policy,
  dnsCheck,
  isolation,
  live,
};
