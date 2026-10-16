// The running API must not take itself offline because a signed policy is old,
// and must not require durable runtime custody that was never installed.
// Signature, signer, build and resource bindings still fail closed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const policy = require("./index.cjs");
const trusted = require("./trusted-signers.json");
const { fixture } = require("./fixtures.cjs");

function signer(t) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const keyId = "fixture-continuity-" + crypto.randomUUID();
  // readPolicy uses the enrolled signer set; enrol a test key for this test only.
  trusted.production[keyId] = pair.publicKey.export({ type: "spki", format: "pem" });
  t.after(() => delete trusted.production[keyId]);
  const sign = (p) => {
    const bytes = Buffer.from(JSON.stringify(p));
    return {
      keyId,
      payload: bytes.toString("base64"),
      signature: crypto.sign(null, bytes, pair.privateKey).toString("base64"),
    };
  };
  return { keyId, pair, sign };
}
function write(t, envelope) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opa-continuity-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "policy.signed.json");
  fs.writeFileSync(file, JSON.stringify(envelope));
  return file;
}
const expired = (p) => ({ ...p, expiresAt: "2000-01-01T00:00:00Z" });

test("deployment, migration and endpoint approvals still fail closed when expired", (t) => {
  const { sign, keyId, pair } = signer(t);
  const { p } = fixture("production");
  const keys = { production: { [keyId]: pair.publicKey } };
  for (const purpose of ["api", "migration", "deployment", "endpoint"])
    assert.throws(() =>
      policy.verifyEnvelope(sign(expired({ ...p, purpose })), "production", purpose, keys),
    );
});

test("the running API accepts an expired but authentic api policy and warns", (t) => {
  const { sign } = signer(t);
  const { env, p } = fixture("production");
  const warnings = t.mock.method(console, "warn", () => {});
  const file = write(t, sign(expired(p)));
  const accepted = policy.readPolicy(file, "production", "api");
  assert.equal(accepted.build, p.build);
  assert.equal(policy.validateApi(env, accepted).build, p.build);
  assert.equal(warnings.mock.callCount(), 1);
  assert.match(String(warnings.mock.calls[0].arguments[0]), /expired/);
});

test("an expired migration policy is still rejected through readPolicy", (t) => {
  const { sign } = signer(t);
  const { p } = fixture("production");
  const file = write(t, sign(expired({ ...p, purpose: "migration" })));
  assert.throws(() => policy.readPolicy(file, "production", "migration"));
});

test("expiry tolerance never accepts a forged, tampered or unknown-signer policy", (t) => {
  const { sign } = signer(t);
  const { p } = fixture("production");
  t.mock.method(console, "warn", () => {});
  const good = sign(expired(p));
  const tampered = {
    ...good,
    payload: Buffer.from(JSON.stringify({ ...expired(p), build: "other" })).toString("base64"),
  };
  const stranger = crypto.generateKeyPairSync("ed25519");
  const bytes = Buffer.from(JSON.stringify(expired(p)));
  const forged = {
    keyId: "not-enrolled",
    payload: bytes.toString("base64"),
    signature: crypto.sign(null, bytes, stranger.privateKey).toString("base64"),
  };
  for (const envelope of [tampered, forged])
    assert.throws(() => policy.readPolicy(write(t, envelope), "production", "api"));
});

test("expiry tolerance keeps build and resource bindings", (t) => {
  const { sign } = signer(t);
  const { env, p } = fixture("production");
  t.mock.method(console, "warn", () => {});
  const accepted = policy.readPolicy(write(t, sign(expired(p))), "production", "api");
  for (const change of [
    (e) => (e.OPA_BUILD_SHA += "x"),
    (e) => (e.OPA_DEPLOYMENT_RESOURCE_ID += "x"),
    (e) => (e.OPA_API_ORIGIN = "https://wrong.example.test"),
  ]) {
    const changed = { ...env };
    change(changed);
    assert.throws(() => policy.validateApi(changed, accepted));
  }
});

test("a signed api policy needs no durable runtime custody to start or recheck", async (t) => {
  const { sign } = signer(t);
  const { env, p } = fixture("production");
  const file = write(t, sign(p));
  const runtimeEnv = { ...env, OPA_ENVIRONMENT_POLICY_FILE: file };
  // Never provisioned in production: refresh must not read or latch it.
  await policy.refreshRuntimeCustody(runtimeEnv);
  assert.equal(fs.existsSync("/home/opa-runtime-custody/continuity-blocked.json"), false);
  assert.equal(policy.recheckRuntimeCustody(runtimeEnv).build, p.build);
});

test("periodic recheck still rejects a policy whose bindings no longer match", (t) => {
  const { sign } = signer(t);
  const { env, p } = fixture("production");
  const runtimeEnv = {
    ...env,
    OPA_ENVIRONMENT_POLICY_FILE: write(t, sign(p)),
    OPA_BUILD_SHA: "replaced-build",
  };
  assert.throws(() => policy.recheckRuntimeCustody(runtimeEnv));
});
