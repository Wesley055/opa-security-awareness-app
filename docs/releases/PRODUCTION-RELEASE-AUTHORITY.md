# OPA Production Release Authority

## Status

This document is the canonical non-secret continuity record for OPA production release authority, signed endpoint policy issuance, signer rotation and handover.

Future engineers and handovers MUST use this document as the starting point. Do not reconstruct production release authority from historical handovers, shell history, chat history or old build artifacts unless this document explicitly directs an investigation.

Private signing material MUST NEVER appear in Git, handovers, screenshots, logs, tickets, documentation or chat.

## Mandatory handover contract

Every OPA engineering/release handover MUST contain a section titled:

`Production Release Authority`

That section MUST reference this runbook and carry forward the current:

- active production signer keyId
- signer enrollment/rotation commit
- signer custody mechanism by NON-SECRET reference only
- active endpoint-policy repository path
- endpoint-policy SHA-256
- bound application/API build SHA
- production API origin
- httpsVerifiedAt
- expiresAt
- endpoint verification result
- migration/readiness state
- renewal/rotation status
- unresolved signer/policy risks
- rollback/checkpoint reference

A handover missing this section is incomplete.

Do not duplicate private material into a handover.

## Production API origin

Canonical production API origin:

`https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net`

Observed on 2026-10-06:

- Azure App Service state: Running
- HTTPS-only: true
- Runtime: Node 22 LTS

## Historical production signer

Historical signer keyId:

`opa-production-release-20260919`

Signer enrollment commit:

`dd8277f744471b0ce5242194dbc3c3e728ad36b0`

Commit subject:

`security(production): enroll release policy signer`

The public key remains in:

`packages/environment-policy/trusted-signers.json`

Do not delete this public signer merely because its private authority is unavailable. Historical signed policies must remain verifiable.

## Historical endpoint policies

### Original vc20 policy

The original production endpoint policy was introduced by:

`b5e43c8d456d87b023c03b00e0bedc63ba40dddb`

Commit subject:

`release(android): bind vc20 to verified production endpoint`

The committed policy was bound to build:

`dd8277f744471b0ce5242194dbc3c3e728ad36b0`

It expired on 2026-09-27 and MUST NOT be reused or edited.

### Recovered b02a851 policy

Historical artifact:

`C:\Projects\OPA\packages\environment-policy\release\production-endpoint-b02a851f6fbe.json`

Verified non-secret metadata:

- keyId: `opa-production-release-20260919`
- version: 1
- environment: production
- purpose: endpoint
- build: `b02a851f6fbe369661e3e3fc68d02898851278ba`
- apiOrigin: `https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net`
- httpsVerifiedAt: `2026-09-21T23:25:47.638Z`
- expiresAt: `2026-10-05T23:59:59.000Z`
- envelope SHA-256: `F1E25519D6E58C715680525C293EB572060ACFBBC9194D5FD2A2D0ACFA04773E`

On 2026-10-06 the normal endpoint verifier failed closed against this expired policy with:

`OPA HTTPS/environment verification failed`

and exit code 1.

This is expected fail-closed behavior, not evidence of application breakage.

Never extend its expiry, modify its payload/signature, or copy it over the active policy as a renewal mechanism.

## Historical authority recovery conclusion

Production release worktree recovered:

`C:\Projects\OPA-production-release`

It is pinned at:

`dd8277f744471b0ce5242194dbc3c3e728ad36b0`

The private signing authority corresponding to:

`opa-production-release-20260919`

was NOT recovered.

Searches included:

- production release worktree
- `%LOCALAPPDATA%\OPA`
- `%APPDATA%\OPA`
- likely signer/key filenames
- files modified around signer enrollment
- PowerShell command history
- Git history
- historical endpoint artifacts

Only the staging DPAPI authority was recovered.

Historical recovery is CLOSED unless new concrete evidence appears. Do not repeat broad filesystem/Git/PowerShell archaeology during a future release merely because the old private authority is unavailable.

## Staging precedent — not production authority

A staging-only DPAPI-protected authority exists at:

`%LOCALAPPDATA%\OPA\Staging\ReleaseAuthority-20260913\authority.dpapi`

This is NOT a production signing authority.

The staging implementation demonstrates required security properties for production tooling:

- Ed25519 signing
- private authority protected at rest
- public-key fingerprint validation
- recovered private/public key equality verification
- exact source/build binding
- bounded policy expiry
- immediate signature verification
- exact written-payload verification
- policy/envelope SHA-256 recording
- non-secret issuance receipt
- fail-closed errors

Do not use the staging private authority to sign production material.

## Production signer rotation — 2026-10-06

Reserved successor keyId:

`opa-production-release-20261006`

Repository search confirmed this identifier was unused before rotation work began.

The existing verifier already supports additive signer rotation using:

`keys[environment][envelope.keyId]`

The historical signer MUST remain registered alongside the successor signer.

Rotation safety tests were added and passed 26/26 before any real successor authority was generated.

Test commit:

`a53fc8e`

Commit subject:

`test(security): prove production signer rotation boundaries`

The tests prove:

- historical and successor production signers can coexist
- both explicitly enrolled production signers can validate their own signatures
- unknown key IDs fail closed
- signer-ID substitution fails
- staging signer cannot authorize a production policy

## Pre-rotation rollback checkpoint

Annotated Git tag:

`pre-production-signer-rotation-20261006`

Peeled commit:

`bb914440df309c8fa01867be7c1348ba14d77d4f`

The annotated tag was verified both locally and remotely.

## Private authority Git protection

Commit:

`f8ed265`

Commit subject:

`security(release): prevent private authority artifacts entering git`

Repository ignore protections include:

- `.local/release-authority/`
- `*.private.pem`
- `*.private.key`
- `*.authority.dpapi`

The real production authority must live outside the repository in protected local/approved release-system storage.

These ignore rules are defense in depth, not permission to store production private material inside the repository.

## Endpoint policy security contract

Production EAS/website release configuration consumes a reviewed signed endpoint policy through:

`OPA_ENDPOINT_POLICY_FILE`

Non-development policy verification is fail closed.

The signed endpoint payload binds at least:

- version
- environment
- purpose
- apiOrigin
- build
- httpsVerifiedAt
- expiresAt

Do not:

- manually edit expiry
- manually edit build binding
- manually edit httpsVerifiedAt
- alter signed payload bytes
- replace signatures
- bypass `verify-endpoint.cjs`
- introduce an unsigned production fallback
- supply a verification key through an environment variable
- commit private signing material

## Production database evidence — 2026-10-06

Azure PostgreSQL Flexible Server:

`opa-api-production-server`

Resource group:

`opa-production`

Observed:

- state: Ready
- PostgreSQL: 14
- region: South Africa North
- storage: 128 GiB
- SKU: Standard_B1ms
- public network access: Disabled
- backup retention: 7 days
- earliest observed PITR: `2026-09-30T08:44:02.038370+00:00`
- HA: NotEnabled

`Ready` does not prove migration readiness, sentinel correctness, runtime role correctness or application readiness.

HA NotEnabled is a tracked resilience item and must not be silently represented as highly available.

## Migration state

Current release candidate contains 42 migration directories.

Candidate tail currently includes:

- `20260922230000_bounded_onboarding_authority`
- `20260928010000_support_role`
- `20260928010100_institutional_authority`
- `20260929090000_support_enrollment_provenance`
- `20260930010000_canonical_organization`
- `20260930010100_operational_response_policy`
- `20261004010000_reporting_foundation_reconciled`

The release ledger previously identified a seven-migration production plan.

That does NOT prove production currently has 35/42 migrations.

Production migration state MUST be measured read-only before migration authorization.

Do not run production migrations merely from this document.

## Production migration rule

MIGRATE BEFORE DEPLOYING new code that depends on the new schema.

The historical App Service SSH migration method depended on accidental runtime state where Prisma dev dependencies survived an old deployment. That method is not the desired permanent architecture and must not be treated as a canonical production runbook.

Production migration execution requires a reviewed migration/cutover/recovery procedure inside the production private network.

Never use:

- `prisma db push`
- database reset
- historical migration edits
- fabricated migration history
- manual migration-history repair without an approved incident/recovery procedure

## Production policy issuance checklist

Before issuing a new production endpoint policy:

1. Confirm approved release candidate SHA.
2. Confirm production signer is explicitly enrolled.
3. Confirm protected private authority matches the enrolled public key.
4. Confirm production API resource/origin.
5. Confirm production database migration/readiness state.
6. Verify HTTPS/TLS without disabling certificate validation.
7. Verify `/health/environment`.
8. Require matching production environment.
9. Require matching build SHA.
10. Require `migrationReadiness=ready`.
11. Create a short-lived endpoint payload.
12. Sign exact UTF-8 payload bytes with Ed25519.
13. Independently verify the signature immediately.
14. Verify exact bytes written to disk.
15. Record policy and envelope SHA-256.
16. Record `httpsVerifiedAt` and `expiresAt`.
17. Produce a non-secret issuance receipt.
18. Consume through `OPA_ENDPOINT_POLICY_FILE`.
19. Verify EAS/website configuration fails closed with expired/tampered/wrong-signer policies.
20. Archive only non-secret release evidence.

## Current unresolved items

As of 2026-10-06:

- historical production private authority: NOT RECOVERED
- successor production authority `opa-production-release-20261006`: GENERATED; see completed successor enrollment below
- successor public key: ENROLLED in `a02073b`; fingerprint recorded below
- fresh production endpoint policy: NOT YET ISSUED
- live production migration count: directly verified 35 active / 0 unfinished / 0 rolled back; seven forward migrations pending
- migration/cutover/recovery authorization: PENDING
- iOS successor build after Apple build 5: PENDING

Update this section as each gate closes.

## Handover rule

Every future OPA handover MUST:

1. include a `Production Release Authority` section;
2. link/reference this runbook;
3. carry forward current non-secret signer/policy/build/expiry/hash/status values;
4. explicitly list unresolved release-authority risks;
5. never include private authority bytes, passwords, tokens, secret values or recovery material;
6. never restart historical authority archaeology unless new concrete evidence exists;
7. update this canonical runbook when release-authority architecture changes.

This requirement is mandatory.

## Successor authority tooling provenance

Permanent protected-authority tooling was introduced by:

`af17954`

Commit subject:

`security(release): add protected production authority tooling`

Before any real successor production authority was generated:

- authority custody tests passed 6/6
- CLI boundary tests passed 6/6
- combined test result passed 12/12
- an end-to-end disposable CLI authority creation succeeded
- only a DPAPI-protected `authority.dpapi` artifact was created
- no plaintext private authority artifact was produced
- repeat creation failed closed with `AUTHORITY_ALREADY_EXISTS`
- disposable authority material was deleted after the proof

The successor production authority MUST be generated using this committed tooling or a subsequently reviewed/superseding implementation whose commit is recorded here.

## Successor signer enrollment — completed 2026-10-06

Active successor signer:

`opa-production-release-20261006`

Public-key SHA-256:

`a3243b027e87ae180822b9a5e6fa8f962ba832d4eb7fe5c2cb6b387ce2755106`

Custody:

`Windows DPAPI / current user`

Canonical non-secret custody reference:

`%LOCALAPPDATA%\OPA\Production\ReleaseAuthority-20261006\authority.dpapi`

Do not copy, open, export or commit the protected authority.

Independent post-creation verification confirmed:

- protected authority exists
- protected artifact size observed: 342 bytes
- recovered Ed25519 public fingerprint exactly matched the creation receipt
- private material was not exported

Successor public-key enrollment commit:

`a02073b`

Commit subject:

`security(production): enroll successor release signer`

The historical signer:

`opa-production-release-20260919`

remains enrolled for historical policy verification.

After actual successor enrollment, the complete environment-policy/HTTPS suite passed 32/32 with zero failures.

The successor signer is now ENROLLED.

A fresh production endpoint policy has NOT yet been issued. Endpoint policy issuance must bind the exact approved/deployed release SHA and must occur only after production migration/readiness and `/health/environment` verification.

## Production migration delta verified — 2026-10-06

Live `/health/environment` reported:

- environment: `production`
- build: `b02a851f6fbe369661e3e3fc68d02898851278ba`
- databaseEnvironment: `production`
- migrationReadiness: `ready`
- notificationMode: `live`
- redisEnvironment: `not-configured`
- ssoEnabled: `false`

Repository inspection of exact deployed build:

`b02a851f6fbe369661e3e3fc68d02898851278ba`

confirmed that build contains exactly 35 migration directories.

The current release candidate contains exactly 42 migration directories.

Repository/build delta is therefore exactly seven forward migrations:

1. `20260922230000_bounded_onboarding_authority`
2. `20260928010000_support_role`
3. `20260928010100_institutional_authority`
4. `20260929090000_support_enrollment_provenance`
5. `20260930010000_canonical_organization`
6. `20260930010100_operational_response_policy`
7. `20261004010000_reporting_foundation_reconciled`

The deployed environment verifier validates database identity, signed database/role binding, `_prisma_migrations` existence, completed active rows, migration checksums, duplicate active migration names and exact migration count before reporting `migrationReadiness=ready`.

Therefore the live `ready` result proves production satisfies the 35-migration contract embedded in deployed build `b02a851`.

This does NOT authorize migration automatically.

Before any production mutation, directly inspect the live production migration ledger from an approved environment inside the production private network and reconcile the exact 35 applied names/checksums against the 42-migration candidate.

Production migration sequence remains:

read-only ledger verification -> reviewed cutover/recovery approval -> backup/PITR confirmation -> apply seven forward migrations -> verify all 42 names/checksums -> verify identity sentinel/role -> deploy exact candidate -> verify `/health/environment` reports exact candidate SHA and `migrationReadiness=ready`.

## Production migration execution discovery — 2026-10-06

This section is mandatory continuity information. Future releases MUST begin here instead of rediscovering the production migration topology.

### Authoritative deployed artifact

Azure App Service:

`opa-api-production`

Running process observed:

`node apps/api/dist/main.js`

The authoritative deployed API migration tree is:

`/home/site/wwwroot/apps/api/prisma/migrations`

It contained exactly 35 migrations and matched deployed build:

`b02a851f6fbe369661e3e3fc68d02898851278ba`

The running environment verifier is:

`/home/site/wwwroot/apps/api/dist/shared/config/environment.js`

### Critical stale-root trap

DO NOT use:

`/home/site/wwwroot/prisma`

for production migration decisions or execution.

On 2026-10-06 that stale root tree contained only 22 migrations while the actual running API artifact contained 35.

Likewise, do not rely on the accidental root Prisma CLI merely because:

`/home/site/wwwroot/node_modules/prisma`

exists.

The production artifact intentionally installs production dependencies with `npm ci --omit=dev`; Prisma CLI is an API devDependency. Its presence in the App Service root is historical/accidental runtime residue and is not the canonical migration architecture.

Future handovers MUST carry this warning forward.

### Direct live production migration ledger

Read-only production verification from the running API Prisma client established:

- environment: `production`
- database: `opa-api-production-database`
- runtime role: `opa_production_runtime`
- total `_prisma_migrations` rows: 35
- active migrations: 35
- unfinished migrations: 0
- rolled-back migrations: 0

The exact active migration list matched the 35 migrations embedded in deployed build `b02a851`.

Current candidate contains 42 migrations.

Confirmed forward delta: exactly seven.

### Existing production facility compatibility snapshot

Before the seven-migration rollout, production contained:

- users: 19
- facility-linked inactive users: 0
- active facility admins: 1
- facilities: 2
- active facilities: 2
- inactive facilities: 0
- enrollment requests: 0
- asymmetric enrollment provenance rows: 0
- duplicate OPERATIONAL_EXCEPTION groups: 0

Facility-level reconciliation identified:

`OPA Demo Estate`
- active
- one active facility admin
- eight attached users

`pilot test`
- active
- zero active facility admins
- zero attached users

Do not delete or manually convert either record during migration.

The seven-migration design intentionally retains historical facilities/authority and requires explicit association/commissioning under the new canonical institutional model.

### Runtime database role

Role:

`opa_production_runtime`

Observed effective privileges:

- database CREATE: false
- public schema CREATE: false
- opa_deployment schema CREATE: false
- environment sentinel SELECT: true
- environment sentinel UPDATE: false

This is the intended least-privileged runtime posture.

NEVER grant production migration/DDL authority to `opa_production_runtime` merely to make a release easier.

### Dedicated production migration role

Dedicated role already exists:

`opa_production_migrations`

Observed PostgreSQL role properties:

- LOGIN: true
- SUPERUSER: false
- CREATEDB: false
- CREATEROLE: false

Observed effective privileges on 2026-10-06:

- database CONNECT: true
- database CREATE: false
- public schema USAGE: true
- public schema CREATE: false
- opa_deployment schema USAGE: true
- opa_deployment schema CREATE: false
- environment sentinel SELECT: true
- environment sentinel UPDATE: false
- `_prisma_migrations` SELECT: false

Therefore the migration identity exists but is NOT currently authorized to execute the seven pending DDL migrations.

Do not work around this by using the runtime role, stale App Service Prisma tooling, superuser access, or broad permanent grants.

The production migration execution design must explicitly establish the minimum temporary/permanent privileges required for the reviewed migration set and migration ledger, execute through the dedicated migration identity, verify the complete 42-migration history/checksums, and preserve sentinel immutability.

### Production database infrastructure snapshot

Azure PostgreSQL Flexible Server:

`opa-api-production-server`

Resource group:

`opa-production`

Observed:

- state: Ready
- public network access: Disabled
- backup retention: 7 days
- PITR available
- PostgreSQL 14
- South Africa North
- 128 GiB storage
- Standard_B1ms
- HA: NotEnabled

Production database access is private-network/VNet constrained.

### Seven pending migration integrity

Candidate migration tree was clean with no migration worktree modifications.

The seven forward migration SHA-256 values are:

- `20260922230000_bounded_onboarding_authority`
  `ef567ceafd4f36c80e0ee647ee81c757d16865c6db77bb22e6b7c94e63bd0bce`
- `20260928010000_support_role`
  `fc96270a51700f30e5dca348bf2155b3a514eb67f0cbed131de889a5eb6b12d9`
- `20260928010100_institutional_authority`
  `460aaa54c3e385bfc7df55d7cc0be2b614c433bbb89cb535ea574f45c0afb5e0`
- `20260929090000_support_enrollment_provenance`
  `63b5099f6ca3e18834465f897230f9873bd7c454ef41f4d0129747718d9be8ce`
- `20260930010000_canonical_organization`
  `6e85451094f5d44c0b43415e07179eb9e2c95bae7a92435afe55c35e4b9e57fc`
- `20260930010100_operational_response_policy`
  `a99e91d1a1f833f9e6b5ace5561f6f9f0e0c1cf97d72fbceb4d6c158ec9f2195`
- `20261004010000_reporting_foundation_reconciled`
  `b8e7be2e4690c770ac12b56863ed9ed27d154d60810fc8ff2fa91b0a070245a9`

### Mandatory future migration sequence

Future production releases MUST follow:

1. identify exact release candidate SHA;
2. verify production `/health/environment`;
3. verify authoritative `apps/api/prisma/migrations` tree, never stale root `prisma`;
4. read live `_prisma_migrations` ledger;
5. verify environment sentinel/database/runtime identity;
6. compare exact candidate migration names and checksums;
7. run production-data compatibility preflight for new constraints/indexes;
8. verify PITR/backup posture;
9. use dedicated `opa_production_migrations` identity;
10. verify migration-role privileges without elevating runtime;
11. use reviewed migration execution artifact/tooling, not accidental App Service dependencies;
12. apply only reviewed forward migrations;
13. verify every migration finished, none rolled back and all checksums match;
14. verify exact candidate migration count;
15. verify sentinel remains immutable to runtime/migration identities except as explicitly designed;
16. deploy application code only after required migrations;
17. verify `/health/environment` reports exact deployed SHA and `migrationReadiness=ready`;
18. only then issue the fresh signed endpoint policy;
19. then create EAS production builds.

Never migrate after deploying schema-dependent application code.

## Permanent production migration mechanism — implementation under review

Canonical execution/privilege/backup/recovery runbook: `ops/production/README.md`.

Tooling lives in `ops/production/`: isolated exact-SHA artifact builder, reviewed seven-migration contract, migration-only signed-policy runner, database/ownership/data preflight, administrator SQL generator, explicit sanitized receipt schema and offline/disposable PostgreSQL tests. No migration CLI was added to API runtime dependencies. The existing production workflow and its fail-closed migration guard remain unchanged.

The last verified production snapshot is deployed build `b02a851f6fbe369661e3e3fc68d02898851278ba`, with 35 active migrations and seven forward migrations pending. This implementation performed NO production database/Azure changes, GRANT/REVOKE, migration, deployment, signing or EAS build. A production mutation remains unauthorized.

The dedicated migration login temporarily inherits a narrowly scoped NOLOGIN owner, receives public CREATE and migration-ledger INSERT/UPDATE, and loses them through independently owned administrator cleanup. Runtime never inherits ownership/DDL. Initial ownership transfers, effective PUBLIC/inherited ACL inspection, TEMP revocation, VM/private-network/IAM provisioning, credential delivery, backup/PITR evidence and a hard cleanup deadline are external administrator prerequisites. No privileges expire automatically. A failed migration or missing receipt requires cleanup and incident review; never repair migration history as a shortcut.

The migration policy must be separately signed with purpose=migration and bind exact candidate SHA, complete artifact hash, migration role/database, approved production VM/private addresses, signed sentinel hash, fresh backup evidence and explicit operator approval. API/endpoint policy substitution fails. The production signer rotation is complete and is not redesigned. This work issues no policy.

Mandatory order: administrator/infrastructure/backup review -> explicit approval -> initial scoped owner preparation (once) -> temporary activation -> exact 35-row/checksum/data preflight -> explicitly authorized bundled Prisma 6.19.3 migrate deploy -> verify all 42 rows/schema/sentinel -> independent administrator cleanup -> verify-cleanup and verify-post -> separately approve deployment of the same SHA -> API environment readiness -> separately authorized endpoint signing/EAS. Never deploy schema-dependent code before migration.

GO/NO-GO: NO-GO for production until a reviewed committed target-platform artifact, actual production ownership/ACL inventory, approved private runner/secret custody, backup/recovery evidence, external cleanup supervisor and explicit human authorization are recorded. Tests or a commit/push do not authorize production.

### Mandatory migration handover additions

Every `Production Release Authority` handover MUST also carry the migration runbook reference, approved candidate/artifact/Prisma hashes and platform, exact baseline/forward/candidate migration checksums, runner/private-network/lease approval references, signed migration-policy digest/expiry, backup/PITR/recovery reference, administrator activation/cleanup script hashes, effective owner/migration/runtime posture, sanitized preflight/execution/post/cleanup receipts, external teardown evidence and remaining NO-GO gates. Carry forward the stale root-prisma warning and the migrate-before-deploy rule. Never copy credentials, URLs, private keys, connection strings, tokens or raw child/SQL exception output.

### Implementation verification — 2026-10-07

Focused Windows/PostgreSQL tests: 44/44 PASS (43 tooling cases plus one full real Prisma 6.19.3/PostgreSQL 14 rehearsal). Linux Node 22 isolated artifact install/engine/tamper proof: PASS, 50 locked packages, lock unchanged. Existing environment-policy/HTTPS/staging migration-path/diagnostics tests: 157/157 PASS. API TypeScript check: PASS under cached Node 22 with a read-only source mount and no network; the initial host Node 26 attempt exhausted memory. Final diff/secret scans accompany the review artifact.

The rehearsal applies 35 actual historical migrations, then seven exact forward migrations with the dedicated identity, checks all 42 ledger rows and datamodel, proves metadata-only REFERENCES works after cleanup without application SELECT, repeats cleanup, tests revoked old-owner data ACLs, rejects unapproved role delegation, and proves a failed ownership reconciliation cannot undo already committed privilege revokes. This is a disposable local database, not production evidence.

Idle migration posture also retains REFERENCES on exactly 33 baseline and 12 new application tables for Prisma schema metadata. It retains no application SELECT/DML, sequence authority, ownership, default grants to others or role delegation. Scoped owner ordinary SELECT/UPDATE/TRIGGER/type-USAGE rights are explicit; transfer alone is not assumed to restore them.

The final release artifact cannot be issued from this uncommitted review state. After code review and a committed approved SHA, build and independently verify the exact target-platform artifact, then separately approve migration-policy issuance and the production window. Implementation approval does not authorize production mutation. No commit/push or production operation occurred in this work.

Non-superuser administrator rehearsal: PASS. Generated administrator SQL temporarily borrows scoped-role memberships within each transaction, removes newly borrowed memberships before commit, and preserves prior membership. The administrator must have INHERIT and authorized role-membership, database/schema ACL and old-object ownership authority. No permanent administrator membership or migration-role elevation is installed.

## Production private migration network topology — verified 2026-10-07

Azure production VNet:

`opa-api-productionVnet`

Address space:

`10.0.0.0/16`

Subnets:

### General production subnet

`opa-api-productionSubnet`

CIDR:

`10.0.0.0/24`

Observed:

- no Azure service delegation
- no NSG attached
- no route table attached

This is the candidate subnet for a bounded private production migration runner.

Do not provision a migration runner here until its reviewed network controls exist.

### App Service integration subnet

`opa-api-productionAppSubnet`

CIDR:

`10.0.1.0/24`

Delegated to:

`Microsoft.Web/serverfarms`

Production App Service VNet integration was directly confirmed against this subnet.

Do NOT use this subnet for the migration VM.

### PostgreSQL delegated subnet

`opa-api-productionDbSubnet`

CIDR:

`10.0.2.0/24`

Delegated to:

`Microsoft.DBforPostgreSQL/flexibleServers`

Production PostgreSQL Flexible Server is directly bound to this subnet.

Do NOT use this subnet for the migration VM.

### PostgreSQL network binding

Server:

`opa-api-production-server`

Database:

`opa-api-production-database`

Public network access:

`Disabled`

PostgreSQL private DNS zone:

`privatelink.postgres.database.azure.com`

The private DNS zone is linked successfully to:

`opa-api-productionVnet`

Therefore approved resources in the production VNet can use the production private DNS resolution path, subject to their own network/security controls.

### Redis private DNS

Zone:

`privatelink.redis.cache.windows.net`

It is also linked to the production VNet.

Redis is not required for the production migration runner.

### Network-security discovery

As of 2026-10-07:

- no NSGs were listed in resource group `opa-production`
- `opa-api-productionSubnet` had no NSG
- no existing production VM was present
- no existing approved migration runner was present

Do not create a migration VM first and secure it afterward.

The runner network/security boundary must be reviewed and established before VM creation.

The migration runner must have:

- no public IP
- private production VNet placement
- no placement in App Service or PostgreSQL delegated subnets
- bounded ingress; interactive administration must use an approved private management path
- outbound access restricted to the minimum required release dependencies and production PostgreSQL/approved Azure services
- no inbound Internet exposure
- bounded lifetime/lease
- separately reviewed managed identity/secret-read scope
- independently owned cleanup/termination procedure

Future handovers MUST carry this topology forward and MUST NOT rediscover or guess the production subnet layout.
