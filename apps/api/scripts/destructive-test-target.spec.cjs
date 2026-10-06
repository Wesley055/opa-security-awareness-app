const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  assertDisposableTestUrl,
  assertNotPhysical,
} = require("./destructive-test-target.cjs");
for (const name of ["opa_delegation_test", "opa_delegation_acceptance"])
  test("protects physical " + name, () => {
    assert.throws(
      () =>
        assertDisposableTestUrl("postgresql://127.0.0.1:55439/" + name, name),
      /PHYSICAL_ACCEPTANCE_DATABASE_PROTECTED/,
    );
    assert.throws(
      () => assertNotPhysical("postgresql://localhost:55440/" + name),
      /PHYSICAL_ACCEPTANCE_DATABASE_PROTECTED/,
    );
  });
test("requires exact opt-in for a separate automated database", () => {
  const name = "opa_automated_pa_fixture_test";
  assert.equal(
    assertDisposableTestUrl("postgresql://127.0.0.1:55439/" + name, name),
    name,
  );
  assert.throws(() =>
    assertDisposableTestUrl("postgresql://127.0.0.1:55439/" + name, undefined),
  );
  assert.throws(() =>
    assertDisposableTestUrl("postgresql://127.0.0.1:55439/" + name, "wrong"),
  );
});
for (const value of [
  "postgresql://db.production/opa_automated_fixture_test",
  "postgresql://localhost/opa_production",
  "postgresql://localhost/dev_test",
  "https://localhost/opa_automated_fixture_test",
  "invalid",
])
  test("rejects unsafe target " + value, () =>
    assert.throws(() =>
      assertDisposableTestUrl(value, "opa_automated_fixture_test"),
    ),
  );
