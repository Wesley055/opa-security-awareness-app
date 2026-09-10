# Controlled Super Admin integration report

CURRENT HEAD: `17673c4bd6f4b452d152d9600dda1573e3ab146b`, branch `integration/institutional-security`, workspace `C:\Projects\OPA`.

SUPER ADMIN SOURCE HEAD: `6d9ec2009d518ca61aa6b0f15bf357fdace6f35c`. The source worktree contained uncommitted UI additions. Its session shell was adapted; the old branch was not cherry-picked.

SCHEMA CHANGES: Added `EnrollmentRequest.requestedRole`, `revokedAt`, and `lastResentAt`; added administrative audit `reason`, `beforeState`, and `afterState`. Facility and User.facilityId remain authoritative. No Organization or parallel membership table was introduced.

MIGRATIONS: `20260910120000_super_admin_lifecycle`; includes a check restricting staff enrollment roles to requests with facility and inviter provenance. Applied through the existing migration harness only to `opa_test`. No production migration was run.

FACILITY CREATION: Platform-admin guarded creation with existing lifecycle defaults and audit.

FACILITY DIRECTORY: Paginated, platform-authorized directory and facility detail with active/verified status; no fabricated analytics.

OPERATOR SEATS: Verification-first `FACILITY_OPERATOR` enrollment and audited access lifecycle.

FACILITY ADMIN SEATS: Same durable flow with server-selected `FACILITY_ADMIN` role; tenant administrators cannot provision staff roles.

DURABLE STAFF INVITATIONS: Enrollment and the existing EMAIL/SMS outbox pair commit atomically. Stable intake idempotency, serialized resend/revoke, cooldown, expiry, current inviter authority, and acceptance checks are enforced. The recipient page is `/enroll`.

RAW TOKEN EXPOSURE: Removed legacy staff token generation. The admin bridge returns receipts and allowlisted status. Old staff activation secrets cannot activate accounts. Enrollment authentication/acceptance responses stay server-side in the website bridge.

ENROLLMENT COMPATIBILITY: New memberships require both proofs and consent; existing accounts require authentication and acceptance. Cross-facility transfer is denied. Existing unclaimed staff accounts can recover through a fresh invitation for their existing role and both proofs. Resident acceptance remains idempotent.

PII COMPATIBILITY: Member defaults remain masked. Explicit one-identifier reveal uses the existing same-facility PII grant policy and IdentityResolutionAudit, with purpose and case reference. ADMIN does not bypass grants. No bulk plaintext export.

TENANT SECURITY: Platform authority remains separate from tenant roles. Current account state is re-read. Scoped membership mutations refuse foreign/stale membership targets. Old platform identifier lookup and direct membership shortcuts are no longer exposed.

AUDIT: Facility creation, invitation intake/resend/revoke, acceptance, and membership suspension/reactivation/revocation retain provenance. Lifecycle mutations include reason and before/after state. Reveals retain the existing PII audit path.

COMMAND CENTER CONTRACT: Stable facility, role, account activation, administrative active state, membership, and invitation projections are documented in `SUPER_ADMIN_CONTRACT.md`. Command Center source was not changed.

SSO CONTRACT: Facility identity, accepted membership, account state, and enrollment provenance remain distinct. Future tenant SSO must exclude platform ADMIN. No SSO wiring was added.

DELIVERY CONTRACT: Uses AccountInvitationDelivery with its existing purpose constraints and enrollmentId linkage. Delayed provider completions are fenced by status and attempt count. SENT means provider acceptance, not confirmed delivery. No second outbox or Delivery Confirmation implementation.

FILES CHANGED: See the complete file list below. Existing `.gitignore` changes, scripts, logs, and other unrelated artifacts were preserved. Nothing was committed, pushed, merged, or deployed.

FOCUSED TESTS: PASS — 17 API suites, 123 tests, covering admin provisioning, staff intake, worker, enrollment, activation, guards, and protected identity.

POSTGRES: PostgreSQL 16.14, `opa_test`, 28 real migrations; existing migration/partial-index checks passed. Final suite outcomes are recorded below.

INVITATION WORKER: PASS — existing PostgreSQL worker integration and focused worker tests, including guarded completion writes.

ENROLLMENT: PASS — 26 PostgreSQL integration tests, including dual proofs, existing-account authentication/acceptance, failed attempts, expiry, concurrency, and delivery recovery.

TENANT: PASS — tenant-isolation PostgreSQL suite, including masked platform views and retired-route assertions. Historical internal resident helper coverage remains.

PII: PASS — protected-identity PostgreSQL integration and focused protected-identity regressions.

WEBSITE: PASS — 6 suites, 31 tests in forks/single-worker mode. A prior run had two worker-start timeouts; the final rerun executed all files with no unhandled errors.

MOBILE: PASS — 2 suites, 9 authentication/enrollment tests. No mobile files changed; mobile TypeScript was not required or run.

PRISMA: PASS — generate and validate; migration applied to the isolated test database only.

TYPESCRIPT: PASS — API full no-emit check and website production TypeScript check. Mobile was not touched.

BUILDS: PASS — API build and final website production build. Existing Next middleware deprecation warning remains.

LINT: PASS — all changed API and website TypeScript/TSX files, including the final React effect and enrollment audit-test changes.

DIFF CHECK: PASS — git diff --check and whitespace checks for every added file.

REMAINING GAPS: Real email/SMS provider delivery and production configuration were not exercised; integration tests use local test providers. Production rollout requires the migration and matching API/worker revision, existing enrollment encryption/provider configuration, and new verification-first invitations for unclaimed legacy staff seats. PII reveal intentionally remains unavailable without the current same-facility scope and independent grant. Restoring a revoked, detached account is outside the suspension/reactivation operation and requires an explicit recovery policy. SSO and Delivery Confirmation remain unwired as requested.

SAFE TO ADD SSO: YES — the integration boundaries are ready for the next lane; this is not approval to enable production SSO.

SAFE TO ADD COMMAND CENTER: YES — durable staff enrollment and membership/status contracts are available.

SAFE TO COMMIT: YES — reviewed scope only; leave unrelated existing artifacts out. No commit was made.

## Changed files

- [apps/api/prisma/migrations/20260910120000_super_admin_lifecycle/migration.sql](<C:/Projects/OPA/apps/api/prisma/migrations/20260910120000_super_admin_lifecycle/migration.sql>)
- [apps/api/prisma/schema.prisma](<C:/Projects/OPA/apps/api/prisma/schema.prisma>)
- [apps/api/src/modules/admin-provisioning/admin-provisioning.controller.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/admin-provisioning.controller.ts>)
- [apps/api/src/modules/admin-provisioning/admin-provisioning.module.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/admin-provisioning.module.ts>)
- [apps/api/src/modules/admin-provisioning/admin-provisioning.service.spec.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/admin-provisioning.service.spec.ts>)
- [apps/api/src/modules/admin-provisioning/admin-provisioning.service.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/admin-provisioning.service.ts>)
- [apps/api/src/modules/admin-provisioning/identity-delivery.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/identity-delivery.ts>)
- [apps/api/src/modules/admin-provisioning/invitation-delivery.worker.spec.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/invitation-delivery.worker.spec.ts>)
- [apps/api/src/modules/admin-provisioning/invitation-delivery.worker.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/invitation-delivery.worker.ts>)
- [apps/api/src/modules/admin-provisioning/platform-admin.service.spec.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/platform-admin.service.spec.ts>)
- [apps/api/src/modules/admin-provisioning/platform-admin.service.ts](<C:/Projects/OPA/apps/api/src/modules/admin-provisioning/platform-admin.service.ts>)
- [apps/api/src/modules/auth/activation.service.spec.ts](<C:/Projects/OPA/apps/api/src/modules/auth/activation.service.spec.ts>)
- [apps/api/src/modules/auth/activation.service.ts](<C:/Projects/OPA/apps/api/src/modules/auth/activation.service.ts>)
- [apps/api/src/modules/auth/enrollment.service.ts](<C:/Projects/OPA/apps/api/src/modules/auth/enrollment.service.ts>)
- [apps/api/test/int/enrollment.int-spec.ts](<C:/Projects/OPA/apps/api/test/int/enrollment.int-spec.ts>)
- [apps/api/test/int/super-admin.int-spec.ts](<C:/Projects/OPA/apps/api/test/int/super-admin.int-spec.ts>)
- [apps/api/test/int/tenant-isolation.int-spec.ts](<C:/Projects/OPA/apps/api/test/int/tenant-isolation.int-spec.ts>)
- [apps/website/src/app/(console)/enroll/page.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/enroll/page.tsx>)
- [apps/website/src/app/(console)/super-admin/(protected)/error.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/(protected)/error.tsx>)
- [apps/website/src/app/(console)/super-admin/(protected)/facilities/new/page.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/(protected)/facilities/new/page.tsx>)
- [apps/website/src/app/(console)/super-admin/(protected)/layout.spec.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/(protected)/layout.spec.tsx>)
- [apps/website/src/app/(console)/super-admin/(protected)/layout.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/(protected)/layout.tsx>)
- [apps/website/src/app/(console)/super-admin/(protected)/loading.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/(protected)/loading.tsx>)
- [apps/website/src/app/(console)/super-admin/(protected)/page.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/(protected)/page.tsx>)
- [apps/website/src/app/(console)/super-admin/layout.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/layout.tsx>)
- [apps/website/src/app/(console)/super-admin/login/login-form.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/login/login-form.tsx>)
- [apps/website/src/app/(console)/super-admin/login/page.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/login/page.tsx>)
- [apps/website/src/app/(console)/super-admin/sign-out.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/sign-out.tsx>)
- [apps/website/src/app/(console)/super-admin/super-admin.css](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/super-admin.css>)
- [apps/website/src/app/(console)/super-admin/workspace.spec.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/workspace.spec.tsx>)
- [apps/website/src/app/(console)/super-admin/workspace.tsx](<C:/Projects/OPA/apps/website/src/app/(console)/super-admin/workspace.tsx>)
- [apps/website/src/app/api/enroll/route.ts](<C:/Projects/OPA/apps/website/src/app/api/enroll/route.ts>)
- [apps/website/src/app/api/super-admin/[...action]/route.spec.ts](<C:/Projects/OPA/apps/website/src/app/api/super-admin/[...action]/route.spec.ts>)
- [apps/website/src/app/api/super-admin/[...action]/route.ts](<C:/Projects/OPA/apps/website/src/app/api/super-admin/[...action]/route.ts>)
- [apps/website/src/lib/super-admin-api.ts](<C:/Projects/OPA/apps/website/src/lib/super-admin-api.ts>)
- [apps/website/src/lib/super-admin-fetch.spec.ts](<C:/Projects/OPA/apps/website/src/lib/super-admin-fetch.spec.ts>)
- [apps/website/src/lib/super-admin-fetch.ts](<C:/Projects/OPA/apps/website/src/lib/super-admin-fetch.ts>)
- [apps/website/src/lib/super-admin-session.spec.ts](<C:/Projects/OPA/apps/website/src/lib/super-admin-session.spec.ts>)
- [apps/website/src/lib/super-admin-session.ts](<C:/Projects/OPA/apps/website/src/lib/super-admin-session.ts>)
- [docs/SUPER_ADMIN_CONTRACT.md](<C:/Projects/OPA/docs/SUPER_ADMIN_CONTRACT.md>)
- [docs/SUPER_ADMIN_INTEGRATION_REPORT.md](<C:/Projects/OPA/docs/SUPER_ADMIN_INTEGRATION_REPORT.md>)
