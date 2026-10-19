const test = require("node:test");
const assert = require("node:assert");
const { classify } = require("./index.cjs");

test("the production-apk EAS profile is classified as production", () => {
  assert.equal(classify({ OPA_ENVIRONMENT: "production", EAS_BUILD_PROFILE: "production-apk" }), "production");
});
test("an unknown or mismatched profile is still refused", () => {
  assert.throws(() => classify({ OPA_ENVIRONMENT: "production", EAS_BUILD_PROFILE: "preview" }));
  assert.throws(() => classify({ OPA_ENVIRONMENT: "production", EAS_BUILD_PROFILE: "something-else" }));
});
test("debug mode names the rejecting rule without values", () => {
  process.env.OPA_PREFLIGHT_DEBUG = "1";
  try {
    assert.throws(() => classify({ OPA_ENVIRONMENT: "nope" }), /\[rule .*index\.cjs:\d+/);
  } finally {
    delete process.env.OPA_PREFLIGHT_DEBUG;
  }
});
test("the endpoint check accepts production and production-apk alike (real committed policy)", () => {
  const { loadEndpoint } = require("./index.cjs");
  const base = {
    OPA_ENVIRONMENT: "production",
    OPA_API_BASE_URL: "https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net",
    OPA_ENDPOINT_POLICY_FILE: require("node:path").join(__dirname, "release/production-endpoint.json"),
  };
  const store = loadEndpoint({ ...base, EAS_BUILD_PROFILE: "production" });
  assert.equal(loadEndpoint({ ...base, EAS_BUILD_PROFILE: "production-apk" }), store);
  assert.throws(() => loadEndpoint({ ...base, EAS_BUILD_PROFILE: "preview" }));
});
