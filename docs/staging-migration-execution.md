# Protected staging migration execution

This path targets only `opa-pg-staging`, `opa_staging`, and disposable `opa_staging_test` on the approved staging server. It never targets a production resource. The existing auth-only workflow and its trigger are unchanged. The new workflow is `.github/workflows/opa-staging-migration-execution.yml`, restricted to changes to `ops/staging/migration-trigger.json` on `integration/institutional-security`, with environment `staging`, required human approval, `contents: read` and `id-token: write`.

## Review versus execution

The creation commit sets `mode: migration` and `execute: false`. It can only authenticate and perform read-only baseline/preflight checks. It cannot migrate or invoke the database custodian. No database creation/drop is authorized by this commit.

The self-binding mechanism combines the push's `after` SHA, actual checkout SHA, signed staging policy build, and operator runner lease SHA. The trigger also records the exact approved parent, expiry, lease and SHA-256 manifest of all 35 unchanged migration files. The parent must be the actual single-commit push parent and the dedicated trigger must have changed. Tracked executable changes are rejected before execution. There are no arbitrary database/environment inputs.

A future migration needs a separately reviewed trigger commit with `execute: true`, a fresh parent/lease/expiry, re-signed public policy for that exact resulting SHA, and the protected environment variable `OPA_STAGING_MIGRATION_AUTHORIZATION` containing `{sha, lease, action: "MIGRATE_OPA_STAGING", expiresAt}`. Its expiry must be within one hour. The operator must also invoke the launcher with `--execute --confirmation MIGRATE_OPA_STAGING`. GitHub environment approval is required for that run. None of these execution activations is performed in the preparation task.

## Operator runner

Use Azure CLI's Python runtime with `ops/staging/run-protected-migration.py --sha <exact SHA> --run-id <approved push run> --image ghcr.io/actions/actions-runner@sha256:<reviewed digest>`. Omit execution flags for review. The pinned image verified during auth proof is `sha256:e5496277be5d09bc968b3d64911b74e219ac4a3f2edce956a3ecf9271bea1ef4`.

The launcher checks GitHub branch, SHA, environment protections and approval before allocation. It reads staging PostgreSQL Ready and verifies exactly eight approved secret-scoped migration-identity role assignments, with no wider/production assignment returned. It verifies a single staging P2S /32. It creates only the three per-lease private PostgreSQL/Key Vault/Redis network rules. A fresh non-root Linux runner has a read-only root filesystem, no capabilities, no host/home/Azure-profile/Docker-socket mounts, and RAM-backed work, home and temporary directories. Registration credentials travel over stdin. The signed lease carries the read-only Azure preflight result. Bootstrap/admin credentials never enter CI.

## Real database

OIDC claims must match the exact repository, integration ref, SHA, new workflow, staging environment subject, tenant and migration managed identity. The eight immutable secret versions are fetched and fingerprint-checked in memory. The runtime database URL has a fixed server/database/role and an allowlist of connection options. PostgreSQL sentinel and `host(inet_client_addr())` must match the staging policy and approved /32. The baseline records schemas, tables, database size and history and refuses application tables, unexpected schemas, extra sentinel rows or any existing migration history.

After a future explicit execution activation, the operator custodian must first prove readiness. The job rechecks trigger, lease and policy immediately before invoking the unchanged reviewed `staging-migrate.cjs` wrapper. That wrapper runs isolation preflight, `prisma migrate deploy`, then full history verification. The orchestrator separately checks all 35 migrations exactly once, checksums, completion/rollback flags, sentinel, model columns, the partial active-journey index, Prisma validation and a read-only live-schema/datamodel diff. A runtime failure stops before creating a test database. There is no reset, db push, resolve, manual history repair, historical migration edit or seed path for `opa_staging`.

## Disposable validation database

The operator host, not the migration CI identity, creates and drops `opa_staging_test`. In future execution mode only, it temporarily grants the existing operator principal Key Vault Secrets User on the single staging bootstrap-password secret; that exact role assignment is removed afterward. A short-lived vault token is sent over stdin to the host custodian, which fetches the credential over the fixed staging private TLS endpoint and keeps it in memory. No broad vault grant or CI bootstrap access is added.

Before runtime migration, custodian inspection must confirm administrator CREATEDB/CREATEROLE capabilities and absence of the disposable database/lease role. Those capabilities are intentionally not exercised during review. After runtime history passes, creation verifies runtime history independently, then creates a lease-named validation login with no superuser, CREATEDB, CREATEROLE, replication or BYPASSRLS capability. Its login expires with the lease. It must have no CONNECT privilege on `opa_staging`; the existing runtime PUBLIC denial is preserved, never modified to accommodate tests. The new role owns only `opa_staging_test` and receives no membership in runtime/migration roles.

The test database has a `staging-test` sentinel in an administrator-owned schema, binding database name, SHA and lease. Test code receives SELECT only on that sentinel. Its temporary database URL travels from host to runner over Docker stdin into tmpfs, is consumed and removed, and is written only to the runner's temporary `.env.test.local` for the existing harness. A new global setup requires the exact test database, role, lease, sentinel, checksums and denial of runtime CONNECT. The existing `_test` and truncation guards remain unchanged. The same migration chain is applied once before tests; the staging-specific setup verifies instead of rerunning migrations. Only public synthetic test tables are truncated by the existing harness.

Validation selects tenant isolation, protected identity/PII, Super Admin, enrollment, delivery, SSO database invariants, SafeWalk, incident lifecycle/timeline/concurrency, locationless incidents, journey constraints/concurrency/service and advisory locks. Test children receive a fresh environment without runtime database URLs, runtime secrets, OIDC tokens or provider credentials. Real notification and SSO configuration remain disabled; fixtures use synthetic identities and local/mock providers. Results retain counts and suite outcomes, not raw errors or credential-bearing process output. There is one recorded test attempt; failures are not automatically retried.

## Failure and cleanup

A runtime migration or verification failure never starts tests. A test-creation/validation failure retains `opa_staging` and requests cleanup only for the disposable database. The original test failure is preserved even if cleanup also fails. The operator custodian checks the fixed disposable name, lease-named owner and exact database comment before dropping it, then drops only that lease role. It never accepts `opa_staging` as a drop target. Expired leases may be cleaned, but cannot create a database.

The host's `finally` path retries ownership-checked disposable cleanup if creation was requested, removes its exact bootstrap IAM assignment, removes and verifies all per-lease network rules, destroys the container and deregisters the runner. Public resource IDs are recorded before writes. An interrupted host/OS requires reviewing that saved lease ledger and resuming the same ownership-checked cleanup; no system can guarantee automatic cleanup after loss of the host itself. Cleanup failures are explicit blockers. No raw logs or secret values are retained in evidence.

## Evidence/Insight scope

The enterprise Evidence/Insight work on `codex/opa-evidence-insight` is **NOT IN CURRENT RELEASE BRANCH**. The release has its existing Evidence model/module, but this path does not claim isolated-branch runtime or migration validation. Historical migration bytes remain unchanged.
