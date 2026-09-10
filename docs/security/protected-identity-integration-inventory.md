# Protected Identity controlled integration: pre-edit inventory

Integration: integration/institutional-security, d6b5dfe74fc00e0446ae921f5be9b27a9539da76.
PII source: codex/protected-identity, 6d9ec2009d518ca61aa6b0f15bf357fdace6f35c, plus uncommitted tracked and untracked implementation. The branch commit alone does not contain the PII work.

## Exact direct file overlaps

- apps/api/prisma/schema.prisma
- apps/api/src/modules/admin-provisioning/invitation-delivery.worker.ts
- apps/api/src/modules/admin-provisioning/invitation-delivery.worker.spec.ts
- apps/api/src/modules/notifications/providers/email.provider.ts
- apps/api/src/modules/notifications/providers/sms.provider.ts
- apps/api/test/int/invitation-delivery-worker.int-spec.ts

## Migration chain

MIGRATION COLLISION: YES. Source 20260909010000_protected_identity_foundation shares timestamp 20260909010000 with current 20260909010000_allow_locationless_incidents. Source 20260909020000_protected_recipient_snapshots depends on its foundation and predates current 20260909120000_verification_first_enrollment. Current tenant audit migration is 20260907120000_tenant_isolation_audit. Preserve all existing integration migrations. Any reconciled PII migrations must be additive and follow current history; source filenames must not be copied unchanged. Deployment migration ledgers have not been inspected; no production migration or backfill is authorized by this inventory.

## Authority and account overlap

Integration authority is User.facilityId with active account/facility checks and server-side enrollment inviter validation. Source adds IdentityTenant and IdentityTenantMembership without binding them to this authority. Copying these independently would create a parallel membership model. Source documentation explicitly leaves verified organization mapping unresolved and prohibits silently inferring its tenant from Facility.id. The reconciliation must resolve this incompatibility explicitly.

User.email and User.phoneNumber remain required and globally unique. Source ProtectedIdentifier has a tenant-scoped, nonunique HMAC index; it cannot enforce global account uniqueness. User/EmergencyContact plaintext columns and writers remain in the source lane. This is a foundation, not a completed account cutover.

## Enrollment and delivery overlap

Integration EnrollmentRequest stores encrypted identityCiphertext and idempotencyDigest. Public requests perform no User lookup, create no User, return VERIFICATION_PENDING via HTTP 202, and defer existing-account acceptance to authenticated ownership checks. AccountInvitationDelivery.userId is nullable and has purpose, enrollmentId and requestCiphertext. Worker preparation handles ENROLLMENT and PASSWORD_RESET. Source invitation snapshot resolution assumes an existing subject user and only legacy activation delivery. Preserve current preparation and eligibility paths; reconcile protected snapshots only for compatible rows. Never replace the newer schema or worker wholesale.

Enrollment crypto uses AES-256-GCM and ENROLLMENT_ENCRYPTION_KEY; the same key also backs domain-separated idempotency HMAC. PII uses independently keyed HMAC lookup and versioned AES-256-GCM envelopes bound to tenant, subject, source and kind. These envelopes are incompatible and must not be silently relabeled.

## API and authorization overlap

Source protected routes accept tenantId as route input and check independent grants. A reconciled institutional route must derive authoritative scope server-side. ADMIN provides no source RESOLVE grant. Interactive reveal supports SUPPORT_CASE/ACCOUNT_RECOVERY plus opaque case reference and audit-before-return; internal DELIVERY resolves bound snapshots only. Source has no bulk reveal endpoint.

Existing AdminProvisioningService still returns plaintext in member lists, resident lookup, provisioning and assignment responses. Facilities/incident projections still select names. Source masked projection protects only new protected-identity endpoints. Ordinary institutional APIs need explicit boundary changes and client contract validation. Administrative global lookup/provisioning also retain identifier-specific conflicts; they must not become public enrollment oracles.

## Keys, logging, migration and testing

PII configuration: PII_CRYPTO_ADAPTER, PII_ENCRYPTION_KEYS_JSON, PII_ENCRYPTION_KEY_VERSION, PII_LOOKUP_KEY, PII_LOOKUP_KEY_VERSION; PII_DELIVERY_ACTOR_USER_ID identifies an independently authorized worker. Keys must be distinct 32-byte values; source validates canonical base64/version labels. Missing adapter currently installs UnconfiguredCrypto rather than failing production startup. Encryption read-key rotation is supported; HMAC rotation needs reindex/cutover or dual indexes before changing active version.

Source logging changes remove provider recipients, arbitrary provider errors, raw exception stacks, query values and untrusted correlation IDs. Reconcile SMS/email with current lint remediation. Snapshot backfill is explicit per-row and verifies encryption before clearing source fields; no automatic data conversion is acceptable. Existing logs/backups and live plaintext identity columns remain separate cutover work.

Source includes crypto, authorization, logging, backfill unit tests, PostgreSQL PII integration and migration preservation script. Their saved results are not validation of this integration. All requested gates must run against the reconciled integration; none has run at inventory time.

Unrelated existing .gitignore modification and untracked scripts/artifacts in integration must remain untouched. Do not commit, push, merge or deploy.