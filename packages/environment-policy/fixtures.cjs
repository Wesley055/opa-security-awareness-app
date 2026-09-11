// Synthetic test-only resources. Never a deployable policy or acceptance endpoint.
const crypto = require("node:crypto");
const { hash, secretNames, settingNames } = require("./index.cjs");
function fixture(environment = "staging") {
  const id = (type, name) =>
    "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-" +
    environment +
    "/providers/" +
    type +
    "/" +
    name;
  const env = {
    OPA_ENVIRONMENT: environment,
    NODE_ENV: "production",
    OPA_BUILD_SHA: "fixture-build",
    OPA_API_ORIGIN: "https://" + environment + ".example.test",
    DATABASE_URL:
      "postgresql://runtime:fixture@" +
      environment +
      ".db.test:5432/opa_" +
      environment +
      "?sslmode=require&sslaccept=strict",
    REDIS_URL: "rediss://:fixture@" + environment + ".redis.test:10000",
    AZURE_STORAGE_CONNECTION_STRING:
      "DefaultEndpointsProtocol=https;AccountName=fixture" +
      environment +
      ";AccountKey=fixture;EndpointSuffix=core.windows.net",
    AZURE_STORAGE_CONTAINER: "evidence",
    ENROLLMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
    JWT_ACCESS_SECRET: crypto.randomBytes(32).toString("hex"),
    JWT_REFRESH_SECRET: crypto.randomBytes(32).toString("hex"),
    PII_CRYPTO_ADAPTER: "local",
    PII_ENCRYPTION_KEYS_JSON: JSON.stringify({
      fixture: crypto.randomBytes(32).toString("base64"),
    }),
    PII_ENCRYPTION_KEY_VERSION: "fixture",
    PII_LOOKUP_KEY: crypto.randomBytes(32).toString("base64"),
    PII_LOOKUP_KEY_VERSION: "fixture-lookup",
    OPA_SSO_ENABLED: "false",
  };
  const p = {
    version: 1,
    environment,
    purpose: "api",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    build: env.OPA_BUILD_SHA,
    resources: {
      app: {
        environment,
        id: id("Microsoft.Web/sites", "fixture"),
        origin: env.OPA_API_ORIGIN,
      },
      database: {
        environment,
        id: id("Microsoft.DBforPostgreSQL/flexibleServers", "fixture"),
        host: environment + ".db.test",
        port: 5432,
        database: "opa_" + environment,
        role: "runtime",
      },
      redis: {
        environment,
        id: id("Microsoft.Cache/redisEnterprise", "fixture"),
        host: environment + ".redis.test",
        port: 10000,
      },
      vault: {
        environment,
        id: id("Microsoft.KeyVault/vaults", "fixture"),
        secretOrigin: "https://" + environment + ".vault.test",
      },
      storage: {
        environment,
        id: id("Microsoft.Storage/storageAccounts", "fixture" + environment),
        accountName: "fixture" + environment,
        container: "evidence",
      },
    },
    settings: {},
    secrets: {},
  };
  env.OPA_DEPLOYMENT_RESOURCE_ID = p.resources.app.id;
  function bind() {
    for (const n of settingNames) p.settings[n] = env[n] ?? null;
    for (const n of secretNames) {
      if (env[n])
        p.secrets[n] = {
          environment,
          vaultId: p.resources.vault.id,
          secretId:
            p.resources.vault.secretOrigin + "/secrets/" + n + "/version",
          sha256: hash(env[n]),
        };
      else delete p.secrets[n];
    }
  }
  bind();
  return { env, p, bind };
}
module.exports = { fixture };
