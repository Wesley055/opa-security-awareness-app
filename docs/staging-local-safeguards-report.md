# Local staging safeguards implementation

2026-09-11. No Azure provisioning/deployment, production data/configuration change, real staging endpoint setting, commit, push or merge.

Implemented explicit development/staging/production classification and a shared signed binding verifier. API main performs preflight and database identity/migration checks before importing AppModule. A minimal /health/environment response exposes only environment, build, databaseEnvironment, redisEnvironment, notificationMode, ssoEnabled and migrationReadiness.

EAS development/preview/production map explicitly to development/staging/production. Preview's production URL has been removed. No preview URL is set. Hosted Expo builds require signed endpoint classification plus live verified HTTPS health metadata. Mobile runtime rejects missing classification, wrong metadata and nondevelopment Metro fallback. Website upstream readers share the signed boundary; startup also verifies HTTPS metadata. The Next build root includes the shared package.

Every notification provider has a staging deny/allowlist guard. A new forward-only migration adds StagingNotificationBudget for shared run/hour limits. Historical migrations remain unchanged. Delivery denial has an explicit audited reason and cannot create successful delivery truth. SSO is off by default in staging; enabled configurations must match signed issuer/client/trust/secret/callback bindings. PII ring, lookup/enrollment keys and version/provenance are required and fingerprint-bound.

Migration preparation is apps/api/scripts/staging-migrate.cjs and docs/workflows/staging-migrations.yml.example. The workflow is intentionally inactive, outside .github/workflows. The script accepts staging only, requires a migration-purpose policy, validates isolation and identity before migrate deploy, then verifies the entire chain. No Azure commands are present.

See packages/environment-policy/README.md for exact variable/manifest contracts, sentinel provisioning and rollout prerequisites. The original design document remains the planning baseline; this report describes the current implementation.

## Readiness boundaries

The trust registry is intentionally empty. All hosted startup/builds are therefore blocked until legitimate signing keys and approved policies are supplied. No staging API exists or has been verified. Resource ID/key provenance bindings must be independently checked by the release authority; the local verifier does not discover Azure IAM or independently certify a signed inventory. No private signing keys were created/configured outside ephemeral tests.

The existing installed/engineering APK is not an acceptance artifact. A separate staging app identifier/signing/deep-link configuration and physical tests still belong to the eventual acceptance build preparation; this task changes endpoint safeguards, not installed device data. Existing physical acceptance script/evidence is preserved.

Production runtime paths retain their notification and optional-Redis semantics after valid policy onboarding, but the new explicit startup requirements are a deliberate rollout prerequisite. No deployment should occur with today's production settings unchanged. The production migration guard remains intact and will require review of the new forward migration.

## Validation

- Shared signed policy/HTTPS tests: 29 passed, including staging fixture, resource/credential mismatches, invalid signature, certificate failure, redirects, wrong build/classification and pending migrations.
- API focused regressions: 100 passed across 13 suites. Final environment/startup subset: 18 passed across 4 suites (overlaps the regression run; adds two startup-order cases).
- PostgreSQL: 18 passed across 2 suites, including concurrent shared quota limits and a real ledger denial with no acceptance/delivery timestamps. Local opa_test/PostgreSQL 16.14 only; 35 migrations applied. No historical migration changes.
- Mobile runtime configuration: 5 focused tests passed. The earlier broad run passed the existing 266 tests but initially rejected the new Jest mock declaration; that declaration was corrected and all 5 new tests passed afterward. No claim of a fresh full mobile run is made.
- Actual Expo config: explicit development succeeds with no endpoint; preview without an approved endpoint rejects.
- Website: 136 tests passed across 36 suites.
- Prisma validate/generate: passed. API/mobile/website TypeScript: passed.
- API and website builds: passed again after the final implementation changes. No acceptance APK was built.
- Changed API/mobile/website/shared Node lint: passed. git diff --check: passed, with existing Windows line-ending notices only.

Tests use reserved synthetic fixtures and the guarded local opa_test database. No live notification, production or staging endpoint is contacted by these tests.

## Files in this implementation

- apps/api/package.json
- apps/api/prisma/migrations/20260911120000_staging_notification_budget/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/scripts/assemble-production.cjs
- apps/api/scripts/staging-migrate.cjs
- apps/api/src/main.ts
- apps/api/src/modules/health/health.controller.ts
- apps/api/src/modules/notifications/delivery-ledger.service.ts
- apps/api/src/modules/notifications/outbound-environment.spec.ts
- apps/api/src/modules/notifications/outbound-environment.ts
- apps/api/src/modules/notifications/providers/email.provider.ts
- apps/api/src/modules/notifications/providers/push.provider.ts
- apps/api/src/modules/notifications/providers/sms.provider.ts
- apps/api/src/modules/notifications/providers/voice.provider.ts
- apps/api/src/modules/notifications/providers/whatsapp.provider.ts
- apps/api/src/modules/sso/sso-environment.spec.ts
- apps/api/src/modules/sso/sso-environment.ts
- apps/api/src/modules/sso/sso.service.ts
- apps/api/src/shared/config/env.validation.spec.ts
- apps/api/src/shared/config/env.validation.ts
- apps/api/src/shared/config/environment.spec.ts
- apps/api/src/shared/config/environment.ts
- apps/api/test/int/staging-notifications.int-spec.ts
- apps/mobile-app/app.config.ts
- apps/mobile-app/eas.json
- apps/mobile-app/src/config/api-config.spec.ts
- apps/mobile-app/src/config/api-config.ts
- apps/website/next.config.ts
- apps/website/src/app/api/enroll/route.ts
- apps/website/src/app/api/operator/password-reset/confirm/route.ts
- apps/website/src/app/api/operator/password-reset/request/route.ts
- apps/website/src/instrumentation.ts
- apps/website/src/lib/environment-api.spec.ts
- apps/website/src/lib/environment-api.ts
- apps/website/src/lib/operator-session.ts
- apps/website/src/lib/super-admin-api.ts
- apps/website/src/lib/tracking.ts
- docs/staging-local-safeguards-report.md
- docs/workflows/staging-migrations.yml.example
- package-lock.json
- packages/environment-policy/README.md
- packages/environment-policy/fixtures.cjs
- packages/environment-policy/https.test.cjs
- packages/environment-policy/index.cjs
- packages/environment-policy/index.d.cts
- packages/environment-policy/policy.test.cjs
- packages/environment-policy/trusted-signers.json
- packages/environment-policy/verify-endpoint.cjs
- packages/environment-policy/verify-endpoint.d.cts

## Final decision

SAFE TO COMMIT: YES for the local safeguard changes after review; no commit made.
SAFE TO PROVISION STAGING INFRASTRUCTURE: YES to proceed to a separately approved provisioning step using the design, subject to resource/SKU/budget and IAM review; not authorization to provision now.
SAFE TO POINT ACCEPTANCE APK AT STAGING: NO. No staging resources, trusted signing identities, signed cloud bindings or verified endpoint exist yet.

Remaining work: approve/provision isolated resources; verify Azure ownership and separate Key Vault material; configure read-only environment sentinel and restricted roles; create/sign API and migration policies; apply the complete chain through the staging runner; deploy only after approval; verify endpoint TLS/classification/readiness; supply signed endpoint policy and EAS preview URL; prepare isolated acceptance app identity and execute physical device acceptance. Production onboarding is a separate controlled rollout.
