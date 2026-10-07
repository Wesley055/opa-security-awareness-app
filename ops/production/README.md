# Production migration execution contract

Status: implementation under review. NO production authorization is implied by
these files, tests, generating SQL, a commit, a push, or a deployment dispatch.
The seven SQL files and historical migration history remain unchanged.

Start with `docs/releases/PRODUCTION-RELEASE-AUTHORITY.md`. This mechanism replaces
the historical accidental App Service Prisma CLI. Never use the stale
`/home/site/wwwroot/prisma`; the authoritative deployment tree is
`/home/site/wwwroot/apps/api/prisma/migrations`.

## Privilege and ownership model

The runtime identity is always `opa_production_runtime`; the executor is always
`opa_production_migrations`. Neither may be SUPERUSER, CREATEDB, CREATEROLE,
REPLICATION or BYPASSRLS, own the database/schema/sentinel, inherit another role,
mutate the sentinel, create schemas or temporary tables, or write migration
history outside an approved activation. During activation the migration login
inherits exactly one reviewed NOLOGIN role: `opa_production_release_owner`.
The runtime must never inherit this owner.

Prisma 6.19.3 `migrate deploy` needs CONNECT, public USAGE, SELECT/INSERT/UPDATE on
the existing `_prisma_migrations`, and advisory locking. This cutover does not
create the database or the migration ledger, need a shadow database, need
CREATEDB, or need DELETE/TRUNCATE/REFERENCES/TRIGGER on the ledger.

SQL-specific rights:

| Migration | Required authority |
| --- | --- |
| bounded onboarding | public CREATE for enum/table/index; REFERENCES on User/Facility |
| support role | ownership of existing UserRole enum to add value |
| institutional authority | ownership of User, Facility, AdministrativeAuditEvent, EnrollmentRequest; SELECT/UPDATE for backfills; enum/table/index/function creation; TRIGGER on User |
| enrollment provenance | ownership of EnrollmentRequest to replace CHECK |
| canonical organization | ownership of Facility; new enum/table/sequence/index/function/trigger creation; REFERENCES on User/Facility |
| response policy | ownership of IncidentTimelineEvent for unique index and Facility for trigger; new table/function creation; REFERENCES on User/Facility |
| reporting reconciliation | new enum/table/index creation; ownership of newly created reporting tables for CHECK/FK |

Existing table owners can ALTER, create indexes, replace constraints and attach
triggers; schema CREATE does not confer those rights. Table ownership also carries
dependent index and row-type ownership. Existing `UserRole` and its array type
follow type ownership. Four newly created invoker-rights trigger functions, seven
new enum types, twelve new tables and `SupportCase_sequence_seq` must be retained
under the NOLOGIN owner after execution. No SECURITY DEFINER authority is allowed.
The runner rejects unexpected objects owned by either migration/owner identity.

Administrator preparation transfers only five named existing tables and UserRole
to the scoped NOLOGIN owner. Existing ACLs survive transfer. The administrator
must verify the actual old owners, dependencies, ACLs, inherited memberships and
cross-schema authority before approving this transfer; those facts have not been
measured here. Do not grant existing broad administrator/runtime roles to the
migration login. Do not use `REASSIGN OWNED` across an entire role/database.

Activation temporarily grants owner membership, public CREATE and ledger
INSERT/UPDATE. Temporary default privileges give runtime DML on new tables and
USAGE/SELECT on the new sequence; trigger functions are invoker rights with
runtime EXECUTE. Cleanup revokes those defaults, grants, and membership, terminates
migration sessions and transfers only named new objects to the owner. It preserves
runtime ACLs, and grants enum USAGE. The owner loses temporary schema CREATE before
each ownership-transfer transaction commits.

Preparation explicitly grants the scoped owner SELECT for compatibility/backfill
tables, UPDATE on User/Facility, TRIGGER on User/Facility and UserRole USAGE.
Ownership transfer alone does not prove the previous owner's ordinary ACLs were
retained. The disposable test deliberately revokes the old owner's SELECT/UPDATE
before transfer and proves these explicit grants restore the required authority.
See [PostgreSQL 14 ownership and privileges](https://www.postgresql.org/docs/14/sql-grant.html).

The approved idle migration posture is CONNECT, public/opa_deployment USAGE,
sentinel SELECT and migration ledger SELECT, with no ownership, role memberships,
schema CREATE, database CREATE/TEMP or ledger mutation. Runtime must have no
ownership, CREATE/TEMP/TRIGGER, migration-ledger mutation, or accessible user
SECURITY DEFINER functions. Existing baseline ACL discrepancies fail closed and
require separately reviewed administrator remediation; the generator does not
silently broaden or revoke unrelated ACLs.

Prisma's PostgreSQL schema introspection hides column metadata for tables where
the role lacks column rights. The idle migration role therefore retains only
REFERENCES on the 33 explicitly named baseline application tables and the 12 new
tables. This exposes schema metadata without SELECT on application data, and
cannot be exercised as DDL while CREATE/ownership/membership are revoked. These
metadata rights are distinct from ledger/sentinel SELECT; neither ledger nor
sentinel receives REFERENCES. A disposable rehearsal must prove full datamodel
diff and idle DDL denial under exactly this posture.

`PUBLIC` database TEMP grants defeat a role-specific revoke. Preparation explicitly
revokes TEMP from PUBLIC and both identities. Review other database consumers;
separately grant TEMP only to approved administrators if needed. PUBLIC schema
CREATE, dangerous inherited memberships and sentinel column grants likewise must
be reviewed; the runner checks effective privileges, not merely direct ACLs.

## Administrator-only external contract

Repository tools generate SQL but never receive an administrator credential or
execute activation/deactivation. An approved PostgreSQL administrator must own or
be authorized to transfer the specified objects, manage the three scoped roles and
ACLs, alter migration-role defaults and terminate migration sessions. Azure's
administrator constraints must be tested; do not solve a denial by elevating the
migration login. Initial owner preparation is deliberately not repeatable: an
existing owner must first be inspected and reviewed, not silently reused.

A non-superuser administrator must have INHERIT and authority to grant itself
the scoped owner and migration roles, in addition to the database/schema and
existing-object authority above. Generated SQL borrows these memberships inside
each administrator transaction for ownership transfer, default privileges and
session termination, then removes newly borrowed memberships before commit.
Pre-existing memberships are preserved, but activation rejects any pre-existing
delegate of the owner or migration role. No permanent administrator membership
is installed. The disposable rehearsal exercises this path with a normal
CREATEROLE/CREATEDB administrator, never a superuser for release operations.

An independent administrator/supervisor must remain present throughout the window
and run cleanup on success, failure, timeout, Ctrl-C, runner crash, expired policy,
loss of networking, or absent receipt. Permissions do not automatically expire in
PostgreSQL. Signed policy expiry does not revoke them. Schedule a separately owned
hard deadline (at most one hour) to stop the runner, revoke credentials/access and
run cleanup. The repository cannot guarantee this external action occurred;
`verify-cleanup` and `verify-post` independently check the resulting database state.
Cleanup verification alone does not mean a failed migration succeeded.

Revocation commits before ownership reconciliation. Thus a later transfer failure
does not roll back the committed CREATE/member/ledger revokes. Failure to transfer
new objects leaves owner DDL authority with the migration login: stop/remove its
credential and network access, keep deployment blocked, repair administrator
authority and rerun cleanup. Independent verification must detect remaining
ownership. Never call cleanup complete based solely on the script exit code.

## Approved execution environment and artifact

Use a separately reviewed Azure VM in the production private network, same
subscription and `opa-production` resource group. No VM/network/RBAC resource is
provisioned by this implementation; approving and provisioning the VM, read-only
artifact mount, Node 22 binary, credential delivery, bounded lease and independent
cleanup supervisor are administrator actions. Do not reuse staging custody or its
network grants. No GitHub-hosted runner or ordinary push may execute migrations.

The runner checks Azure VM resource identity through IMDS, the local private NIC,
private database DNS and `inet_server_addr()` against signed address allowlists.
TLS verification remains enabled for both pg and Prisma. Azure inventory approval
must independently establish the VM/VNet/subnet, private resolver/routes, no
unapproved public exposure, least-privileged secret-reader identity and one-job
lease. IMDS and DNS checks complement this approval; they do not attest Azure IAM.

Build on the SAME OS/architecture as that VM, using reviewed Node 22/npm in a
credential-free build environment. The isolated package graph contains exactly
locked Prisma 6.19.3, pg, and their dependency closure, copied from the candidate
lock with registry integrity entries retained. It carries no API application or
API runtime dependencies. Prisma CLI stays an API devDependency, and the runtime
assembly script remains unchanged. `npm ci` installs this bounded graph; engine
rebuild and CLI version verification must succeed. No `npx` or runtime download
fallback is permitted. Build network access to the reviewed registry/engine
service is needed only during artifact creation; execution needs only private DB
and IMDS. Freeze/read-only mount the complete artifact before credential delivery.

`build-artifact.cjs` requires exact committed HEAD and clean packaged source/lock paths, and exports exact Git
blob bytes for `apps/api/prisma`, policy trust and this tooling. It verifies the
35-migration deployed baseline against build `b02a851`, exactly seven canonical
forward hashes, and exactly 42 candidate migrations. The final manifest hashes
every file, including installed packages and native engines. Its SHA-256 is bound
in the signed policy. Platform/architecture, Node major, manifest and installed
CLI version are rechecked before every run. Build artifacts for another platform
are rejected. Copy/download/package transfer must preserve bytes and the approved
manifest hash. Keep receipts, backups and policies outside the artifact.

## Signed migration policy and evidence inputs

Use the existing enrolled production signer verifier; no alternate trust keys and
no API/endpoint-policy substitution. This task creates no signed policy and does
not access signing custody. A separately authorized issuer must produce a
short-lived envelope, purpose=migration, using this additional payload contract:

```json
{
  "version": 1,
  "environment": "production",
  "purpose": "migration",
  "build": "<40 lowercase hex candidate SHA>",
  "approvedAt": "<UTC approval timestamp>",
  "expiresAt": "<UTC expiry at most one hour after approval>",
  "approvalId": "<non-secret approval reference>",
  "action": "MIGRATE_OPA_PRODUCTION",
  "writersQuiesced": true,
  "artifactSha256": "<complete migration-artifact.json SHA256>",
  "backupSha256": "<exact backup.json bytes SHA256>",
  "sentinelSha256": "<SHA256 of JSON.stringify(to_jsonb(sentinel row))>",
  "resources": {
    "app": {"environment": "production", "id": "<approved opa-api-production Azure resource ID>"},
    "database": {
      "environment": "production",
      "id": "<approved opa-api-production-server Azure resource ID>",
      "host": "opa-api-production-server.postgres.database.azure.com",
      "port": 5432,
      "database": "opa-api-production-database",
      "role": "opa_production_migrations"
    },
    "vault": {
      "environment": "production",
      "id": "<approved production Key Vault resource ID in the same subscription>",
      "secretOrigin": "https://<approved-vault-name>.vault.azure.net"
    }
  },
  "secrets": {"DATABASE_URL": {
    "environment": "production",
    "vaultId": "<same approved production Key Vault resource ID>",
    "secretId": "<approved versioned HTTPS Key Vault secret reference>",
    "sha256": "<resolved migration credential digest>"
  }},
  "runner": {
    "kind": "azure-vm",
    "resourceId": "<approved production VM resource ID>",
    "privateAddresses": ["<approved private IPv4>"],
    "databaseAddresses": ["<approved private DB IPv4>"]
  }
}
```

These are NON-DEPLOYABLE placeholders. The signed secret digest/reference must
come from approved provenance; never include its value. Required process inputs:
NODE_ENV=production, OPA_ENVIRONMENT=production, OPA_BUILD_SHA,
OPA_DEPLOYMENT_RESOURCE_ID, OPA_ENVIRONMENT_POLICY_FILE, and DATABASE_URL from a
protected process-memory credential provider. Execution also needs
OPA_MIGRATION_CONFIRMATION=`MIGRATE_OPA_PRODUCTION:<build>:<artifactHash>:<approvalId>`.
Do not put DATABASE_URL in arguments, shell history, `.env`, workflow logs or
receipts. NODE_OPTIONS/NODE_PATH and Node startup injection arguments are rejected.

`backup.json` must contain version=1, server=opa-api-production-server,
database=opa-api-production-database, publicAccess=Disabled, retentionDays=7,
observedAt (less than one hour old), earliestRestoreDate, restorePoint within that
window, evidenceSha256 (sanitized source evidence digest), approvalId matching
policy. A reviewed Azure administrator obtains fresh read-only backup/PITR
evidence and a valid pre-cutover restore point. The signed input is evidence
approval, not an automatic Azure backup/restore or assurance that restoration was
tested. A documented restoration rehearsal is a release gate.

Quiesce API/background writers and fence deployment before compatibility checks.
The unique OPERATIONAL_EXCEPTION index is not concurrent. Constraints/indexes
take locks, and old writers must not race preflight. Review lock/workload duration
and downtime in a disposable rehearsal. The runner checks existing support tenant,
enrollment role/provenance, and duplicate index-group compatibility as aggregate
zero counts. Newly created tables have no pre-existing rows; their constraints
cannot conflict with old data. Existing facilities/authority are retained.

## Exact operator command sequence (after separate human approval)

All paths below are inside an approved Linux runner/operator layout. Node scripts
are portable to Windows; native engine artifacts are platform-specific. Windows
operators use corresponding absolute paths and the same arguments. These
commands are documentation only and must NOT be run against production yet.

Build after reviewed implementation is committed; substitute the approved SHA:

```sh
npm run artifact:migration -- <APPROVED_SHA> /approved/build/migration-artifact
node /approved/build/migration-artifact/ops/production/admin-sql.cjs /approved/evidence/admin-sql
```

The build must run from a clean exact candidate checkout. npm provides
`npm_execpath` and the build's isolated installer. Record the reported manifest
SHA256 and script hashes. Transfer the artifact and mount it read-only as
`/approved/migration-artifact`. Independently verify its hash. Approve a fresh
separately signed migration policy, backup evidence, runner inventory,
maintenance window and externally owned cleanup deadline. Signing is a separate
human-authorized activity; this runbook is not a signing command.

Pre-migration, PostgreSQL administrator using a protected TLS service entry:

```sh
curl --fail --proto '=https' --tlsv1.2 --max-time 15 https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net/health/environment
psql 'service=opa-production-admin' --no-psqlrc -v ON_ERROR_STOP=1 -f /approved/evidence/admin-sql/prepare.sql
psql 'service=opa-production-admin' --no-psqlrc -v ON_ERROR_STOP=1 -f /approved/evidence/admin-sql/activate.sql
node /approved/migration-artifact/ops/production/run.cjs preflight /approved/evidence/backup.json /approved/evidence/preflight.json
```

`prepare.sql` is INITIAL CUTOVER ONLY; future activation reuses only the
independently verified existing scoped owner. Service entry/custody must be
prepared outside Git, with hostname certificate verification, no echoed password,
and administrator identity independent from migration/runtime. The runner rejects
anything except exact 35 successful checksum-matching baseline rows, seven exact
forward files, correct identity/sentinel/role posture, approved VM/network and
compatible data. Failed preflight still requires administrator cleanup.

Before policy issuance, the administrator records the full sentinel digest from
the same approved service without printing its row:

```sh
psql 'service=opa-production-admin' --no-psqlrc -qAt -v ON_ERROR_STOP=1 -c 'SELECT to_jsonb(i)::text FROM opa_deployment.environment_identity i;' |
node -e "let s='';process.stdin.on('data',d=>{s+=d;if(s.length>65536)process.exit(1)});process.stdin.on('end',()=>{try{const i=JSON.parse(s);if(i.singleton!==true||i.environment!=='production')throw Error();console.log(require('node:crypto').createHash('sha256').update(JSON.stringify(i)).digest('hex'))}catch{console.error('SENTINEL_INPUT_REJECTED');process.exitCode=1}});"
```

Run pipelines with pipefail. Require the health response to identify production,
production database, deployed baseline build b02a851 and migrationReadiness=ready.
Record fresh backup/PITR evidence and approved VM/IAM/lease inventory separately.
Unexpected fields in policy or backup inputs are rejected; resolved secret values
are never policy fields.

After the explicit signed/operator authorization, migration:

```sh
node /approved/migration-artifact/ops/production/run.cjs execute /approved/evidence/backup.json /approved/evidence/migration.json
```

The only schema execution is the bundled CLI's
`prisma migrate deploy --schema apps/api/prisma/schema.prisma`. No database URLs
are command arguments. Receipt success is `migrated-awaiting-admin-cleanup`, never
deployment authorization. It verifies all 42 ledger names/hashes, no unfinished or
rolled-back entries, valid schema constraints/indexes/triggers, runtime new-object
access, active scoped privileges and unchanged signed sentinel. Prisma migrate
diff independently checks the live schema against the candidate datamodel without
a shadow DB (`--from-schema-datasource ... --to-schema-datamodel ... --exit-code`).
Prisma's datamodel diff omits unsupported features, so the catalog checks and exact
SQL hashes supplement it. The API's own environment readiness check remains
mandatory after the separately approved eventual deployment.

Cleanup on SUCCESS OR FAILURE, after stopping the runner/credential delivery:

```sh
psql 'service=opa-production-admin' --no-psqlrc -v ON_ERROR_STOP=1 -f /approved/evidence/admin-sql/cleanup.sql
node /approved/migration-artifact/ops/production/run.cjs verify-cleanup /approved/evidence/backup.json /approved/evidence/cleanup.json
```

If signed policy/evidence expired, the administrator must still run cleanup
immediately. Obtain a separately authorized fresh migration verification policy
and evidence before rerunning the read-only verifier; never bypass expiry or use
an API policy. Cleanup does not depend on the runner or policy remaining valid.

Post-migration, while deployment remains fenced:

```sh
node /approved/migration-artifact/ops/production/run.cjs verify-post /approved/evidence/backup.json /approved/evidence/post.json
```

Require status=verified, activeMigrations=42, cleanupRequired=false, successful
Prisma diff, unchanged sentinel and idle role posture. Retain administrator SQL
hashes and independent sanitized runner/credential/network teardown evidence.
Only then may an authorized human approve deployment of exactly the bound SHA.
The existing GitHub migration guard remains unchanged and fail-closed for pushes;
manual workflow dispatch is permitted only AFTER migration/post/cleanup evidence.
No automatic migration workflow is added. No deploy/sign/EAS command is executed.

## Receipts, failures and recovery

Receipts are new files outside the artifact, reserved before access, chmod 0600,
and explicitly contain only version, environment, mode, UTC time, finite stage
status, build, artifact/policy/sentinel hashes, approvalId, active migration count,
zero aggregate compatibility counts, posture booleans, cleanupRequired and
connectionClosed. No raw exceptions, child output, SQL rows, policies, URLs,
passwords or arbitrary environment values are serialized. A missing/truncated
receipt or `execution-started` after crash is an uncertain mutation, not success.
Archive only complete reviewed sanitized receipts. Policy digest/reference does
not substitute for verification of its signature and exact bytes.

The first onboarding SQL and final reporting SQL have no explicit transaction;
the enum addition is separately committed. Therefore failure may leave partial
DDL and a failed ledger row. Never automatically retry or repair the ledger.
Stop application/deployment/writers, run independent privilege cleanup, retain
sanitized ledger/catalog evidence, and invoke the approved incident procedure.
Never db push/reset/resolve, fabricate ledger rows, edit historical SQL or manually
apply schema fragments as a shortcut.

Preferred recovery: retain the currently deployed b02a851 application while
investigating a successful additive schema cutover; explicitly verify old-code
compatibility before restoring writers. On failed/uncertain partial migration,
the approved database administrator restores PITR to a NEW isolated private
PostgreSQL server/database at the approved pre-cutover restorePoint, verifies all
35 baseline checksums and sentinel, rehearses old-build operation, and performs a
separately approved credential/policy/network cutover. Restore/cutover are Azure
and policy mutations requiring new authorization; this repository performs none.
RPO includes writes after the chosen restore point, and HA remains NotEnabled.
Document outage/restore timing and data reconciliation. Do not drop/overwrite the
original database, or assume application rollback reverses DDL/backfills/triggers.

## Validation and GO/NO-GO

On Windows, restrict the external evidence folder's ACL to the approved operator
and custodian; Unix mode 0600 does not replace a Windows ACL.

```sh
node --test ops/production/production.test.cjs
OPA_ARTIFACT_INSTALL_TEST=1 node --test ops/production/artifact.test.cjs
OPA_DISPOSABLE_PG_TEST=1 node --test ops/production/disposable.test.cjs
node --test packages/environment-policy/policy.test.cjs packages/environment-policy/https.test.cjs apps/api/scripts/staging-migration-path.test.cjs apps/api/scripts/staging-migration-diagnostics.test.cjs
git diff --check
```

The opt-in integration test uses cached PostgreSQL 14, a fresh tmpfs database,
synthetic credentials and an ephemeral loopback-only port. It applies the actual
35 historical migrations using Prisma, then applies the seven exact forward
migrations as the dedicated login, checks ACLs and independently runs cleanup
twice. It does not connect to Azure/production, sign policies or modify historical
migrations. Release must also prove a credential-free Node 22 target-platform
artifact install/engine check and disposable datamodel diff, then review actual
production ownership/ACLs, fresh backup/PITR/recovery, VM/IAM/lease and approval.

NO-GO until those external gates are evidenced and explicit human production
approval is recorded. Tests and generated scripts authorize no production action.
Future releases with a different migration set require a reviewed new contract,
compatibility queries, exact checksum delta, ownership scope and rehearsal.
