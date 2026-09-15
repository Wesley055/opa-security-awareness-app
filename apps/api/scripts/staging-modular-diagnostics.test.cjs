"use strict";
/* global __dirname */
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto");
const { URL } = require("node:url");
const { Buffer } = require("node:buffer");
const D = require("./staging-modular-diagnostics.cjs"),
  G = require("./staging-gates.cjs"),
  B = require("../../../packages/environment-policy/index.cjs");
const source = fs.readFileSync(
  path.join(__dirname, "staging-gate-runner.cjs"),
  "utf8",
);
const scope =
  "/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/rg-opa-staging";
const fields = () => ({
  version: 1,
  environment: "staging",
  purpose: "modular-validation",
  build: "a".repeat(40),
  lease: "b".repeat(24),
  source: "10.72.4.4/32",
  repository: "Wesley055/opa-security-awareness-app",
  branch: "integration/institutional-security",
  execute: true,
  mode: "disposable-validation",
  server: "opa-pg-staging.postgres.database.azure.com",
  runtimeDatabase: "opa_staging",
  identity:
    scope +
    "/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-opa-staging-migrations",
  productionAssignments: 0,
  productionRoutes: 0,
  publicVmIp: false,
  subnet:
    scope +
    "/providers/Microsoft.Network/virtualNetworks/vnet-opa-staging/subnets/snet-opa-staging-runner",
  region: "southafricanorth",
  privatePostgres: "10.72.1.4",
  privateVault: "10.72.2.4",
  isolation: "private-postgres-only",
  notifications: "disabled",
  sso: "synthetic-only",
  cleanupOwner: "operator-host",
  runtimeSecretSha256: "c".repeat(64),
  manifestHash: G.hash(G.manifest),
  gates: G.ORDER,
  expiresAt: new Date(Date.now() + 3000000).toISOString(),
});
function replica(fault, prepare = true, sourceText = source, candidateSha) {
  const p = fields(),
    output = new Map(),
    calls = [],
    clients = [];
  if (candidateSha) p.build = candidateSha;
  let policyCalls = 0;
  const hit = (op) => {
    calls.push(op);
    if (op === fault)
      throw Object.assign(
        new Error("synthetic credential=DO_NOT_RETAIN SELECT private_query"),
        { code: op === "DNS" ? "ENOTFOUND" : undefined },
      );
  };
  const input = {
    policy: { keyId: "synthetic", payload: "synthetic" },
    runtimeUrl:
      "postgresql://synthetic:DO_NOT_RETAIN@opa-pg-staging.postgres.database.azure.com/opa_staging?sslmode=require&sslaccept=strict",
    vaultToken:
      "x." +
      Buffer.from(
        JSON.stringify({
          oid: "737caf69-640d-485e-9be5-c0095633a27e",
          tid: "adb3fb59-1ac3-42c2-b39a-d70c7006ccbc",
        }),
      ).toString("base64url") +
      ".x",
    preflightReceipt: { synthetic: true },
  };
  p.runtimeSecretSha256 = G.hash(input.runtimeUrl);
  const expected = Array.from({ length: 35 }, (_, i) => ({
    name: "migration" + i,
    checksum: "0".repeat(64),
  }));
  class Client {
    constructor(o) {
      this.o = o;
      clients.push(this);
    }
    async connect() {
      hit(this.o.database === "postgres" ? "ADMIN_CONNECT" : "RUNTIME_CONNECT");
    }
    async query() {
      hit("LOCK");
      return { rows: [{ held: true }] };
    }
    async end() {
      this.closed = true;
      if (this.o.database !== "postgres") hit("RUNTIME_CLOSE");
    }
  }
  const vf = {
    ROOT: "/source",
    SERVER: p.server,
    RUNTIME: p.runtimeDatabase,
    check: (x, c) => {
      if (!x) throw Error(c);
    },
    databaseUrl: (x) => {
      hit("FINGERPRINT");
      return new URL(x);
    },
    identity: async (db) => {
      if (db.o.database !== "postgres") hit("RUNTIME_IDENTITY");
    },
    manifest: () => {
      hit("MIGRATION_MANIFEST");
      return expected;
    },
    committed: () => {},
    manifestHash: G.hash,
    verifyMigrated: async () => {
      hit("RUNTIME_VERIFY");
      return {
        readOnly: true,
        history: expected.map((x) => ({ migration_name: x.name })),
      };
    },
  };
  const fakeG = {
    ...G,
    inventory: () => hit("MANIFEST"),
    writeOnce: (file, value) => {
      if (output.has(file)) throw Object.assign(Error(), { code: "EEXIST" });
      output.set(file, JSON.parse(JSON.stringify(value)));
    },
    run: async (c, a) => {
      const release = await a.lock();
      try {
        await a.preflight();
        await a.assertAbsent({ ...c, gate: "database" });
        try {
          await a.create({ ...c, gate: "database" });
          if (fault === "READINESS_INITIALIZATION")
            await a.suite(
              { ...c, gate: "database" },
              "migration-integrity.int-spec.ts",
            );
        } catch (e) {
          a.diagnosticFailure(e);
          await a.cleanup({ ...c, gate: "database" });
          throw e;
        }
        return {};
      } finally {
        await release();
      }
    },
  };
  const rr = {
    verify: () => {
      hit("PREFLIGHT_RECEIPT");
      return {};
    },
    draft: () => ({ result: "PASS" }),
  };
  const modules = {
    "node:process": {
      platform: "linux",
      getuid: () => 0,
      version: "v22.23.2",
      execPath: "/node",
      kill: () => {},
    },
    "node:buffer": { Buffer },
    "node:fs": {
      readdirSync: () => [],
      mkdirSync: () => hit("RECEIPT_DIRECTORY"),
      readFileSync: (f) => JSON.stringify(output.get(f)),
      existsSync: () => false,
      mkdtempSync: () => hit("READINESS_INITIALIZATION"),
    },
    "node:path": path,
    "node:crypto": crypto,
    "node:dns": {
      promises: {
        lookup: async (h) => {
          hit("DNS");
          return [{ address: h === p.server ? "10.72.1.4" : "10.72.2.4" }];
        },
      },
    },
    "node:os": {
      totalmem: () => {
        hit("HOST");
        return 8 * 1024 ** 3;
      },
      cpus: () => [{}, {}],
      networkInterfaces: () => {
        hit("SOURCE_RECHECK");
        return { eth: [{ address: "10.72.4.4" }] };
      },
    },
    "node:child_process": {
      spawnSync: (command, args) => {
        if (command === "git") {
          hit("CHECKOUT");
          if (args.includes("rev-parse")) return { status: 0, stdout: p.build };
          if (args.includes("branch")) return { status: 0, stdout: p.branch };
          return { status: 0, stdout: "" };
        }
        if (args.includes("--version")) {
          hit("TOOLCHAIN");
          return { status: 0, stdout: "10.9.8" };
        }
        const op = args.includes("generate")
          ? "BUILD_GENERATE"
          : args.includes("validate")
            ? "BUILD_VALIDATE"
            : args.includes("diff")
              ? "SCHEMA_PARITY"
              : "BUILD_API";
        hit(op);
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
    },
    "./staging-database-verifier.cjs": vf,
    "./staging-gates.cjs": fakeG,
    "./staging-gate-custodian.cjs": {
      operate: async (_a, _b, _c, action) => {
        hit(
          action === "absent"
            ? "GATE_ABSENCE"
            : action === "create"
              ? "GATE_CREATE"
              : "GATE_CLEANUP",
        );
        return { databaseAbsent: true, roleAbsent: true };
      },
    },
    "../../../packages/environment-policy/index.cjs": {
      verifyEnvelope: () => {
        hit(policyCalls++ === 0 ? "POLICY" : "AUTHORIZATION");
        return p;
      },
    },
    "./staging-integration-results.cjs": {},
    "./staging-modular-diagnostics.cjs": D,
    "./staging-preflight-receipt.cjs": rr,
    "prisma/package.json": { version: "6.19.3" },
    "@prisma/client/package.json": { version: "6.19.3" },
    pg: { Client },
  };
  const req = (n) => {
    assert.ok(n in modules, "unexpected module " + n);
    return modules[n];
  };
  req.resolve = (n) => "/fake/" + n;
  const box = {
    module: { exports: {} },
    require: req,
    URL,
    Date,
    fetch: async () => {
      hit("VAULT");
      return {
        ok: true,
        status: 200,
        json: async () => {
          hit("BOOTSTRAP_SECRET");
          return {
            value: "DO_NOT_RETAIN",
            id:
              "https://opa-kv-staging.vault.azure.net/secrets/opa-staging-bootstrap-db-password/" +
              "d".repeat(32),
          };
        },
      };
    },
    AbortSignal: { timeout: () => null },
  };
  vm.runInNewContext(sourceText, box, { filename: "staging-gate-runner.cjs" });
  return {
    run: () => box.module.exports[prepare ? "preflight" : "execute"](input),
    output,
    calls,
    clients,
    input,
  };
}
for (const op of [
  "POLICY",
  "HOST",
  "CHECKOUT",
  "MANIFEST",
  "FINGERPRINT",
  "SOURCE_RECHECK",
  "TOOLCHAIN",
  "BOOTSTRAP_SECRET",
  "DNS",
  "VAULT",
  "RECEIPT_DIRECTORY",
  "MIGRATION_MANIFEST",
  "BUILD_GENERATE",
  "BUILD_VALIDATE",
  "BUILD_API",
  "RUNTIME_CONNECT",
  "RUNTIME_IDENTITY",
  "RUNTIME_VERIFY",
  "RUNTIME_CLOSE",
  "SCHEMA_PARITY",
]) {
  test("offline real runner transition: " + op, async () => {
    const r = replica(op);
    await assert.rejects(r.run(), (e) => {
      assert.equal(e.diagnostic.stage, op);
      if (op === "RUNTIME_CLOSE")
        assert.equal(e.diagnostic.cleanupOutcome, "FAIL");
      assert.ok(!JSON.stringify(e.diagnostic).includes("DO_NOT_RETAIN"));
      assert.ok(
        e.diagnostic.errorCode === "UNKNOWN_" + op ||
          e.diagnostic.errorCode === "ENOTFOUND",
      );
      return true;
    });
    assert.ok(!r.calls.includes("GATE_CREATE"));
    assert.ok(r.clients.every((c) => c.closed));
    assert.equal(r.input.runtimeUrl, "");
    assert.equal(r.input.vaultToken, undefined);
  });
}
test("authoritative preparation performs schema parity once and never creates DB", async () => {
  const r = replica();
  const result = await r.run();
  assert.equal(result.result, "PASS");
  assert.equal(r.calls.filter((x) => x === "SCHEMA_PARITY").length, 1);
  assert.ok(!r.calls.includes("GATE_CREATE"));
});
for (const op of [
  "ADMIN_CONNECT",
  "LOCK",
  "PREFLIGHT_RECEIPT",
  "AUTHORIZATION",
  "READINESS_INITIALIZATION",
  "GATE_ABSENCE",
  "GATE_CREATE",
]) {
  test("execution handoff failure: " + op, async () => {
    const r = replica(op, false);
    await assert.rejects(r.run(), (e) => {
      assert.equal(e.diagnostic.stage, op);
      return true;
    });
    assert.ok(!r.calls.includes("SCHEMA_PARITY"));
    assert.ok(r.clients.every((c) => c.closed));
  });
}
test("execution verifies receipt without repeating preflight", async () => {
  const r = replica(undefined, false);
  await r.run();
  assert.ok(r.calls.includes("PREFLIGHT_RECEIPT"));
  assert.ok(!r.calls.includes("BUILD_API"));
  assert.ok(!r.calls.includes("SCHEMA_PARITY"));
});
for (const op of D.operations)
  test("unknown exception stays classified at " + op, () => {
    const d = D.classify(Error("DO_NOT_RETAIN"), op);
    assert.equal(d.errorCode, "UNKNOWN_" + op);
    assert.ok(!JSON.stringify(d).includes("DO_NOT_RETAIN"));
  });
test("nested transport, SQLSTATE, child timeout and HTTP retain only safe fields", () => {
  assert.equal(
    D.classify({ cause: { code: "ENOTFOUND" } }, "DNS").transportClassification,
    "DNS",
  );
  assert.equal(
    D.classify({ code: "42501" }, "RUNTIME_VERIFY").sqlstate,
    "42501",
  );
  const x = D.classify(Error("DO_NOT_RETAIN"), "BUILD_API", 3, {
    status: null,
    signal: "SIGTERM",
    error: { code: "ETIMEDOUT" },
    durationMs: 99,
    stdout: "DO_NOT_RETAIN",
    stderr: "DO_NOT_RETAIN",
    httpStatus: 403,
  });
  assert.equal(x.timeoutClassification, "TIMEOUT");
  assert.equal(x.durationMs, 99);
  assert.equal(x.httpStatus, 403);
  assert.ok(!JSON.stringify(x).includes("DO_NOT_RETAIN"));
});
test("cleanup failure cannot replace initial classification or become PASS", () => {
  const d = D.tracker();
  d.mark("RUNTIME_VERIFY");
  const e = Error("secret");
  d.capture(e);
  d.mark("FINAL_CLEANUP");
  d.capture(Error("cleanup secret"));
  d.cleanup("FAIL");
  d.cleanup("PASS");
  const x = d.report(e);
  assert.equal(x.stage, "RUNTIME_VERIFY");
  assert.equal(x.cleanupOutcome, "FAIL");
});
test("artifact writer failure remains available for supervisor mapping", () => {
  const d = D.tracker();
  d.mark("ARTIFACT_WRITE");
  d.setWriter(() => {
    throw Error("secret");
  });
  const r = d.report(Error("secret"));
  assert.equal(d.persist(r), "FAIL");
  assert.equal(r.errorCode, "UNKNOWN_ARTIFACT_WRITE");
});
// Use an ephemeral test authority only; production/staging signing keys are never accessed.
const key = crypto.generateKeyPairSync("ed25519"),
  keys = { staging: { test: key.publicKey } };
const receiptSource = fs.readFileSync(
  path.join(__dirname, "staging-preflight-receipt.cjs"),
  "utf8",
);
const receiptBox = {
  module: { exports: {} },
  require: (n) =>
    n.includes("environment-policy")
      ? { verifyEnvelope: (e, a, b) => B.verifyEnvelope(e, a, b, keys) }
      : n === "./staging-gates.cjs"
        ? G
        : {
            check: (x, c) => {
              if (!x) throw Error(c);
            },
          },
  Date,
  JSON,
};
vm.runInNewContext(receiptSource, receiptBox);
const H = receiptBox.module.exports;
function sign(p) {
  const bytes = Buffer.from(JSON.stringify(p));
  return {
    keyId: "test",
    payload: bytes.toString("base64"),
    signature: crypto.sign(null, bytes, key.privateKey).toString("base64"),
  };
}
test("signed receipt binds exact policy, lease, host, database, manifest and directory", () => {
  const p = fields(),
    e = sign(p),
    r = H.draft(e, p, "e".repeat(64), "f".repeat(64));
  assert.equal(H.verify(sign(r), e, p, "f".repeat(64)).result, "PASS");
  for (const field of Object.keys(H.bindings(e, p))) {
    const changed = { ...r, [field]: "mismatch" };
    assert.throws(
      () => H.verify(sign(changed), e, p, "f".repeat(64)),
      undefined,
      field,
    );
  }
  assert.throws(() =>
    H.verify(
      sign({ ...r, checks: { ...r.checks, schemaParity: "FAIL" } }),
      e,
      p,
      "f".repeat(64),
    ),
  );
  assert.throws(() =>
    H.verify(
      sign({ ...r, expiresAt: new Date(0).toISOString() }),
      e,
      p,
      "f".repeat(64),
    ),
  );
  assert.throws(() =>
    H.verify({ ...sign(r), signature: "bad" }, e, p, "f".repeat(64)),
  );
});

module.exports = { replica };

test("missing identity and fingerprint fail closed before any connection", async () => {
  for (const [field, value, stage, code] of [
    ["vaultToken", "invalid", "IDENTITY", "GATE_IDENTITY"],
    ["runtimeUrl", "invalid", "FINGERPRINT", "GATE_SECRET_FINGERPRINT"],
  ]) {
    const r = replica();
    r.input[field] = value;
    await assert.rejects(r.run(), (e) => {
      assert.equal(e.diagnostic.stage, stage);
      assert.equal(e.diagnostic.errorCode, code);
      return true;
    });
    assert.equal(r.clients.length, 0);
    assert.equal(r.input.runtimeUrl, "");
    assert.equal(r.input.vaultToken, undefined);
  }
});
test("Prisma process code and TLS code survive without raw output", () => {
  const r = D.classify(Error("GATE_SCHEMA_PARITY"), "SCHEMA_PARITY", 12, {
    status: 1,
    prismaCode: "P1001",
    stderr: "credential=DO_NOT_RETAIN",
  });
  assert.equal(r.prismaCode, "P1001");
  assert.equal(r.errorCode, "P1001");
  assert.equal(r.exitCode, 1);
  assert.equal(
    D.classify({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }, "RUNTIME_CONNECT")
      .transportClassification,
    "TLS",
  );
  assert.ok(!JSON.stringify(r).includes("DO_NOT_RETAIN"));
});
