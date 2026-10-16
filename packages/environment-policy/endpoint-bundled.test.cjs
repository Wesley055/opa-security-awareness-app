// The website uses the signed production endpoint policy committed with the
// release, so a deployment never depends on an uncommitted runtime file.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadEndpoint } = require("./index.cjs");
const committed = require("./release/production-endpoint.json");
const signedOrigin = JSON.parse(
  Buffer.from(committed.payload, "base64").toString("utf8"),
).apiOrigin;
const production = (extra = {}) => ({
  OPA_ENVIRONMENT: "production",
  NODE_ENV: "production",
  OPA_API_URL: signedOrigin,
  ...extra,
});

test("production uses the committed signed policy when no file is configured", () => {
  assert.equal(loadEndpoint(production()), signedOrigin);
  assert.equal(
    loadEndpoint(production({ OPA_ENDPOINT_POLICY_FILE: "bundled" })),
    signedOrigin,
  );
});

test("the bundled policy still binds the API origin", () => {
  assert.throws(() =>
    loadEndpoint(production({ OPA_API_URL: "https://wrong.example.test" })),
  );
});

test("non-production environments cannot use the production bundle", () => {
  assert.throws(() =>
    loadEndpoint({
      OPA_ENVIRONMENT: "staging",
      NODE_ENV: "production",
      OPA_API_URL: signedOrigin,
    }),
  );
});

test("an explicitly configured but missing policy file fails closed", () => {
  assert.throws(() =>
    loadEndpoint(production({ OPA_ENDPOINT_POLICY_FILE: "policies/missing.json" })),
  );
});
