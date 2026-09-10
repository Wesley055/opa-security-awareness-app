# Protected Identity controlled integration — final report

The integration and all applicable local validation are complete. Operational-data encryption cutover and production deployment are separate, explicitly gated steps. No commit, push, merge to main or deployment was performed.

| Requested field | Result |
|---|---|
| CURRENT HEAD | d6b5dfe74fc00e0446ae921f5be9b27a9539da76 (integration/institutional-security; unchanged; no commit) |
| PII SOURCE HEAD | 6d9ec2009d518ca61aa6b0f15bf357fdace6f35c plus the inspected uncommitted PII implementation; no cherry-pick |
| MIGRATION COLLISION | YES: source 20260909010000_protected_identity_foundation and existing 20260909010000_allow_locationless_incidents share a timestamp |
| MIGRATION RESOLUTION | Three new forward migrations after the current enrollment migration; all 24 existing integration migrations unchanged. Production deployment ledgers still require review |
| SCHEMA CHANGES | IdentityAccessGrant, ProtectedIdentifier, IdentityResolutionAudit; two permission/kind enums; nullable outbox references; anonymous/system audit source classification. Existing Facility/User are authoritative; no duplicated tenant/membership models |
| ENCRYPTION MODEL | AES-256-GCM with random nonces, versioned keys and authenticated tenant/subject/source/kind binding. Existing enrollment AES-GCM format retained. No automatic operational-data conversion |
| HMAC LOOKUP | Independent-key, domain-separated HMAC-SHA-256; authorized exact tenant matching; masked results. Existing global User email/phone uniqueness retained |
| PRODUCTION SECRETS REQUIRED | PII_ENCRYPTION_KEYS_JSON, PII_LOOKUP_KEY, existing ENROLLMENT_ENCRYPTION_KEY. Required selectors: PII_CRYPTO_ADAPTER=local, PII_ENCRYPTION_KEY_VERSION, PII_LOOKUP_KEY_VERSION. Protected delivery also needs PII_DELIVERY_ACTOR_USER_ID and independent facility grant. See integration contract for formats/rotation |
| MASKED DEFAULT | [protected] for projected identity names/email/phone in administrative, roster, queue and incident-detail responses; opaque IDs/roles/states retained; safe invitation error projection |
| PLAINTEXT REVEAL POLICY | Explicit opaque-ID endpoint; server-derived facility; active institutional role plus current independent RESOLVE grant; SUPPORT_CASE/ACCOUNT_RECOVERY plus UUID case reference; least-privilege no-store response. No implicit ADMIN/platform/bulk reveal |
| REVEAL AUDIT | Append-only opaque audit; protected reveal commits before plaintext return/provider call. Enrollment/reset workflow decryption journals inside its existing transaction. Concurrent reveal, audit-failure dispatch and platform masking regressions pass |
| TENANT COMPATIBILITY | User.facilityId remains membership authority; current role/account/facility and grants are checked. Original outbox facility is verified for snapshot cutover |
| ENROLLMENT COMPATIBILITY | HTTP 202 / VERIFICATION_PENDING; no User creation or global existence check before verification; existing-account acceptance requires auth; pending/reset delivery purposes retained; global uniqueness unchanged |
| SUPER ADMIN COMPATIBILITY | Existing platform ADMIN sees masked administration. Future Super Admin must retain this contract. Current reveal is facility-scoped even for ADMIN; exceptional platform reveal is not implemented |
| DELIVERY CONFIRMATION COMPATIBILITY | Existing workers own claims/retries/provider calls; bounded audited snapshot resolution supplies required transport data. No duplicate confirmation logic; SENT still means provider acceptance |
| FILES CHANGED | 55 target-repository code/test/document/evidence files listed below; preexisting .gitignore and unrelated scripts/artifacts left untouched |
| MIGRATIONS | 20260910120000_protected_identity_foundation; 20260910120100_protected_recipient_snapshots; 20260910120200_enrollment_resolution_audit |
| FOCUSED PII TESTS | PASS: 47 unit tests across crypto, grants/audit, logging, masking, backfill and production configuration; 27 PostgreSQL PII tests |
| TENANT/ENROLLMENT TESTS | PASS: enrollment.int-spec.ts: 26 passed; tenant-isolation.int-spec.ts: 18 passed; protected-identity.int-spec.ts: 27 passed; invitation-delivery-worker.int-spec.ts: 6 passed; related unit regressions included in the full API suite |
| POSTGRES | PASS: 77/77 tests, 4 suites, PostgreSQL 16.14; all 27 migrations exercised. Isolated migration proof preserved 7 existing records across 7 tables including timeline/evidence provenance |
| FULL API | PASS: 683/683 tests, 80 suites |
| WEBSITE | PASS: 22 tests / 3 files (facility-admin-residents, resident-management, operator-tracking), using --pool=forks --maxWorkers=1 --no-file-parallelism |
| MOBILE | PASS: 9 tests / 2 suites (authStore.enrollment, authStore) |
| PRISMA | PASS: client generate and schema validate (Prisma 6.19.3) |
| TYPESCRIPT | PASS: API tsc --noEmit, including test fixtures. Website/mobile typechecks not run because their files were not changed |
| BUILDS | PASS: API build. Website build not run (no website files changed); no mobile build requested or performed |
| LINT | PASS: changed API source/test TypeScript files; the last two integration-test edits also linted separately. Migration validation script passed node --check |
| DIFF CHECK | PASS: git diff --check; no tracked historical migration changes |
| REMAINING GAPS | Legacy User/EmergencyContact columns, legacy outbox producers and unconverted payloads require deliberate ownership/collision/backfill and producer cutover; no application-wide encryption claim. Production keys/custody/grants/checkpoints and deployed-migration ledger review remain. No zero-downtime lookup/enrollment rotation or SSO federation mapping is implemented |
| SAFE TO ADD SUPER ADMIN | YES, against the masked administration contract; not platform-wide plaintext reveal |
| SAFE TO ADD SSO | NO: verified issuer/subject-to-account/institution ownership mapping and the federation policy must be designed first |
| SAFE TO ADD COMMAND CENTER | YES, against masked, authorized facility-scoped APIs; not unrestricted plaintext aggregation |
| SAFE TO COMMIT | YES as this tested additive integration with the documented cutover boundaries; not as a claim of completed production/account-wide PII encryption. No commit was made |

## Files changed

- apps/api/pii-migration-validation.json
- apps/api/prisma/migrations/20260910120000_protected_identity_foundation/migration.sql
- apps/api/prisma/migrations/20260910120100_protected_recipient_snapshots/migration.sql
- apps/api/prisma/migrations/20260910120200_enrollment_resolution_audit/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/scripts/validate-pii-migration.cjs
- apps/api/src/app.module.ts
- apps/api/src/modules/admin-provisioning/admin-provisioning.invitation.spec.ts
- apps/api/src/modules/admin-provisioning/admin-provisioning.module.ts
- apps/api/src/modules/admin-provisioning/admin-provisioning.service.ts
- apps/api/src/modules/admin-provisioning/identity-delivery.ts
- apps/api/src/modules/admin-provisioning/invitation-delivery.worker.spec.ts
- apps/api/src/modules/admin-provisioning/invitation-delivery.worker.ts
- apps/api/src/modules/auth/enrollment.service.ts
- apps/api/src/modules/emergency-intelligence/emergency-intelligence.service.ts
- apps/api/src/modules/evidence/evidence.service.ts
- apps/api/src/modules/facilities/facilities.service.ts
- apps/api/src/modules/incidents/incident-detail.service.spec.ts
- apps/api/src/modules/incidents/incident-detail.service.ts
- apps/api/src/modules/notifications/notification-dispatch.worker.ts
- apps/api/src/modules/notifications/notification.module.ts
- apps/api/src/modules/notifications/notification.service.dispatch.spec.ts
- apps/api/src/modules/notifications/notification.service.ts
- apps/api/src/modules/notifications/providers/email.provider.ts
- apps/api/src/modules/notifications/providers/push.provider.ts
- apps/api/src/modules/notifications/providers/sms.provider.spec.ts
- apps/api/src/modules/notifications/providers/sms.provider.ts
- apps/api/src/modules/notifications/providers/voice.provider.ts
- apps/api/src/modules/notifications/providers/whatsapp.provider.ts
- apps/api/src/modules/protected-identity/identity-crypto.spec.ts
- apps/api/src/modules/protected-identity/identity-crypto.ts
- apps/api/src/modules/protected-identity/key-configuration.spec.ts
- apps/api/src/modules/protected-identity/masked-person.spec.ts
- apps/api/src/modules/protected-identity/masked-person.ts
- apps/api/src/modules/protected-identity/pii-logging.spec.ts
- apps/api/src/modules/protected-identity/protected-backfill.spec.ts
- apps/api/src/modules/protected-identity/protected-backfill.ts
- apps/api/src/modules/protected-identity/protected-identity.controller.ts
- apps/api/src/modules/protected-identity/protected-identity.module.ts
- apps/api/src/modules/protected-identity/protected-identity.service.spec.ts
- apps/api/src/modules/protected-identity/protected-identity.service.ts
- apps/api/src/modules/protected-identity/protected-snapshots.service.ts
- apps/api/src/redis/redis.service.ts
- apps/api/src/shared/filters/global-exception.filter.spec.ts
- apps/api/src/shared/filters/global-exception.filter.ts
- apps/api/src/shared/middleware/correlation-id.middleware.ts
- apps/api/src/shared/middleware/request-logging.middleware.ts
- apps/api/src/shared/security/enrollment-resolution.ts
- apps/api/test/int/enrollment.int-spec.ts
- apps/api/test/int/invitation-delivery-worker.int-spec.ts
- apps/api/test/int/protected-identity.int-spec.ts
- apps/api/test/int/tenant-isolation.int-spec.ts
- docs/security/protected-identity-integration-inventory.md
- docs/security/protected-identity-integration-report.md
- docs/security/protected-identity-integration.md

## Evidence and reproduction

- Pre-edit overlap inventory: protected-identity-integration-inventory.md.
- Architecture, secret formats, role/scope policy, migration/cutover and remaining boundaries: protected-identity-integration.md.
- Repository migration proof: apps/api/pii-migration-validation.json.
- Detailed validation logs and Jest JSON: C:/Users/mohammed.WESLEYWEST/.codex/visualizations/2026/09/10/01a08a8c-4a49-74d1-a395-13c48a549f33/pii-validation.
- API: node ../../node_modules/jest/bin/jest.js --runInBand.
- PostgreSQL: node ../../node_modules/jest/bin/jest.js --config jest-int.config.ts --runInBand --testPathPattern="protected-identity|tenant-isolation|enrollment|invitation-delivery-worker".
- Migration preservation: node scripts/validate-pii-migration.cjs (requires the existing local .env.test.local; creates a new isolated _test database).
- Initial failures were resolved: test constructors followed the merged worker dependencies; host-secret precedence was removed from the tenant JWT fixture; old raw-response assertions now verify masking/safe errors. Authorization assertions were preserved.
