"use strict";
const { URL } = require("node:url");
// Called only by the operator-owned supervisor, never by a test child.
const crypto = require("node:crypto");
const v = require("./staging-database-verifier.cjs");
const g = require("./staging-gates.cjs");
const literal = (x) => "'" + x.replace(/'/g, "''") + "'";
function binding(c) {
  g.context(c);
  const name = g.database(c),
    role = v.testRole(c.lease);
  return {
    name,
    role,
    marker: JSON.stringify({
      environment: "staging-test",
      database: name,
      sha: c.sha,
      gate: c.gate,
      lease: c.lease,
    }),
  };
}
async function operate(admin, connect, c, action) {
  const b = binding(c);
  v.check(["absent", "create", "drop"].includes(action), "CUSTODIAN_ACTION");
  const existing = async () =>
    (
      await admin.query(
        "SELECT datname,pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1",
        [b.name],
      )
    ).rows;
  const rows = await existing();
  if (action === "absent") {
    v.check(rows.length === 0, "GATE_DATABASE_EXISTS");
    return;
  }
  if (action === "drop") {
    if (rows.length) {
      v.check(
        rows.length === 1 &&
          rows[0].owner === b.role &&
          rows[0].marker === b.marker,
        "GATE_DROP_OWNERSHIP",
      );
      await admin.query('DROP DATABASE "' + b.name + '" WITH (FORCE)');
    }
    v.check((await existing()).length === 0, "GATE_DROP_VERIFY");
    // A unique lease role is reused serially, removed after every gate.
    const role = (
      await admin.query(
        "SELECT rolname,shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",
        [b.role],
      )
    ).rows;
    if (role.length)
      v.check(
        role.length === 1 && role[0].marker === b.marker,
        "GATE_ROLE_OWNERSHIP",
      );
    if (role.length) await admin.query('DROP ROLE "' + b.role + '"');
    v.check(
      (
        await admin.query(
          "SELECT rolname,shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",
          [b.role],
        )
      ).rows.length === 0,
      "GATE_ROLE_DROP_VERIFY",
    );
    return { databaseAbsent: true, roleAbsent: true };
  }
  v.check(
    rows.length === 0 &&
      (
        await admin.query(
          "SELECT rolname,shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",
          [b.role],
        )
      ).rows.length === 0,
    "GATE_ALREADY_EXISTS",
  );
  v.check(
    Date.parse(c.expiresAt) > Date.now() &&
      Date.parse(c.expiresAt) <= Date.now() + 3600000,
    "GATE_LEASE_EXPIRY",
  );
  const password = crypto.randomBytes(40).toString("base64url");
  let roleCreated = false,
    dbCreated = false;
  try {
    await admin.query(
      'CREATE ROLE "' +
        b.role +
        '" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD ' +
        literal(password) +
        " VALID UNTIL " +
        literal(c.expiresAt),
    );
    roleCreated = true;
    await admin.query(
      'COMMENT ON ROLE "' + b.role + '" IS ' + literal(b.marker),
    );
    v.check(
      !(
        await admin.query(
          "SELECT has_database_privilege($1,'opa_staging','CONNECT') AS allowed",
          [b.role],
        )
      ).rows[0].allowed,
      "GATE_RUNTIME_ACCESS",
    );
    await admin.query('GRANT "' + b.role + '" TO opa_staging_bootstrap');
    await admin.query(
      'CREATE DATABASE "' + b.name + '" OWNER "' + b.role + '"',
    );
    dbCreated = true;
    await admin.query(
      'COMMENT ON DATABASE "' + b.name + '" IS ' + literal(b.marker),
    );
    await admin.query('REVOKE ALL ON DATABASE "' + b.name + '" FROM PUBLIC');
    await admin.query(
      'GRANT CONNECT ON DATABASE "' + b.name + '" TO "' + b.role + '"',
    );
    const db = await connect(b.name);
    try {
      await db.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
      await db.query('GRANT USAGE,CREATE ON SCHEMA public TO "' + b.role + '"');
      await db.query(
        "CREATE SCHEMA opa_deployment AUTHORIZATION opa_staging_bootstrap",
      );
      await db.query(
        "CREATE TABLE opa_deployment.validation_identity(singleton boolean PRIMARY KEY CHECK(singleton),environment text NOT NULL,database_name text NOT NULL,approved_sha text NOT NULL,lease text NOT NULL)",
      );
      await db.query(
        "INSERT INTO opa_deployment.validation_identity VALUES(true,$1,$2,$3,$4)",
        ["staging-test", b.name, c.sha, c.lease],
      );
      await db.query("REVOKE ALL ON SCHEMA opa_deployment FROM PUBLIC");
      await db.query(
        'GRANT USAGE ON SCHEMA opa_deployment TO "' + b.role + '"',
      );
      await db.query(
        'GRANT SELECT ON opa_deployment.validation_identity TO "' +
          b.role +
          '"',
      );
    } finally {
      await db.end();
    }
    const url = new URL(
      "postgresql://" +
        v.SERVER +
        ":5432/" +
        b.name +
        "?sslmode=require&sslaccept=strict&connection_limit=5",
    );
    url.username = b.role;
    url.password = password;
    return url.toString();
  } catch (e) {
    if (dbCreated)
      await admin.query('DROP DATABASE "' + b.name + '" WITH (FORCE)');
    if (roleCreated) await admin.query('DROP ROLE "' + b.role + '"');
    throw e;
  }
}
module.exports = { binding, operate };
