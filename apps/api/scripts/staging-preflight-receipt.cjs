"use strict";
const boundary = require("../../../packages/environment-policy/index.cjs");
const g = require("./staging-gates.cjs");
const v = require("./staging-database-verifier.cjs");
function bindings(envelope, p) {
  return {
    candidateSha: p.build,
    policySha256: g.hash(envelope),
    leaseSha256: g.hash(p.lease),
    lease: p.lease,
    source: p.source,
    identity: p.identity,
    subnet: p.subnet,
    server: p.server,
    runtimeDatabase: p.runtimeDatabase,
    privatePostgres: p.privatePostgres,
    privateVault: p.privateVault,
    manifestHash: p.manifestHash,
    runtimeSecretSha256: p.runtimeSecretSha256,
    receiptDirectory: "/opt/opa/evidence/modular-" + p.lease,
    gates: p.gates,
    executionAuthorized: p.execute === true,
  };
}
function draft(envelope, p, evidenceHash, migrationManifestHash) {
  return {
    version: 1,
    environment: "staging",
    purpose: "modular-preflight",
    ...bindings(envelope, p),
    issuedAt: new Date().toISOString(),
    expiresAt: p.expiresAt,
    result: "PASS",
    checks: {
      build: "PASS",
      runtimeReadOnly: "PASS",
      sentinel: "PASS",
      migrations: 35,
      failedMigrations: 0,
      checksums: "PASS",
      order: "PASS",
      schemaParity: "PASS",
    },
    evidenceHash,
    migrationManifestHash,
  };
}
function verify(receipt, envelope, p, expectedMigrationHash) {
  const r = boundary.verifyEnvelope(receipt, "staging", "modular-preflight");
  v.check(receipt.keyId === envelope.keyId, "PREFLIGHT_AUTHORITY");
  const expected = bindings(envelope, p);
  for (const key of Object.keys(expected))
    v.check(g.hash(r[key]) === g.hash(expected[key]), "PREFLIGHT_BINDING");
  const now = Date.now();
  v.check(
    Number.isFinite(Date.parse(r.issuedAt)) &&
      Date.parse(r.issuedAt) <= now &&
      now - Date.parse(r.issuedAt) <= 3600000 &&
      Date.parse(r.expiresAt) <= Date.parse(p.expiresAt),
    "PREFLIGHT_FRESHNESS",
  );
  v.check(
    r.result === "PASS" &&
      g.hash(r.checks) === g.hash(draft(envelope, p, "", "").checks) &&
      /^[a-f0-9]{64}$/.test(r.evidenceHash) &&
      r.migrationManifestHash === expectedMigrationHash,
    "PREFLIGHT_PROOF",
  );
  return r;
}
module.exports = { bindings, draft, verify };
