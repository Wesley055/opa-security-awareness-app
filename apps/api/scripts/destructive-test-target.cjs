// No connections or mutations: reject unsafe targets before migrate/truncate.
const protectedNames = new Set([
  "opa_delegation_test",
  "opa_delegation_acceptance",
]);
function assertNotPhysical(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("TEST_DATABASE_URL_INVALID");
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (protectedNames.has(name))
    throw Error("PHYSICAL_ACCEPTANCE_DATABASE_PROTECTED");
  return { url, name };
}
function assertDisposableTestUrl(value, confirmation) {
  const { url, name } = assertNotPhysical(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^opa_automated_[a-z0-9_]+_test$/.test(name) ||
    name.length > 63 ||
    confirmation !== name
  )
    throw Error("EXPLICIT_DISPOSABLE_TEST_DATABASE_REQUIRED");
  return name;
}
module.exports = { assertNotPhysical, assertDisposableTestUrl };
