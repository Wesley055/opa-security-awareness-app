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
