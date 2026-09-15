# Permanent staging modular validation

This replaces the monolithic release decision with six serial receipts. It does not authorize an execution, database resize or deployment. The legacy migration workflow remains unchanged and cannot silently invoke this new path.

## Coverage

`apps/api/scripts/staging-gates.json` pins all 20 suite files and 213 full assertion names from executable baseline e330736fd504fee9d082ede4aad8ef4d7a774ecf. The current coverage is Database 9, Security 69, Safety 70, Incident 6, Delivery 50, Admin 9. Every run compares exact suite and assertion identities, not just totals. Missing, substituted, duplicate, failed or skipped tests reject a receipt. The existing 20 assertion-suite files are unchanged.

Facility/operator authorization and administrative isolation remain cross-cutting Security/Admin coverage. Gate 2 includes tenant-isolation and protected-identity; Gate 6 supplies super-admin/institutional authorization proof. The release aggregate requires both; a focused security receipt is not a complete institutional security release decision. Evidence/Insight remains outside this release scope; the existing emergency-intelligence-snapshot suite is retained.

## Invocation and prerequisites

The operator-owned supervisor invokes `node apps/api/scripts/staging-gate-runner.cjs` with a JSON object on stdin, never command-line credentials. Fields are `policy` (Ed25519 envelope), `runtimeUrl` (protected staging source, kept in memory), `vaultToken` (short-lived staging migration-identity token), and, for execution, `preflightReceipt` (the signed handoff described below). Do not store this input or print it. No default live execution or auto-retry exists.

The envelope is verified against the repository staging trusted signer, purpose `modular-validation`, version 1, environment `staging`. Its payload must bind `build` (full candidate SHA), `lease` (24 lowercase hex), source 10.72.4.4/32, repository/branch, execute=true, mode=disposable-validation, exact PostgreSQL hostname/runtime DB, full staging migration identity and runner-subnet IDs, region southafricanorth, private PostgreSQL 10.72.1.4 / Vault 10.72.2.4, zero production routes/assignments, no public VM IP, notifications=disabled, sso=synthetic-only, isolation=private-postgres-only, cleanupOwner=operator-host, runtimeSecretSha256, manifestHash, selected gate names in canonical order and an expiry no more than one hour ahead. See `policyFields` for exact fail-closed fields.

A fresh policy must be issued through the existing controlled staging authority only after the operator verifies live IAM/routes and OS provider-egress isolation. A policy attestation is not a substitute for that live verification. This implementation does not create policies, fetch production credentials, provision a VM or configure networking. Existing provisioning/cleanup supervision remains mandatory. Run only on the approved private Linux host, with the root supervisor and isolated UID/GID 1001 test process. Tests must have no IMDS access and no outbound access except approved private PostgreSQL; the root supervisor has the separately approved Key Vault path. Do not grant bootstrap-secret access to test processes.

Prepare an exact clean branch checkout, npm ci, pinned Node 22.23.2 / npm 10.9.8 / Prisma and client 6.19.3, generated dependencies and reviewed OS isolation before invocation. Source SHA, clean checkout, branch, versions, physical private address and DNS are rechecked. The authoritative preflight performs generate/validate/build and read-only runtime verification before signing; execution requires that receipt. A signed policy refresh is required if the prior policy expires. Cleanup remains permitted after expiry; another gate does not begin.

## Database and connection lifecycle

The driver acquires a server-wide PostgreSQL advisory lock on the administrative connection. All modular invocations, including focused gates, use that same lock. An active gate must finish and clean up before the next begins. Do not run the retired monolithic/manual driver concurrently; its old lock contract is not this campaign's lease.

Gate order: database -> security -> safety -> incident -> delivery -> admin. A focused subset may run in that order but cannot produce full release approval.

Database name is derived exactly as `opa_staging_test_<gate>_<candidate-first-12>_test`. The final `_test` preserves the existing harness's safety assertion. This stays below PostgreSQL's identifier limit. No free-form prefix match permits access: the full signed SHA, gate and lease must also match the protected database sentinel and owner marker. A matching prefix alone is insufficient. A database already present blocks create; cleanup checks the exact lease-owned marker before any drop.

Every gate creates a fresh synthetic-only database and a short-lived role with no runtime CONNECT privilege. It applies the same committed 35 migrations and verifies completion, order, hashes and required schema elements. Nothing is copied from opa_staging. Runtime inspection uses default read-only sessions and read-only transactions, plus Prisma's read-only diff command. The legacy URL guard remains exact opa_staging_test; modular names require the explicit gate-aware validator.

Each suite runs in a fresh Jest child, one worker. SSO runs alone with synthetic configuration. Fresh test PII keys are generated per child; no staging runtime PII keys are reused or persisted. The environment is constructed from an allowlist, not inherited. Test bodies and internal concurrency remain unchanged.

Readiness is shared by the outer beforeEach and completes before truncation/fixture hooks. It calls only `$connect`/failed-attempt `$disconnect`, never an application callback. Three attempts maximum, delays 500 ms then 1,500 ms, no jitter currently, one 20-second budget. It retries explicit transient initialization/acquisition only; authorization, authentication, TLS, identity, sentinel, wrong target, configuration and all application/test errors fail closed. Identity reads happen outside the retry loop. For the four two-client concurrency suites, clients are prepared within that same pre-fixture budget, then handed to the unchanged tests; no transaction replay or concurrency serialization is added. Clients created intentionally inside a test body are never retried by this helper.

A timeout closes readiness and cannot start another attempt while a connect remains in flight. The suite must fail; the supervising process group cleanup terminates outstanding descendants before database drop. Readiness failure/recovery metadata is recorded without error messages or credentials. Test results remain initial outcomes; no Jest retry policy is enabled.

Cleanup drains/disconnects prepared clients, kills the owned child process group, drops the exact marker-owned database, verifies absence, removes the validation role, verifies absence, discards test environment/key references and removes the readiness scratch directory. A cleanup failure blocks the next gate and receipt. The operator supervisor must also remove campaign-only IAM/network access, secrets, checkout and temporary VM/NIC/disk/NAT/public IP afterward, using the existing separately approved resource cleanup path. Per-gate receipts prove database/role/process cleanup; they do not falsely attest that Azure infrastructure was deleted. Release deployment remains blocked until that external cleanup evidence is verified.

## Receipts and release decision

Receipts are exclusively created (`wx`, mode 0600) under the root-owned `/opt/opa/evidence/modular-<lease>` directory. Test UID cannot write them. They contain candidate SHA, gate, manifest hash, expected/actual counts, approved hashed assertion IDs, pass/fail/skip counts, readiness attempts/recoveries, migration count/hash/checksum result, UTC timestamps, database fingerprint, cleanup result and canonical SHA-256 evidence hash. They contain no connection strings, raw command output, SQL or PII.

The aggregate validates each receipt hash and exact suite/test coverage, same full SHA and migration manifest, distinct gate databases, serial timestamps and all cleanup PASS. All six and all 213 assertions are required. Receipt hashes provide integrity, not signatures: retain their digests in trusted operator/CI evidence storage. Do not accept a user-editable set of rehashed receipts as trusted release evidence.

Any application/source candidate SHA change invalidates the prior release aggregate. Focused development evidence can remain historical, but it cannot be mixed into a new-SHA release. The conservative policy requires all six receipts for every final candidate; affected-gate selection is for development feedback only.

Engineering flow: small capability change -> focused unit tests -> relevant integration gate(s) -> immutable candidate build -> separately approved staging deploy -> capability E2E -> retain immutable evidence -> lock capability. Release flow: exact candidate -> all six gates -> aggregate -> smoke/confirmation -> separate production authorization. This is one OPA product and one staging server, with disposable validation databases only.

## Capacity and execution decision

The observed storage pressure and recommended D2ds_v5 / P15 sizing remain separate from this implementation. No resize is performed or implicitly approved. Before scheduling a release campaign, separately settle the capacity decision and issue the fresh candidate-bound policy/lease and live isolation attestation. Do not claim that offline harness tests are six live gate passes. No deployment is authorized by this change.

## Authoritative preflight and signed handoff

Use `preflight(input)` (CLI `mode: "preflight"`) on the same exact candidate and approved private host. It cannot invoke gate creation, migration or suites. It verifies policy, host, checkout, gate/migration manifests, runtime secret fingerprint, private DNS/address, identity, toolchain, and then runs build gates, read-only runtime history/sentinel verification and schema comparison. It writes safe command records, runtime verification metadata and `preflight-unsigned.json` under the exclusive root-owned `/opt/opa/evidence/modular-preflight-<lease>` directory. The unsigned draft is not authorization and cannot be passed directly to execution.

The existing controlled staging authority must independently verify the preflight evidence, including the canonical evidence hash, then sign the draft with the staging policy key, purpose `modular-preflight`. Do not place that private signing key on the validation host. The receipt binds the full candidate SHA, exact signed-policy envelope hash, lease hash and identifier, runner source/identity/subnet, private destinations, runtime database, secret fingerprint, gate selection/manifest, committed migration manifest and execution receipt directory. Its lifetime cannot exceed the policy expiry or one hour from issuance. Any policy refresh requires a new preflight receipt. Signing an unchecked draft is prohibited.

`execute(input)` verifies this signature and all bindings while retaining its own current policy/host/source/DNS/identity/fingerprint checks and exclusive database lock. It does not repeat the initial build/schema-diff commands. Runtime read-only verification after gate cleanup remains mandatory. The operator must preserve exclusive campaign ownership across preflight and execution and issue a fresh receipt after any runtime schema change. This attestation is not a database snapshot or permission to skip cleanup checks.

Preparation and execution use separate exclusive directories; neither overwrites prior evidence. All six gates continue to share the same candidate and lease. An old external read-only report has no automatic authority: the historical reports were not signed preflight receipts, even when a separate execution policy was signed.

## Failure attribution and supervisor integration

Import `failureRecord(error)` from the runner in the operator supervisor catch handler and persist that allowlisted object verbatim in sanitized audit evidence. Do not replace it with a regex over `error.message`, copy a stack, dump environment variables, or retain raw child output. CLI invocations emit the same structured object on stderr. The safe Error message also carries the classified code for legacy callers, but the structured object is the authoritative report.

Failures include operation/stage, safe exception/error classifications, process exit/signal/duration, timeout, Prisma/SQLSTATE/HTTP/transport/resource/readiness fields when available, a transition timeline and cleanup outcome. Unavailable information is null or explicitly unestablished; unknown exceptions are `UNKNOWN_<STAGE>`. Capture happens before lock release and cleanup so those transitions cannot overwrite the original failure. Evidence write failures are separately reported to the supervisor. An `orchestration-failure.json` record is created exclusively if the receipt directory was initialized; earlier failures still return structured metadata directly.

No authority, lease, host, network or execution resource is created by these offline changes. Before another live campaign, the external supervisor must use this handoff and structured error contract and the operator must issue fresh candidate-bound policy/receipt material. Never reuse the cleaned-up historical execution authorization.
