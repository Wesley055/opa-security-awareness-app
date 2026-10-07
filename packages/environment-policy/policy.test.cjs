const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { fixture } = require("./fixtures.cjs");
const {
  validateApi,
  verifyEnvelope,
  endpoint,
  preflight,
} = require("./index.cjs");
test("signed staging resources pass and diagnostics expose only safe fields", () => {
  const { env, p } = fixture();
  const pair = crypto.generateKeyPairSync("ed25519");
  const payload = Buffer.from(JSON.stringify(p));
  const envelope = {
    keyId: "fixture",
    payload: payload.toString("base64"),
    signature: crypto.sign(null, payload, pair.privateKey).toString("base64"),
  };
  const verified = verifyEnvelope(envelope, "staging", "api", {
    staging: { fixture: pair.publicKey },
  });
  assert.equal(validateApi(env, verified).environment, "staging");
  assert.throws(() =>
    verifyEnvelope(envelope, "production", "api", {
      staging: { fixture: pair.publicKey },
    }),
  );
  assert.throws(() =>
    verifyEnvelope(
      { ...envelope, payload: Buffer.from("{}").toString("base64") },
      "staging",
      "api",
      { staging: { fixture: pair.publicKey } },
    ),
  );
  assert.throws(() => preflight(env));
  assert.deepEqual(
    Object.keys(validateApi(env, p)).sort(),
    [
      "build",
      "databaseEnvironment",
      "environment",
      "migrationReadiness",
      "notificationMode",
      "redisEnvironment",
      "ssoEnabled",
    ].sort(),
  );
});
for (const [name, change] of Object.entries({
  database: (f) =>
    (f.env.DATABASE_URL = f.env.DATABASE_URL.replace(
      "staging.db.test",
      "production.db.test",
    )),
  redis: (f) =>
    (f.env.REDIS_URL = f.env.REDIS_URL.replace(
      "staging.redis.test",
      "production.redis.test",
    )),
  vault: (f) => (f.p.secrets.PII_LOOKUP_KEY.vaultId = "production-vault"),
  storage: (f) =>
    (f.env.AZURE_STORAGE_CONNECTION_STRING =
      f.env.AZURE_STORAGE_CONNECTION_STRING.replace(
        "fixturestaging",
        "fixtureproduction",
      )),
  notification: (f) => (f.env.RESEND_API_KEY = "production-key"),
  missing_environment: (f) => delete f.env.OPA_ENVIRONMENT,
  lookup_key: (f) => delete f.env.PII_LOOKUP_KEY,
  enrollment_key: (f) => delete f.env.ENROLLMENT_ENCRYPTION_KEY,
  pii_ring: (f) => delete f.env.PII_ENCRYPTION_KEYS_JSON,
  key_binding: (f) =>
    (f.p.secrets.ENROLLMENT_ENCRYPTION_KEY.environment = "production"),
  db_override: (f) => {
    f.env.DATABASE_URL += "&host=production.db.test";
    f.bind();
  },
  insecure_tls: (f) => {
    f.env.DATABASE_URL = f.env.DATABASE_URL.replace(
      "strict",
      "accept_invalid_certs",
    );
    f.bind();
  },
  unknown_environment: (f) => (f.env.OPA_ENVIRONMENT = "preview"),
}))
  test("rejects " + name, () => {
    const f = fixture();
    change(f);
    assert.throws(() => validateApi(f.env, f.p));
  });
test("production rejects staging database", () => {
  const f = fixture("production");
  f.env.DATABASE_URL = fixture().env.DATABASE_URL;
  assert.throws(() => validateApi(f.env, f.p));
});
test("production retains live notification behavior and optional Redis after explicit configuration", () => {
  const f = fixture("production");
  delete f.env.REDIS_URL;
  delete f.p.resources.redis;
  f.bind();
  const d = validateApi(f.env, f.p);
  assert.equal(d.notificationMode, "live");
  assert.equal(d.redisEnvironment, "not-configured");
});
test("staging defaults disabled for notifications and SSO", () => {
  const f = fixture();
  assert.equal(validateApi(f.env, f.p).notificationMode, "disabled");
  assert.equal(validateApi(f.env, f.p).ssoEnabled, false);
});
const policy = {
  purpose: "endpoint",
  environment: "staging",
  apiOrigin: "https://staging.example.test",
  build: "fixture",
  httpsVerifiedAt: new Date().toISOString(),
};
for (const [name, url, e] of [
  ["missing", undefined, "staging"],
  ["production", "https://production.example.test", "staging"],
  ["HTTP", "http://staging.example.test", "staging"],
  ["wrong classification", "https://staging.example.test", "production"],
])
  test("preview rejects " + name, () =>
    assert.throws(() =>
      endpoint(
        {
          OPA_ENVIRONMENT: e,
          EAS_BUILD_PROFILE: "preview",
          OPA_API_BASE_URL: url,
        },
        policy,
      ),
    ),
  );
test("preview verified staging fixture passes", () =>
  assert.equal(
    endpoint(
      {
        OPA_ENVIRONMENT: "staging",
        EAS_BUILD_PROFILE: "preview",
        OPA_API_BASE_URL: policy.apiOrigin,
      },
      policy,
    ),
    policy.apiOrigin,
  ));
test("unknown EAS profile fails", () =>
  assert.throws(() =>
    endpoint(
      {
        OPA_ENVIRONMENT: "staging",
        EAS_BUILD_PROFILE: "unexpected",
        OPA_API_BASE_URL: policy.apiOrigin,
      },
      policy,
    ),
  ));

test("production signer rotation preserves historical signer and accepts enrolled successor", () => {
  const oldPair = crypto.generateKeyPairSync("ed25519");
  const newPair = crypto.generateKeyPairSync("ed25519");

  const keys = {
    production: {
      "opa-production-release-old": oldPair.publicKey,
      "opa-production-release-new": newPair.publicKey,
    },
  };

  const makeEnvelope = (keyId, pair) => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        environment: "production",
        purpose: "endpoint",
        apiOrigin: "https://production.example.test",
        build: "fixture-build",
        httpsVerifiedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    return {
      keyId,
      payload: payload.toString("base64"),
      signature: crypto.sign(null, payload, pair.privateKey).toString("base64"),
    };
  };

  assert.equal(
    verifyEnvelope(
      makeEnvelope("opa-production-release-old", oldPair),
      "production",
      "endpoint",
      keys,
    ).build,
    "fixture-build",
  );

  assert.equal(
    verifyEnvelope(
      makeEnvelope("opa-production-release-new", newPair),
      "production",
      "endpoint",
      keys,
    ).build,
    "fixture-build",
  );
});

test("production signer rotation fails closed for unknown and substituted key IDs", () => {
  const oldPair = crypto.generateKeyPairSync("ed25519");
  const newPair = crypto.generateKeyPairSync("ed25519");

  const keys = {
    production: {
      "opa-production-release-old": oldPair.publicKey,
      "opa-production-release-new": newPair.publicKey,
    },
  };

  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      environment: "production",
      purpose: "endpoint",
      apiOrigin: "https://production.example.test",
      build: "fixture-build",
      httpsVerifiedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  );

  const signature = crypto.sign(null, payload, oldPair.privateKey).toString("base64");

  assert.throws(() =>
    verifyEnvelope(
      {
        keyId: "opa-production-release-unknown",
        payload: payload.toString("base64"),
        signature,
      },
      "production",
      "endpoint",
      keys,
    ),
  );

  assert.throws(() =>
    verifyEnvelope(
      {
        keyId: "opa-production-release-new",
        payload: payload.toString("base64"),
        signature,
      },
      "production",
      "endpoint",
      keys,
    ),
  );
});

test("production policy cannot be authorized by staging signer", () => {
  const pair = crypto.generateKeyPairSync("ed25519");

  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      environment: "production",
      purpose: "endpoint",
      apiOrigin: "https://production.example.test",
      build: "fixture-build",
      httpsVerifiedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  );

  const envelope = {
    keyId: "opa-staging-release-fixture",
    payload: payload.toString("base64"),
    signature: crypto.sign(null, payload, pair.privateKey).toString("base64"),
  };

  assert.throws(() =>
    verifyEnvelope(envelope, "production", "endpoint", {
      staging: {
        "opa-staging-release-fixture": pair.publicKey,
      },
    }),
  );
});
