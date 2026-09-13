"use strict";
async function collect(db) {
  await db.query("BEGIN READ ONLY");
  try {
    const settings = (
      await db.query(
        `SELECT current_setting('server_version') AS version,current_database() AS database,current_user AS role,current_setting('search_path') AS search_path,current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout,current_setting('idle_in_transaction_session_timeout') AS idle_transaction_timeout,current_setting('transaction_read_only') AS read_only,pg_database_size(current_database())::text AS size_bytes`,
      )
    ).rows[0];
    if (
      settings.database !== "opa_staging" ||
      settings.role !== "opa_staging_migrations" ||
      settings.read_only !== "on"
    )
      throw Error("READ_ONLY_TARGET");
    const privileges = (
      await db.query(
        `SELECT has_database_privilege(current_user,current_database(),'CONNECT') AS database_connect,has_database_privilege(current_user,current_database(),'TEMP') AS database_temp,has_database_privilege(current_user,current_database(),'CREATE') AS database_create,has_schema_privilege(current_user,'public','USAGE') AS public_usage,has_schema_privilege(current_user,'public','CREATE') AS public_create,has_schema_privilege(current_user,'opa_deployment','CREATE') AS sentinel_schema_create,has_table_privilege(current_user,'opa_deployment.environment_identity','SELECT') AS sentinel_read,has_table_privilege(current_user,'opa_deployment.environment_identity','UPDATE') AS sentinel_write,has_function_privilege(current_user,'pg_catalog.pg_advisory_lock(bigint)','EXECUTE') AS advisory_lock_execute,has_function_privilege(current_user,'pg_catalog.pg_try_advisory_xact_lock(bigint)','EXECUTE') AS advisory_try_execute`,
      )
    ).rows[0];
    const schemas = (
      await db.query(
        "SELECT nspname AS schema,has_schema_privilege(current_user,oid,'USAGE') AS usage,has_schema_privilege(current_user,oid,'CREATE') AS schema_create FROM pg_namespace WHERE nspname IN ('public','opa_deployment') ORDER BY nspname",
      )
    ).rows;
    const prerequisites = (
      await db.query(
        "SELECT to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL AS gen_random_uuid,has_language_privilege(current_user,'plpgsql','USAGE') AS plpgsql_usage",
      )
    ).rows[0];
    const extensions = (
      await db.query(
        "SELECT extname AS name,extversion AS version FROM pg_extension ORDER BY extname",
      )
    ).rows;
    const tls = (
      await db.query(
        "SELECT ssl,version,cipher,bits FROM pg_stat_ssl WHERE pid=pg_backend_pid()",
      )
    ).rows[0];
    if (!tls?.ssl) throw Error("TLS_REQUIRED");
    // Prisma's advisory key; nonblocking and transaction-scoped, released by ROLLBACK.
    const advisory = (
      await db.query(
        "SELECT pg_try_advisory_xact_lock(72707369::bigint) AS acquired",
      )
    ).rows[0];
    return {
      settings,
      privileges,
      schemas,
      extensions,
      prerequisites,
      tls,
      advisoryLock: {
        ...advisory,
        key: 72707369,
        release: "transaction rollback",
      },
      objectCreationReadiness:
        privileges.public_usage && privileges.public_create
          ? "metadata-permits-public-tables-types-indexes"
          : "missing-public-privilege",
      schemaWrites: 0,
    };
  } finally {
    await db.query("ROLLBACK");
  }
}
module.exports = { collect };
