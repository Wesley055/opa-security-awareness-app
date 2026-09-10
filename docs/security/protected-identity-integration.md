# Protected Identity integration contract

Integration baseline: integration/institutional-security at d6b5dfe74fc00e0446ae921f5be9b27a9539da76.
Source: codex/protected-identity at 6d9ec2009d518ca61aa6b0f15bf357fdace6f35c plus its uncommitted PII implementation. No branch cherry-pick, commit, push, main merge or deployment was performed.

## Authoritative scope

This integration follows the current institutional-security account model. Facility is its institutional boundary; User.facilityId remains the sole membership authority. No IdentityTenant or IdentityTenantMembership tables are introduced. ProtectedIdentifier and IdentityAccessGrant reference existing Facility/User records. This does not invent a new Organization model or claim that a facility is independently verified for future federation.

HTTP protected-identity routes take only opaque identifier IDs. Server-side actor lookup derives the facility; active facility, active account, current membership and live grant are checked again by the resolver. Moving a user out of the facility invalidates access without maintaining a duplicate membership table. A historical protected record retains its original facility; a reassignment does not rewrite ownership or ciphertext.

READ_MASKED, WRITE, LOOKUP, RESOLVE and DELIVERY are independent, expiring, revocable grants with an opaque approval reference. Interactive operations require ADMIN, FACILITY_ADMIN or FACILITY_OPERATOR in addition to the grant and current facility authority. DELIVERY permits a separately granted active worker principal in the same facility. No grant provisioning endpoint is exposed. Database administrators retain their underlying database privileges.

## Masked API contract and Super Admin

Administrative provisioning, exact resident lookup, membership lists, assignment/removal responses, operator rosters, incident queues and incident details mask projected firstName, lastName, email and phoneNumber as [protected]. Opaque IDs, role, activation/account state, operational incident data and administrative facility context remain available. Invitation history returns a fixed safe failure message instead of historical provider error text. Existing string-shaped client fields remain compatible; the corresponding website and mobile regressions were run.

The current platform ADMIN can administer facilities and memberships through existing authorized routes, seeing masked identities. A future Super Admin must inherit this masked contract; neither title nor ADMIN grants plaintext access. Current reveal is facility-scoped, including for ADMIN. There is no platform-wide reveal or bulk plaintext endpoint. A future exceptional platform disclosure needs a distinct approved server-side case/scope policy, not a caller-supplied tenant or role.

GET /protected-identities/:id returns the allowlisted masked identifier projection without decryption. POST /protected-identities/:id/resolve accepts only SUPPORT_CASE or ACCOUNT_RECOVERY and a UUID caseReference; it returns only value after authorization and durable audit commit. Missing, foreign and unauthorized identifiers have the same 404 response. Both endpoints use Cache-Control: no-store. Public create, grant and lookup endpoints are absent. Internal exact lookup requires LOOKUP and returns at most 100 masked results.

## Encryption, lookup and required configuration

PII_CRYPTO_ADAPTER=local selects the implemented adapter. Production startup fails if it is absent/unsupported; invalid explicit key configuration fails in all environments without echoing input. An unconfigured nonproduction adapter fails operations instead of inventing keys.

Required secret material:
- PII_ENCRYPTION_KEYS_JSON: version-to-canonical-base64 map of 32-byte encryption keys.
- PII_LOOKUP_KEY: a canonical-base64 32-byte HMAC key, distinct from every encryption key.
- ENROLLMENT_ENCRYPTION_KEY: existing 64-hex-character enrollment key. Retain it for existing enrollment/reset ciphertext; it is a separate envelope format and must not be silently relabeled.

Required selectors: PII_ENCRYPTION_KEY_VERSION and PII_LOOKUP_KEY_VERSION. PII_DELIVERY_ACTOR_USER_ID identifies an active, independently authorized delivery principal when dispatching protected snapshots. Selectors and actor IDs are configuration, not secret key bytes. Inject secrets through the production secret manager; no key values belong in source, logs or responses. This integration supplies no production keys and deploys no KMS/HSM.

Protected values use AES-256-GCM, random 96-bit nonces and 128-bit authentication tags. AAD binds format/normalization/encryption-key versions, facility, subject, source and kind. Exact matching uses domain-separated HMAC-SHA-256 over facility, kind, normalization version, lookup-key version and normalized value. It does not use deterministic encryption. Email normalization trims/lowercases without rewriting dots/plus tags; protected phone lookup requires explicit E.164. The tenant HMAC index is not a substitute for global account uniqueness.

Encryption rotation: introduce a new version, retain old read keys, re-encrypt with original binding, verify persisted round trips before swapping, and retain keys required by backups. Never reuse version labels for different key bytes. HMAC rotation currently requires a controlled reindex/cutover or an explicitly implemented dual-index phase before switching the active key/version; changing the selector alone breaks old matches. Enrollment v1 rotation is a separate migration because its existing format has no key selector. Its existing idempotency digest continues using the original domain-separated enrollment key; it is not the PII equality-lookup key.

## Auditing and enrollment

IdentityResolutionAudit is append-only against ordinary UPDATE/DELETE and records opaque source, actor when one exists, facility when applicable, purpose, approval grant when applicable, case/request reference, encryption-key version and database timestamp. It contains no phone/email, ciphertext, HMAC, provider payload or arbitrary free-text reason. Database owners/superusers can bypass database protections; external audit retention and monitoring remain deployment responsibilities.

ProtectedIdentifier resolution commits the audit transaction before plaintext leaves the service. Concurrent reveals create independent audit records. Audit failure prevents provider dispatch. Verification-first enrollment and password-reset delivery also journal decryption through resolveEnrollmentIdentity inside their existing transaction; provider dispatch occurs only after that transaction commits. Pending public requests have no fabricated account or membership: audit actor/facility may be null, purpose identifies the internal workflow, and sourceType plus opaque source ID identify the enrollment/reset request. Failed transactions release no plaintext response/provider call and roll back their provisional audit.

Public enrollment still returns HTTP 202 / VERIFICATION_PENDING, performs no pre-verification global User lookup and creates no immediate account. Both ownership proofs precede account lookup/creation. Existing-account acceptance still requires authentication, matching identifiers and current server-side inviter/facility validation. Existing User.email/phoneNumber global unique constraints and normalization/serialization remain intact.

## Delivery Confirmation boundary

The existing notification and invitation workers own queue claims, retries and provider dispatch. ProtectedSnapshotsService supplies only the required frozen recipient/payload to those workers after source/kind/subject/facility validation and audited decryption. A protected reference never falls back to plaintext if a key, grant, binding or audit fails. Ingestion verifies the outbox's original facility and current subject authority. Invitation snapshots are restricted to LEGACY_INVITATION rows with a user; pending enrollment/password-reset purposes retain their dedicated encrypted workflow.

No Delivery Confirmation logic is duplicated. Provider IDs, attempts and acceptance timestamps remain operational metadata. SENT still means provider acceptance, not confirmed delivery. Unimplemented transports still fail honestly. Ordinary HTTP/provider/worker/Redis/evidence/location failure logs omit recipients, query values, arbitrary errors, stacks and secrets.

## Forward migration and controlled cutover

MIGRATION COLLISION: YES. The source foundation timestamp 20260909010000 collides with the existing allow_locationless_incidents migration. Existing integration migration files remain unchanged. New migrations follow verification_first_enrollment:
1. 20260910120000_protected_identity_foundation: grants, protected records and append-only audit against authoritative Facility/User records.
2. 20260910120100_protected_recipient_snapshots: nullable outbox references and protected-row plaintext constraints.
3. 20260910120200_enrollment_resolution_audit: nullable anonymous/system audit authority, source classification and legacy-only invitation snapshot constraint.

The complete 27-migration chain was exercised on local PostgreSQL 16.14. The isolated upgrade proof seeds and compares existing users, facilities, incidents, notifications, invitations, timeline and evidence: seven records across seven tables remain unchanged. No production database or production migration ledger was accessed. Before deployment, inventory applied migration names/checksums in every target, including whether any separate PII lane has already applied its old filenames; reconcile such deployments forward rather than rewriting history.

Backfill requires an explicit manifest of verified ownership, source UUID, kind and expected updatedAt. Dry-run first; process at most 100 items per batch with durable checkpoints. Lock each source row, reject SENDING/stale/wrong-facility/wrong-purpose rows, seal and verify the persisted representation before clearing source plaintext in the same transaction. Audit/crypto failures roll back. Idempotent replay verifies ciphertext and binding. Stop on checkpoint failure; investigate and retry safely. Do not infer unknown ownership or auto-provision grants.

Roll out compatible readers everywhere before enabling protected writers/backfill. Provision and test keys, recovery and scoped grants first. Reconcile every manifest/checkpoint and remaining legacy count. Keep old keys/backups according to policy. For protected data, restore correct key/authority after failures; never reconstruct legacy plaintext columns or roll back to readers that cannot resolve protected records.

## Remaining deployment and product boundaries

This is an additive controlled integration, not a claim that all historical or newly produced application data is encrypted. Legacy User/EmergencyContact identity columns, existing global account lookup, unconverted notification payloads and legacy outbox writers remain until an explicit ownership/collision/backfill and producer cutover. No backfill was run against operational records. Global account encryption/HMAC uniqueness requires a separate globally scoped index design and writer/auth migration; this change deliberately does not replace global uniqueness with tenant HMACs or blank identity columns.

Self-service profile/auth claims, family bearer tracking names, geolocation, arbitrary incident/timeline content, evidence bytes and historical infrastructure/provider logs/backups are outside the new protected-contact DTO/envelope boundary. Their separate minimization, encryption, retention and authorization policies still apply. Production custody, durable checkpoint hosting, grant-approval operations and backup rotation must be established before protected-data rollout. No zero-downtime lookup/enrollment key rotation is claimed.

Future SSO must bind verified issuer+subject to stable account and approved institution authority; mutable email alone cannot establish ownership. There is no Organization/federation model in this baseline. Command Center and Super Admin work can build against masked DTOs, but must not assume platform plaintext, bulk disclosure, automatic grant creation or completed account encryption.
