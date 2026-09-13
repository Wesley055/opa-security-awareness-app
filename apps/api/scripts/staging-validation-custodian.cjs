"use strict";
// Operator-host only. The CI identity never receives the bootstrap credential.
const crypto = require("node:crypto"),
  https = require("node:https");
const v = require("./staging-database-verifier.cjs");
function context(input) {
  v.check(
    ["inspect", "create", "drop"].includes(input.action),
    "CUSTODIAN_ACTION",
  );
  v.check(
    /^[a-f0-9]{40}$/.test(input.sha || "") &&
      /^[a-f0-9]{24}$/.test(input.lease || "") &&
      /^172\.27\.240\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])\/32$/.test(
        input.source || "",
      ),
    "CUSTODIAN_SCOPE",
  );
  v.check(
    Number.isFinite(Date.parse(input.expiresAt)) &&
      (input.action === "drop" || Date.parse(input.expiresAt) > Date.now()) &&
      Date.parse(input.expiresAt) <= Date.now() + 3600000,
    "CUSTODIAN_EXPIRY",
  );
  return {
    role: v.testRole(input.lease),
    marker: JSON.stringify({
      environment: "staging-test",
      sha: input.sha,
      lease: input.lease,
    }),
  };
}
function disposable(name, owner, marker, input) {
  const c = context(input);
  v.check(
    name === v.TEST && owner === c.role && marker === c.marker,
    "DISPOSABLE_OWNERSHIP",
  );
}
function literal(value) {
  return "'" + value.replace(/'/g, "''") + "'";
}
async function bootstrap(token) {
  v.check(typeof token === "string" && token.length > 100, "OPERATOR_TOKEN");
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: "opa-kv-staging.vault.azure.net",
        path: "/secrets/opa-staging-bootstrap-db-password?api-version=7.4",
        headers: { Authorization: "Bearer " + token },
        lookup: (_h, o, cb) =>
          o.all
            ? cb(null, [{ address: "10.72.2.4", family: 4 }])
            : cb(null, "10.72.2.4", 4),
        rejectUnauthorized: true,
      },
      (response) => {
        let text = "";
        response.on("data", (d) => {
          text += d;
          if (text.length > 32768) request.destroy();
        });
        response.on("end", () => {
          try {
            v.check(response.statusCode === 200, "BOOTSTRAP_SECRET_ACCESS");
            const data = JSON.parse(text);
            v.check(
              typeof data.value === "string" &&
                data.id.startsWith(
                  "https://opa-kv-staging.vault.azure.net/secrets/opa-staging-bootstrap-db-password/",
                ),
              "BOOTSTRAP_SECRET_ID",
            );
            resolve(data.value);
          } catch {
            reject(new Error("BOOTSTRAP_SECRET_ACCESS"));
          }
        });
      },
    );
    request.setTimeout(20000, () => request.destroy());
    request.on("error", () => reject(new Error("BOOTSTRAP_SECRET_ACCESS")));
  });
}
async function execute(input) {
  const c = context(input);
  const expected = v.manifest();
  v.committed(v.ROOT, input.sha, expected);
  const { Client } = require("pg");
  const password = await bootstrap(input.vaultToken);
  delete input.vaultToken;
  const connect = async (database) => {
    const db = new Client({
      host: "10.72.1.4",
      port: 5432,
      database,
      user: "opa_staging_bootstrap",
      password,
      ssl: { rejectUnauthorized: true, servername: v.SERVER },
      connectionTimeoutMillis: 20000,
    });
    await db.connect();
    await v.identity(db, database, "opa_staging_bootstrap", input.source);
    return db;
  };
  const admin = await connect("postgres");
  try {
    const existing = (
      await admin.query(
        "SELECT datname,pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname='opa_staging_test'",
      )
    ).rows;
    if (input.action === "drop") {
      if (existing.length) {
        disposable(
          existing[0].datname,
          existing[0].owner,
          existing[0].marker,
          input,
        );
        await admin.query("DROP DATABASE opa_staging_test WITH (FORCE)");
      }
      const role = (
        await admin.query("SELECT rolname FROM pg_roles WHERE rolname=$1", [
          c.role,
        ])
      ).rows;
      if (role.length) await admin.query('DROP ROLE "' + c.role + '"');
      return {
        status: "ready",
        sha: input.sha,
        lease: input.lease,
        databaseDropped: true,
        roleDropped: true,
      };
    }
    v.check(existing.length === 0, "TEST_DATABASE_ALREADY_EXISTS");
    v.check(
      (await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [c.role]))
        .rows.length === 0,
      "TEST_ROLE_ALREADY_EXISTS",
    );
    const capability = (
      await admin.query(
        "SELECT rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    v.check(
      capability.rolcreatedb && capability.rolcreaterole,
      "CUSTODIAN_CAPABILITY",
    );
    const live = await connect(v.RUNTIME);
    try {
      await v.runtimeSentinel(live);
      if (input.action === "create")
        v.historyCheck(await v.history(live), expected);
    } finally {
      await live.end();
    }
    if (input.action === "inspect")
      return {
        status: "ready",
        sha: input.sha,
        lease: input.lease,
        capabilitiesVerified: true,
      };
    const testPassword = crypto.randomBytes(40).toString("base64url");
    let roleCreated = false,
      dbCreated = false;
    try {
      await admin.query(
        'CREATE ROLE "' +
          c.role +
          '" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30 PASSWORD ' +
          literal(testPassword) +
          " VALID UNTIL " +
          literal(input.expiresAt),
      );
      roleCreated = true;
      const forbidden = (
        await admin.query(
          "SELECT has_database_privilege($1,'opa_staging','CONNECT') AS allowed",
          [c.role],
        )
      ).rows[0].allowed;
      v.check(!forbidden, "TEST_ROLE_RUNTIME_ACCESS");
      await admin.query('GRANT "' + c.role + '" TO opa_staging_bootstrap');
      await admin.query(
        'CREATE DATABASE opa_staging_test OWNER "' + c.role + '"',
      );
      dbCreated = true;
      await admin.query(
        "COMMENT ON DATABASE opa_staging_test IS " + literal(c.marker),
      );
      await admin.query("REVOKE ALL ON DATABASE opa_staging_test FROM PUBLIC");
      await admin.query(
        'GRANT CONNECT ON DATABASE opa_staging_test TO "' + c.role + '"',
      );
      const test = await connect(v.TEST);
      try {
        await test.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
        await test.query(
          'GRANT USAGE,CREATE ON SCHEMA public TO "' + c.role + '"',
        );
        await test.query(
          "CREATE SCHEMA opa_deployment AUTHORIZATION opa_staging_bootstrap",
        );
        await test.query(
          "CREATE TABLE opa_deployment.validation_identity(singleton boolean PRIMARY KEY CHECK(singleton),environment text NOT NULL,database_name text NOT NULL,approved_sha text NOT NULL,lease text NOT NULL)",
        );
        await test.query(
          "INSERT INTO opa_deployment.validation_identity VALUES(true,$1,$2,$3,$4)",
          ["staging-test", v.TEST, input.sha, input.lease],
        );
        await test.query("REVOKE ALL ON SCHEMA opa_deployment FROM PUBLIC");
        await test.query(
          'GRANT USAGE ON SCHEMA opa_deployment TO "' + c.role + '"',
        );
        await test.query(
          'GRANT SELECT ON opa_deployment.validation_identity TO "' +
            c.role +
            '"',
        );
      } finally {
        await test.end();
      }
      const url = new URL(
        "postgresql://" + v.SERVER + ":5432/" + v.TEST + "?sslmode=require",
      );
      url.username = c.role;
      url.password = testPassword;
      return {
        status: "ready",
        sha: input.sha,
        lease: input.lease,
        databaseUrl: url.toString(),
      };
    } catch (error) {
      // Only this invocation's newly created objects can be rolled back here.
      if (dbCreated)
        await admin.query("DROP DATABASE opa_staging_test WITH (FORCE)");
      if (roleCreated) await admin.query('DROP ROLE "' + c.role + '"');
      throw error;
    }
  } finally {
    await admin.end();
  }
}
module.exports = { context, disposable, execute };
if (require.main === module) {
  let text = "";
  process.stdin.on("data", (d) => (text += d));
  process.stdin.on("end", () => {
    execute(JSON.parse(text))
      .then((result) => {
        text = "";
        process.stdout.write(JSON.stringify(result));
      })
      .catch((error) => {
        text = "";
        process.stdout.write(
          JSON.stringify({
            status: "failed",
            code: /^[A-Z0-9_]{1,64}$/.test(error.message || "")
              ? error.message
              : "DETAILS_SUPPRESSED",
          }),
        );
        process.exitCode = 1;
      });
  });
}
