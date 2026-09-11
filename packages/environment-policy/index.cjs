/* Shared Node-only deployment boundary. No env-provided trust keys. */
const fs = require("node:fs");
const crypto = require("node:crypto");
const trusted = require("./trusted-signers.json");
const environments = ["development", "staging", "production"];
const secretNames = [
  "DATABASE_URL",
  "REDIS_URL",
  "AZURE_STORAGE_CONNECTION_STRING",
  "ENROLLMENT_ENCRYPTION_KEY",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "PII_ENCRYPTION_KEYS_JSON",
  "PII_LOOKUP_KEY",
  "SSO_ENCRYPTION_KEYS",
  "SSO_LOOKUP_KEY",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "AFRICASTALKING_API_KEY",
];
const settingNames = [
  "AZURE_STORAGE_CONTAINER",
  "PII_CRYPTO_ADAPTER",
  "PII_ENCRYPTION_KEY_VERSION",
  "PII_LOOKUP_KEY_VERSION",
  "ALLOWED_ORIGINS",
  "OPA_WEB_URL",
  "SSO_WEB_ORIGIN",
  "RESEND_FROM_ADDRESS",
  "RESEND_ACCOUNT_SCOPE",
  "AFRICASTALKING_USERNAME",
  "AFRICASTALKING_SENDER_ID",
  "AFRICASTALKING_ACCOUNT_SCOPE",
  "OPA_NOTIFICATION_MODE",
  "OPA_NOTIFICATION_ALLOWLIST_JSON",
  "OPA_NOTIFICATION_MAX_PER_HOUR",
  "OPA_NOTIFICATION_MAX_PER_RUN",
  "OPA_ACCEPTANCE_RUN_ID",
  "OPA_SSO_ENABLED",
  "OPA_API_ORIGIN",
  "PII_DELIVERY_ACTORS_JSON",
  "PII_DELIVERY_ACTOR_USER_ID",
];
function fail() {
  throw new Error("OPA environment preflight rejected configuration");
}
function classify(env) {
  const e = env.OPA_ENVIRONMENT;
  if (!environments.includes(e)) fail();
  if (
    env.EAS_BUILD_PROFILE &&
    {
      development: "development",
      preview: "staging",
      production: "production",
    }[env.EAS_BUILD_PROFILE] !== e
  )
    fail();
  if (
    e === "development" &&
    (env.WEBSITE_INSTANCE_ID || env.OPA_DEPLOYMENT_RESOURCE_ID)
  )
    fail();
  return e;
}
function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function verifyEnvelope(envelope, environment, purpose, keys = trusted) {
  try {
    const key = keys[environment]?.[envelope.keyId];
    if (
      !key ||
      typeof envelope.payload !== "string" ||
      typeof envelope.signature !== "string"
    )
      fail();
    const bytes = Buffer.from(envelope.payload, "base64");
    if (
      !crypto.verify(
        null,
        bytes,
        key,
        Buffer.from(envelope.signature, "base64"),
      )
    )
      fail();
    const p = JSON.parse(bytes.toString("utf8"));
    if (
      p.version !== 1 ||
      p.environment !== environment ||
      p.purpose !== purpose ||
      !Number.isFinite(Date.parse(p.expiresAt)) ||
      Date.parse(p.expiresAt) <= Date.now()
    )
      fail();
    return p;
  } catch {
    fail();
  }
}
function readPolicy(file, environment, purpose) {
  try {
    if (!file) fail();
    return verifyEnvelope(
      JSON.parse(fs.readFileSync(file, "utf8")),
      environment,
      purpose,
    );
  } catch {
    fail();
  }
}
function httpsOrigin(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      u.origin !== value
    )
      fail();
    return u.origin;
  } catch {
    fail();
  }
}
function endpoint(env, policy) {
  const e = classify(env);
  const value = env.OPA_API_BASE_URL || env.OPA_API_URL;
  if (
    env.OPA_API_BASE_URL &&
    env.OPA_API_URL &&
    env.OPA_API_BASE_URL !== env.OPA_API_URL
  )
    fail();
  if (e === "development") {
    if (!value) return null;
    const u = new URL(value);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      fail();
    return value.replace(/\/+$/, "");
  }
  if (
    !policy ||
    policy.environment !== e ||
    policy.purpose !== "endpoint" ||
    httpsOrigin(value) !== httpsOrigin(policy.apiOrigin)
  )
    fail();
  if (
    env.EAS_BUILD_PROFILE &&
    {
      preview: "staging",
      production: "production",
      development: "development",
    }[env.EAS_BUILD_PROFILE] !== e
  )
    fail();
  if (
    !policy.build ||
    !Number.isFinite(Date.parse(policy.httpsVerifiedAt)) ||
    Date.parse(policy.httpsVerifiedAt) > Date.now()
  )
    fail();
  return value;
}
function loadEndpoint(env) {
  const e = classify(env);
  return endpoint(
    env,
    e === "development"
      ? null
      : readPolicy(env.OPA_ENDPOINT_POLICY_FILE, e, "endpoint"),
  );
}
function resource(r, env, type) {
  const parts = typeof r?.id === "string" ? r.id.split("/") : [];
  if (
    parts.length !== 9 ||
    parts[1]?.toLowerCase() !== "subscriptions" ||
    !/^[a-f0-9-]{36}$/i.test(parts[2] || "") ||
    parts[3]?.toLowerCase() !== "resourcegroups" ||
    !parts[4] ||
    parts[5]?.toLowerCase() !== "providers" ||
    (parts[6] + "/" + parts[7]).toLowerCase() !== type.toLowerCase() ||
    !parts[8]
  )
    fail();
  if (
    !r ||
    r.environment !== env ||
    typeof r.id !== "string" ||
    !r.id.toLowerCase().includes("/providers/" + type.toLowerCase() + "/")
  )
    fail();
}
function databaseBinding(value, binding) {
  try {
    const u = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(u.protocol) ||
      u.hostname !== binding.host ||
      Number(u.port || 5432) !== binding.port ||
      decodeURIComponent(u.pathname.slice(1)) !== binding.database ||
      decodeURIComponent(u.username) !== binding.role ||
      u.hash
    )
      fail();
    const entries = [...u.searchParams];
    if (
      entries.length !== 2 ||
      u.searchParams.get("sslmode") !== "require" ||
      u.searchParams.get("sslaccept") !== "strict" ||
      new Set(entries.map(([k]) => k)).size !== 2
    )
      fail();
  } catch {
    fail();
  }
}
function validateApi(env, p) {
  try {
    const e = classify(env);
    if (e === "development")
      return {
        environment: e,
        notificationMode: "development",
        ssoEnabled: true,
        databaseEnvironment: e,
        redisEnvironment: env.REDIS_URL ? e : "not-configured",
        migrationReadiness: "unchecked",
      };
    if (
      env.NODE_ENV !== "production" ||
      !p ||
      p.environment !== e ||
      !["api", "migration"].includes(p.purpose) ||
      !p.build ||
      p.build !== env.OPA_BUILD_SHA
    )
      fail();
    resource(p.resources.app, e, "Microsoft.Web/sites");
    resource(
      p.resources.database,
      e,
      "Microsoft.DBforPostgreSQL/flexibleServers",
    );
    resource(p.resources.vault, e, "Microsoft.KeyVault/vaults");
    resource(p.resources.storage, e, "Microsoft.Storage/storageAccounts");
    if (env.OPA_DEPLOYMENT_RESOURCE_ID !== p.resources.app.id) fail();
    for (const name of settingNames) {
      if ((env[name] ?? null) !== (p.settings[name] ?? null)) fail();
    }
    for (const name of secretNames) {
      const value = env[name];
      const bound = p.secrets[name];
      if (value) {
        if (
          value.startsWith("@Microsoft.KeyVault(") ||
          !bound ||
          bound.environment !== e ||
          bound.vaultId !== p.resources.vault.id ||
          bound.sha256 !== hash(value) ||
          typeof bound.secretId !== "string" ||
          !bound.secretId.startsWith(
            p.resources.vault.secretOrigin + "/secrets/",
          )
        )
          fail();
      } else if (bound) fail();
    }
    for (const name of [
      "DATABASE_URL",
      "AZURE_STORAGE_CONNECTION_STRING",
      "ENROLLMENT_ENCRYPTION_KEY",
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "PII_ENCRYPTION_KEYS_JSON",
      "PII_LOOKUP_KEY",
    ])
      if (!env[name]) fail();
    databaseBinding(env.DATABASE_URL, p.resources.database);
    if (env.REDIS_URL) {
      resource(p.resources.redis, e, "Microsoft.Cache/redisEnterprise");
      const u = new URL(env.REDIS_URL);
      if (
        u.protocol !== "rediss:" ||
        u.hostname !== p.resources.redis.host ||
        Number(u.port) !== p.resources.redis.port ||
        u.search ||
        u.hash ||
        !["", "/"].includes(u.pathname)
      )
        fail();
    } else if (e === "staging" || p.resources.redis) fail();
    const storageParts =
      env.AZURE_STORAGE_CONNECTION_STRING.split(";").filter(Boolean);
    if (
      new Set(storageParts.map((part) => part.split("=")[0])).size !==
      storageParts.length
    )
      fail();
    const storage = Object.fromEntries(
      env.AZURE_STORAGE_CONNECTION_STRING.split(";")
        .filter(Boolean)
        .map((s) => {
          const i = s.indexOf("=");
          return [s.slice(0, i), s.slice(i + 1)];
        }),
    );
    if (
      !storage.AccountKey ||
      storage.AccountName !== p.resources.storage.accountName ||
      storage.DefaultEndpointsProtocol !== "https" ||
      storage.EndpointSuffix !== "core.windows.net" ||
      Object.keys(storage).some(
        (k) =>
          ![
            "AccountName",
            "AccountKey",
            "DefaultEndpointsProtocol",
            "EndpointSuffix",
          ].includes(k),
      ) ||
      env.AZURE_STORAGE_CONTAINER !== p.resources.storage.container
    )
      fail();
    httpsOrigin(env.OPA_API_ORIGIN);
    if (env.OPA_API_ORIGIN !== p.resources.app.origin) fail();
    const ring = JSON.parse(env.PII_ENCRYPTION_KEYS_JSON);
    if (
      env.PII_CRYPTO_ADAPTER !== "local" ||
      !Object.keys(ring).length ||
      !ring[env.PII_ENCRYPTION_KEY_VERSION] ||
      Object.values(ring).some(
        (k) => typeof k !== "string" || Buffer.from(k, "base64").length !== 32,
      ) ||
      Buffer.from(env.PII_LOOKUP_KEY, "base64").length !== 32 ||
      !env.PII_LOOKUP_KEY_VERSION ||
      !/^[a-f0-9]{64}$/i.test(env.ENROLLMENT_ENCRYPTION_KEY)
    )
      fail();
    const materials = [
      ...Object.values(ring).map((k) =>
        Buffer.from(k, "base64").toString("hex"),
      ),
      Buffer.from(env.PII_LOOKUP_KEY, "base64").toString("hex"),
      env.ENROLLMENT_ENCRYPTION_KEY.toLowerCase(),
    ];
    if (new Set(materials).size !== materials.length) fail();
    const mode =
      env.OPA_NOTIFICATION_MODE || (e === "staging" ? "disabled" : "live");
    if (
      !["disabled", "allowlist", "live"].includes(mode) ||
      (e === "staging" && mode === "live")
    )
      fail();
    if (
      mode === "disabled" &&
      (env.RESEND_API_KEY || env.AFRICASTALKING_API_KEY)
    )
      fail();
    if (mode === "allowlist") {
      const list = JSON.parse(env.OPA_NOTIFICATION_ALLOWLIST_JSON || "null");
      if (
        !list ||
        typeof list !== "object" ||
        !Object.values(list).some((v) => Array.isArray(v) && v.length)
      )
        fail();
      for (const n of [
        "OPA_NOTIFICATION_MAX_PER_HOUR",
        "OPA_NOTIFICATION_MAX_PER_RUN",
      ])
        if (!/^[1-9][0-9]{0,2}$/.test(env[n] || "")) fail();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(env.OPA_ACCEPTANCE_RUN_ID || ""))
        fail();
    }
    if (
      env.RESEND_API_KEY &&
      (!env.RESEND_ACCOUNT_SCOPE ||
        !env.RESEND_FROM_ADDRESS ||
        !env.RESEND_WEBHOOK_SECRET)
    )
      fail();
    if (
      env.AFRICASTALKING_API_KEY &&
      (!env.AFRICASTALKING_ACCOUNT_SCOPE || !env.AFRICASTALKING_USERNAME)
    )
      fail();
    if (env.OPA_SSO_ENABLED && !["true", "false"].includes(env.OPA_SSO_ENABLED))
      fail();
    const sso =
      env.OPA_SSO_ENABLED === "true" ||
      (e === "production" && env.OPA_SSO_ENABLED === undefined);
    if (sso) {
      httpsOrigin(env.SSO_WEB_ORIGIN);
      if (
        !env.SSO_ENCRYPTION_KEYS ||
        !env.SSO_LOOKUP_KEY ||
        !Array.isArray(p.ssoBindings) ||
        !p.ssoBindings.length
      )
        fail();
    }
    return {
      environment: e,
      build: p.build,
      databaseEnvironment: e,
      redisEnvironment: env.REDIS_URL ? e : "not-configured",
      notificationMode: mode,
      ssoEnabled: sso,
      migrationReadiness: "unchecked",
    };
  } catch {
    fail();
  }
}
function preflight(env, purpose = "api") {
  if (!["api", "migration"].includes(purpose)) fail();
  const e = classify(env);
  return validateApi(
    env,
    e === "development"
      ? null
      : readPolicy(env.OPA_ENVIRONMENT_POLICY_FILE, e, purpose),
  );
}
module.exports = {
  classify,
  hash,
  verifyEnvelope,
  readPolicy,
  httpsOrigin,
  endpoint,
  loadEndpoint,
  validateApi,
  preflight,
  databaseBinding,
  secretNames,
  settingNames,
};
