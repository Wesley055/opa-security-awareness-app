# Production tenant isolation and verification-first enrollment

Worktree: `C:/Projects/OPA-tenant-isolation`; branch `codex/tenant-isolation`; base HEAD `6d9ec20`.

SAFE FOR INSTITUTIONAL E2E: YES. SAFE TO MERGE: YES for this reviewed and validated code change. This is not deployment authorization; coordinated client/configuration cutover is required before any release.

## Current tenant model and permanent boundary

Facility remains the tenant. User.facilityId is the current single-facility assignment; Incident.facilityId is the historical routing snapshot. There is no new organization, membership, identity or delivery system. Facility types remain organization-neutral. Existing USER, RESPONDER, FACILITY_ADMIN and FACILITY_OPERATOR semantics are preserved. HOSPITAL_STAFF was already replaced by FACILITY_OPERATOR in the pre-existing 20260811220000 migration.

JwtStrategy reloads role, isActive, accountStatus and credentialVersion from PostgreSQL. Tenant guards derive the facility from the current database account, never request body or a claimed tenant identifier. Removed/suspended operators cannot retain access through stale JWTs. IncidentAccessGuard combines the requested ID with centralized incidentScope before disclosure; missing and foreign incidents both return 404. Evidence/timeline/detail inherit this guard. Queue filtering and pagination preserve facility predicates. Owner-only incident mutations and capability-based public tracking retain their existing independent authorization.

Invitation user lookup, history, in-flight checks and resend cooldown share the authorized facility predicate. Membership changes cancel only stale QUEUED invitations transactionally; SENDING outcomes are retained, and same-facility assignment preserves queued work. Facility creation and assignment/removal persist actor/action/resource/previous/current facility in AdministrativeAuditEvent. Invitation reads and membership mutation use the existing user advisory-lock convention. The legacy delivery worker rechecks current user/facility eligibility when claiming; it does not acquire that user advisory lock. This corrects the earlier evidence document's inaccurate claim that it did.

## Account oracle before and after

Before: public registration and tenant provisioning looked up global email/phone uniqueness and returned identifier-specific conflicts. Successful requests immediately created User rows, sessions or roster-visible membership. Bulk success/failure counts exposed the same distinction. Missing/ineligible login accounts skipped bcrypt; eligible password-reset requests awaited token writes and provider work.

After: public and tenant intake normalize submitted data, encrypt it, persist an EnrollmentRequest and two delivery intents, and return only an opaque receipt. They perform no lookup of submitted identifiers in User, and do not create accounts or memberships. Bulk returns one receipt per accepted input, without account-dependent queued/failed counts. Invalid input and authorization failures remain explicit and depend on the request, not global identity state. Pending requests never enter member rosters. Provider results and proof progress are not exposed in tenant status.

Global User email and phone uniqueness is unchanged and remains database-enforced. Both-identifier proof is required before any global identity resolution. Even after proof, conflicting/split identities are not merged, reset or transferred.

## Enrollment model and contracts

EnrollmentRequest stores an opaque UUID, intended facility, inviter snapshot, AES-256-GCM protected normalized identity, scoped HMAC idempotency digest, independent SHA-256 proof hashes, attempt count, expiry, verified/accepted timestamps and accepted-user provenance. Facility/inviter and accepted-user IDs are durable snapshots; authorization is revalidated transactionally. Existing account uniqueness remains on User, not on pending requests.

| Endpoint | Old contract | Permanent contract |
| --- | --- | --- |
| POST /auth/register | 201 immediate user/session, or global email/phone conflict | 202 `{requestId,status:"VERIFICATION_PENDING"}`; no session or user |
| POST /facility-admin/facility/residents | 201 pending User, membership and delivery details | Same generic 202 receipt; facility comes from guard |
| POST /facility-admin/facility/residents/bulk | Per-row user/delivery or conflict; queued/failed totals | 202 `{requests:[{index,requestId,status:"VERIFICATION_PENDING"}]}` |
| GET /facility-admin/facility/residents/enrollments | Absent | Authorized tenant's latest 100 request IDs, timestamps and PENDING/ACCEPTED/EXPIRED state; no identifiers, account IDs, proof state, delivery state or eligibility |
| POST /auth/enrollment/verify | Absent | Both request-bound codes, password and explicit acceptance; invalid/expired/replayed proof is generic 400. Verified new account: ACCEPTED plus standard session projection. Existing identity: AUTHENTICATION_REQUIRED plus owner-only acceptance credential, no session |
| POST /auth/enrollment/accept | Absent | Signed JWT plus request ID/acceptance credential; rechecks current account, both identifiers and inviter/facility. Adds only null-or-same-facility membership; never transfers between tenants |
| POST /auth/password-reset/request | Generic text but conditional synchronous lookup/send | Same generic meaning with future-tense delivery wording; encrypted durable outbox write, no account lookup or provider call in the request |

An Idempotency-Key can be supplied for intake retries. It is bound to submitted data, inviter and facility. Missing keys receive a server-generated key; checked-in clients send stable keys across retries. Duplicate intake reuses the request and does not create additional delivery records. The receipt describes request acceptance, not account creation, message delivery or membership success. A replayed receipt remains generic even if the request subsequently completed.

## Ownership, delivery, expiry and completion

The existing AccountInvitationDelivery outbox/InvitationDeliveryWorker now distinguishes LEGACY_INVITATION, ENROLLMENT and PASSWORD_RESET. Database CHECK constraints enforce each purpose's required relationships. Enrollment and reset intents have no User/facility foreign key requirement and no plaintext recipient snapshot. Enrollment has one delivery per request/channel, protected by a unique index.

The worker generates independent 256-bit email and phone credentials, stores only hashes, and sends request ID, intended organization and the appropriate code through the existing EmailProvider/SmsProvider. Tenant administrators never receive raw codes. Existing retry, maximum attempts and stale-SENDING recovery remain; transport is at-least-once. Recovery/retry rotates the affected credential. Enrollment expires 24 hours after intake, and five failed proof attempts exhaust that request. A new request is needed after expiry/exhaustion; delivery or ownership status does not reveal whether an account exists.

The worker locks the enrollment request before claiming its delivery, matching completion's request-before-delivery lock order. Verified/accepted/expired/exhausted or unauthorized-inviter requests cannot mint further proofs. Stale queued requests are cancelled internally; tenant status does not expose cancellation reason. Membership/facility/inviter authority is rechecked at completion even if a message was already in flight.

Completion locks the request, then sorted email/phone advisory keys, enforces global uniqueness, consumes both proofs and creates the new ACTIVE USER and membership with audit in one transaction. Existing users must authenticate and match BOTH verified identifiers. Acceptance locks the current User row in addition to the existing advisory lock, preventing concurrent lifecycle/identifier changes from authorizing a stale account. Current inviter and facility rows are locked while rechecking authority. Same-account acceptance is idempotent without duplicate audit/membership; cross-tenant transfer is refused. No password change is made to an existing account. A lost post-verification response can be recovered by signing in if creation succeeded, or by making a new request; consumed ownership proofs cannot be replayed to obtain a new session.

## Login and password reset

AuthService precomputes a random dummy bcrypt hash at the configured cost and waits for initialization before serving requests. Every login performs bcrypt.compare, including unknown, pending, passwordless and suspended accounts; eligibility is checked before token issuance. Tests assert the credential-work path, rather than claiming constant network latency. Existing real bcrypt login success/failure tests remain.

Password-reset intake always writes encrypted asynchronous work. Only the existing worker resolves eligibility, acquires the user lock, consumes older reset credentials, creates a hashed expiring credential and invokes email delivery. Retry rotates the reset credential. Confirmation retains expiry, single consumption, credentialVersion increment and consumption of outstanding tokens. Provider availability/results cannot change the reset request response. Recipient values were removed from missing-configuration logs in the two reused providers.

## Super Admin boundary

ADMIN is already the platform-administration role in authoritative code; there is no separate ordinary-ADMIN or SUPER_ADMIN enum in this architecture:

- `apps/api/scripts/bootstrap-admin.cjs:2`: ONE-OFF PLATFORM ADMIN BOOTSTRAP; line 157 writes ADMIN. Inspected only, never executed.
- `apps/api/src/shared/guards/admin.guard.ts:32`: current database ADMIN required.
- `apps/api/src/modules/auth/jwt.strategy.ts`: current database role/lifecycle/version override stale token claims.
- `apps/api/src/shared/security/incident-scope.ts:17`: unrestricted scope only for active, ACTIVE, current ADMIN; IncidentAccessGuard still adds the requested incident ID.
- FACILITY_ADMIN is the distinct tenant-admin role; /operator is FACILITY_OPERATOR-only.

Explicit JWT + AdminGuard platform provisioning remains privileged and auditable through inviter/provenance and administrative audit records. It may retain its immediate-create contract. Tenant controllers no longer invoke those privileged immediate-create methods. No caller-selected role is accepted by public enrollment; completed public accounts are USER.

## Migration and compatibility/cutover

New migrations in this lane:

1. `20260907120000_tenant_isolation_audit`: administrative provenance and scoped invitation-history index.
2. `20260909120000_verification_first_enrollment`: additive EnrollmentRequest, purpose-aware optional outbox references, relationship CHECK constraints and request/channel uniqueness.

No User/global-identity uniqueness constraint is removed. Existing data is not converted, deleted, merged or marked dual-verified. Existing pending User accounts, activation credentials and queued invitations remain LEGACY_INVITATION by default and retain the existing activation/resend path. They remain explicitly distinguishable as PENDING_ACTIVATION; they are not new EnrollmentRequest rows and are not represented as having completed both proofs. Existing active users and operator/admin seats retain access. Platform privileged provisioning retains its separate contract.

ENROLLMENT_ENCRYPTION_KEY is a required 64-hex-character, 256-bit secret, validated at startup. Provision it through the existing secret/configuration management before a future release; no production value was generated or installed here. Keep it durable and backed up: it encrypts pending requests and keys their idempotency digests. Do not replace it without an explicit authenticated re-encryption/key-rotation migration for retained requests. It must not be a JWT/provider secret. No plaintext submitted identities appear in new outbox rows.

This is intentionally a breaking enrollment contract. Deploying the API and clients requires coordinated release. Older installed clients expecting registration tokens cannot complete the new registration flow; the API must not restore immediate creation for them. Checked-in mobile registration, enrollment/activation entry and auth store are updated. The mobile owner-only acceptance credential stays in screen memory, is not placed in navigation parameters or admin UI, and the existing account session is persisted only after acceptance. Website server adapters, same-origin routes and tenant UI consume pending receipts, preserve retry keys, and separate requests from roster. Obsolete immediate-create responses are rejected by the new website adapter. Legacy activation remains accessible for issued codes. No package, lockfile, release version, SOS/voice, SafeWalk or unrelated worktree changes are involved.

## Validation environment and evidence

All PostgreSQL integration runs use OPA's existing `jest-int.config.ts` and `.env.test.local` harness, dedicated LOCAL Docker PostgreSQL 16.14 database `opa_tenant_isolation_docker_test` at localhost:5432. The harness runs `prisma migrate deploy`, verifies the actual database name, all 22 migrations and existing partial-index semantics, and truncates only this dedicated test database between tests. No parallel database infrastructure was created for enrollment. No production/staging/Azure database or real user data was touched.

Tests use real Nest controllers/guards, Passport JWT verification, signed JWTs, real services and PostgreSQL transactions. Email/SMS transport is stubbed; no external messages are sent. The tenant evidence transport stub persists local evidence records so cross-tenant denial can be checked before mutation. Authentication/tenant guards are not weakened or replaced.

Covered: both tenant directions; foreign/missing IDs; mutation denial; stale/forged role/facility claims; roster/queue filtering; invitation history/resend/cooldown; queued versus SENDING cancellation; audit rollback; uniform public/tenant email/phone conflicts; bulk receipts; no preverification User reads/writes; both proofs; wrong/expired/exhausted/replayed credentials; concurrent duplicate intake/completion and email/phone uniqueness races; existing authenticated null/same-facility acceptance; cross-tenant transfer refusal; changed inviter/facility authority; worker failure/retry/recovery; encrypted reset intake and single-use reset confirmation; mobile session timing; website receipt and roster behavior.

Transient failures are retained in local ignored logs: one new-test TypeScript diagnostic was corrected; an older mobile test needed an explicit API-config mock after the new import; one parallel PostgreSQL run had two setup failures because localhost:5432 was briefly unreachable (46 passed/2 failed); one parallel Vitest run could not start its UI worker (22 tests passed, one worker error). Assertions and timeouts were not weakened. Sequential reruns are the final gate.

## Final validation results and exact commands

Final checks completed on this uncommitted branch. No failed or skipped tests remain in the final runs.

| Run | Suites passed | Suites failed | Tests passed | Tests failed | Skipped |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full API unit | 72 | 0 | 602 | 0 | 0 |
| Focused security (subset) | 31 | 0 | 210 | 0 | 0 |
| PostgreSQL integration | 3 | 0 | 49 | 0 | 0 |
| Mobile impacted | 2 | 0 | 6 | 0 | 0 |
| Website impacted | 6 | 0 | 26 | 0 | 0 |

Integration breakdown: enrollment 26/26, tenant isolation 17/17, existing invitation worker 6/6. These are real PostgreSQL/Nest/JWT tests, with external transport stubbed.

- Prisma generate: exit 0, Client 6.19.3.
- Prisma validate: exit 0, schema valid.
- Existing local migration harness: exit 0; all 22 migrations applied; current schema up to date and partial-index semantics verified. Both new branch migrations applied only to the dedicated local test database.
- API TypeScript and Nest build: exit 0 each.
- Mobile TypeScript: exit 0.
- Website TypeScript and Next.js build: exit 0 each.
- Targeted API and website ESLint: exit 0; zero warnings under --max-warnings=0. Mobile has no configured lint script; its impacted tests and TypeScript ran.
- git diff --check: exit 0, no output.
- Nonblocking existing tool notices: Next middleware-to-proxy deprecation and Vite's future configuration-loader warning. Unrelated framework configuration was not changed.

Exact final API process commands (working directory C:/Projects/OPA-tenant-isolation/apps/api):

```text
node ../../node_modules/eslint/bin/eslint.js src/modules/auth src/modules/admin-provisioning/identity-delivery.ts src/modules/admin-provisioning/invitation-delivery.worker.ts src/modules/notifications/providers/email.provider.ts src/modules/notifications/providers/sms.provider.ts src/shared/security/enrollment-identity.ts src/shared/security/enrollment-identity.spec.ts test/int/enrollment.int-spec.ts --max-warnings=0  # exit 0
node ../../node_modules/jest/bin/jest.js --runInBand '--testPathPattern=shared/guards|shared/security|modules/facilities|modules/admin-provisioning|modules/auth|modules/refresh-token|modules/evidence|modules/incidents' --json --outputFile=../../node_modules/.tenant-evidence/enrollment-security-verified.json  # exit 0
node ../../node_modules/jest/bin/jest.js --config jest-int.config.ts --runInBand --runTestsByPath test/int/enrollment.int-spec.ts test/int/tenant-isolation.int-spec.ts test/int/invitation-delivery-worker.int-spec.ts --json --outputFile=../../node_modules/.tenant-evidence/enrollment-integration-verified.json  # exit 0
node ../../node_modules/jest/bin/jest.js --runInBand --json --outputFile=../../node_modules/.tenant-evidence/enrollment-full-unit-verified.json  # exit 0
node ../../node_modules/typescript/bin/tsc --noEmit  # exit 0
node ../../node_modules/@nestjs/cli/bin/nest.js build  # exit 0
```

Exact final mobile commands (working directory C:/Projects/OPA-tenant-isolation/apps/mobile-app):

```text
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/store/authStore.spec.ts src/store/authStore.enrollment.spec.ts  # exit 0
node node_modules/typescript/bin/tsc --noEmit  # exit 0
```

Exact final website commands (working directory C:/Projects/OPA-tenant-isolation/apps/website):

```text
node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/lib/facility-admin-residents.spec.ts src/app/api/operator/residents 'src/app/(console)/operator/(protected)/residents/resident-management.spec.tsx'
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/lib/facility-admin-residents.ts src/app/api/operator/residents 'src/app/(console)/operator/(protected)/residents/resident-management.tsx' --max-warnings=0
node node_modules/next/dist/bin/next build
```

Exact Prisma child-process commands (apps/api), launched through a Node spawnSync wrapper that loads .env.test.local without printing it and refuses any host except localhost/127.0.0.1 or any database except opa_tenant_isolation_docker_test:

```text
node ../../node_modules/prisma/build/index.js generate
node ../../node_modules/prisma/build/index.js validate
node ../../node_modules/prisma/build/index.js migrate status
```

The integration globalSetup executes its existing npx prisma migrate deploy command using the dedicated test URL. Locked mobile and website dependencies were installed with npm.cmd ci --no-audit --no-fund. No dependency manifest or lockfile changed.

Final read-only repository checks (worktree root): git branch --show-current; git rev-parse --short HEAD; git status --short --untracked-files=all; git diff --stat; git diff --check. Branch remains codex/tenant-isolation, HEAD 6d9ec20.

Raw final API command/exit metadata: node_modules/.tenant-evidence/enrollment-api-gate.json. Raw API Jest results: enrollment-full-unit-verified.json, enrollment-security-verified.json and enrollment-integration-verified.json in that same ignored directory. Mobile command/exit metadata: enrollment-mobile-gate.json. Logs are retained as enrollment-api-*-verified.log, enrollment-mobile-*-verified.log, enrollment-website-*-final.log and enrollment-prisma-*.log at the worktree root. Earlier failed-run logs remain separately identified; none were relabelled PASS.

The test-count change from the earlier 596 unit tests is intentional: obsolete immediate-registration and synchronous-reset assertions were replaced by receipt/no-identity-work tests and real PostgreSQL completion/reset tests; credential-work and encryption regressions were added. Final full unit count is 602. No tests were skipped or guards replaced to obtain a pass.


## Exact changed files

56 files in the complete tenant-isolation/enrollment lane (38 tracked modifications and 18 new files):

- [apps/api/prisma/migrations/20260907120000_tenant_isolation_audit/migration.sql](<C:/Projects/OPA-tenant-isolation/apps/api/prisma/migrations/20260907120000_tenant_isolation_audit/migration.sql>)
- [apps/api/prisma/migrations/20260909120000_verification_first_enrollment/migration.sql](<C:/Projects/OPA-tenant-isolation/apps/api/prisma/migrations/20260909120000_verification_first_enrollment/migration.sql>)
- [apps/api/prisma/schema.prisma](<C:/Projects/OPA-tenant-isolation/apps/api/prisma/schema.prisma>)
- [apps/api/src/modules/admin-provisioning/admin-provisioning.controller.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/admin-provisioning/admin-provisioning.controller.ts>)
- [apps/api/src/modules/admin-provisioning/admin-provisioning.invitation.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/admin-provisioning/admin-provisioning.invitation.spec.ts>)
- [apps/api/src/modules/admin-provisioning/admin-provisioning.service.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/admin-provisioning/admin-provisioning.service.spec.ts>)
- [apps/api/src/modules/admin-provisioning/admin-provisioning.service.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/admin-provisioning/admin-provisioning.service.ts>)
- [apps/api/src/modules/admin-provisioning/identity-delivery.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/admin-provisioning/identity-delivery.ts>)
- [apps/api/src/modules/admin-provisioning/invitation-delivery.worker.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/admin-provisioning/invitation-delivery.worker.spec.ts>)
- [apps/api/src/modules/admin-provisioning/invitation-delivery.worker.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/admin-provisioning/invitation-delivery.worker.ts>)
- [apps/api/src/modules/auth/auth.controller.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/auth.controller.ts>)
- [apps/api/src/modules/auth/auth.module.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/auth.module.ts>)
- [apps/api/src/modules/auth/auth.service.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/auth.service.spec.ts>)
- [apps/api/src/modules/auth/auth.service.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/auth.service.ts>)
- [apps/api/src/modules/auth/auth.timing.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/auth.timing.spec.ts>)
- [apps/api/src/modules/auth/dto/register.dto.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/dto/register.dto.ts>)
- [apps/api/src/modules/auth/dto/verify-enrollment.dto.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/dto/verify-enrollment.dto.ts>)
- [apps/api/src/modules/auth/enrollment.module.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/enrollment.module.ts>)
- [apps/api/src/modules/auth/enrollment.service.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/enrollment.service.spec.ts>)
- [apps/api/src/modules/auth/enrollment.service.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/enrollment.service.ts>)
- [apps/api/src/modules/auth/password-reset.service.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/password-reset.service.spec.ts>)
- [apps/api/src/modules/auth/password-reset.service.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/auth/password-reset.service.ts>)
- [apps/api/src/modules/facilities/facilities.module.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/facilities/facilities.module.ts>)
- [apps/api/src/modules/facilities/facility-admin-resident-provisioning.controller.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/facilities/facility-admin-resident-provisioning.controller.spec.ts>)
- [apps/api/src/modules/facilities/facility-admin-resident-provisioning.controller.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/facilities/facility-admin-resident-provisioning.controller.ts>)
- [apps/api/src/modules/facilities/guards/operator-facility.guard.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/facilities/guards/operator-facility.guard.spec.ts>)
- [apps/api/src/modules/facilities/guards/operator-facility.guard.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/facilities/guards/operator-facility.guard.ts>)
- [apps/api/src/modules/notifications/providers/email.provider.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/notifications/providers/email.provider.ts>)
- [apps/api/src/modules/notifications/providers/sms.provider.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/modules/notifications/providers/sms.provider.ts>)
- [apps/api/src/shared/config/env.validation.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/shared/config/env.validation.spec.ts>)
- [apps/api/src/shared/config/env.validation.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/shared/config/env.validation.ts>)
- [apps/api/src/shared/guards/incident-access.guard.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/shared/guards/incident-access.guard.spec.ts>)
- [apps/api/src/shared/guards/incident-access.guard.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/shared/guards/incident-access.guard.ts>)
- [apps/api/src/shared/security/enrollment-identity.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/shared/security/enrollment-identity.spec.ts>)
- [apps/api/src/shared/security/enrollment-identity.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/shared/security/enrollment-identity.ts>)
- [apps/api/src/shared/security/incident-scope.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/shared/security/incident-scope.spec.ts>)
- [apps/api/src/shared/security/incident-scope.ts](<C:/Projects/OPA-tenant-isolation/apps/api/src/shared/security/incident-scope.ts>)
- [apps/api/test/int/enrollment.int-spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/test/int/enrollment.int-spec.ts>)
- [apps/api/test/int/invitation-delivery-worker.int-spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/test/int/invitation-delivery-worker.int-spec.ts>)
- [apps/api/test/int/tenant-isolation.int-spec.ts](<C:/Projects/OPA-tenant-isolation/apps/api/test/int/tenant-isolation.int-spec.ts>)
- [apps/mobile-app/app/(auth)/activate.tsx](<C:/Projects/OPA-tenant-isolation/apps/mobile-app/app/(auth)/activate.tsx>)
- [apps/mobile-app/app/(auth)/enroll.tsx](<C:/Projects/OPA-tenant-isolation/apps/mobile-app/app/(auth)/enroll.tsx>)
- [apps/mobile-app/app/(auth)/register.tsx](<C:/Projects/OPA-tenant-isolation/apps/mobile-app/app/(auth)/register.tsx>)
- [apps/mobile-app/src/store/authStore.enrollment.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/mobile-app/src/store/authStore.enrollment.spec.ts>)
- [apps/mobile-app/src/store/authStore.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/mobile-app/src/store/authStore.spec.ts>)
- [apps/mobile-app/src/store/authStore.ts](<C:/Projects/OPA-tenant-isolation/apps/mobile-app/src/store/authStore.ts>)
- [apps/website/src/app/(console)/operator/(protected)/residents/resident-management.spec.tsx](<C:/Projects/OPA-tenant-isolation/apps/website/src/app/(console)/operator/(protected)/residents/resident-management.spec.tsx>)
- [apps/website/src/app/(console)/operator/(protected)/residents/resident-management.tsx](<C:/Projects/OPA-tenant-isolation/apps/website/src/app/(console)/operator/(protected)/residents/resident-management.tsx>)
- [apps/website/src/app/api/operator/residents/bulk/route.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/website/src/app/api/operator/residents/bulk/route.spec.ts>)
- [apps/website/src/app/api/operator/residents/bulk/route.ts](<C:/Projects/OPA-tenant-isolation/apps/website/src/app/api/operator/residents/bulk/route.ts>)
- [apps/website/src/app/api/operator/residents/enrollments/route.ts](<C:/Projects/OPA-tenant-isolation/apps/website/src/app/api/operator/residents/enrollments/route.ts>)
- [apps/website/src/app/api/operator/residents/route.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/website/src/app/api/operator/residents/route.spec.ts>)
- [apps/website/src/app/api/operator/residents/route.ts](<C:/Projects/OPA-tenant-isolation/apps/website/src/app/api/operator/residents/route.ts>)
- [apps/website/src/lib/facility-admin-residents.spec.ts](<C:/Projects/OPA-tenant-isolation/apps/website/src/lib/facility-admin-residents.spec.ts>)
- [apps/website/src/lib/facility-admin-residents.ts](<C:/Projects/OPA-tenant-isolation/apps/website/src/lib/facility-admin-residents.ts>)
- [docs/security/tenant-isolation-evidence.md](<C:/Projects/OPA-tenant-isolation/docs/security/tenant-isolation-evidence.md>)

Exact git status --short --untracked-files=all:

```text
 M apps/api/prisma/schema.prisma
 M apps/api/src/modules/admin-provisioning/admin-provisioning.controller.ts
 M apps/api/src/modules/admin-provisioning/admin-provisioning.invitation.spec.ts
 M apps/api/src/modules/admin-provisioning/admin-provisioning.service.spec.ts
 M apps/api/src/modules/admin-provisioning/admin-provisioning.service.ts
 M apps/api/src/modules/admin-provisioning/invitation-delivery.worker.spec.ts
 M apps/api/src/modules/admin-provisioning/invitation-delivery.worker.ts
 M apps/api/src/modules/auth/auth.controller.ts
 M apps/api/src/modules/auth/auth.module.ts
 M apps/api/src/modules/auth/auth.service.spec.ts
 M apps/api/src/modules/auth/auth.service.ts
 M apps/api/src/modules/auth/dto/register.dto.ts
 M apps/api/src/modules/auth/password-reset.service.spec.ts
 M apps/api/src/modules/auth/password-reset.service.ts
 M apps/api/src/modules/facilities/facilities.module.ts
 M apps/api/src/modules/facilities/facility-admin-resident-provisioning.controller.spec.ts
 M apps/api/src/modules/facilities/facility-admin-resident-provisioning.controller.ts
 M apps/api/src/modules/facilities/guards/operator-facility.guard.spec.ts
 M apps/api/src/modules/facilities/guards/operator-facility.guard.ts
 M apps/api/src/modules/notifications/providers/email.provider.ts
 M apps/api/src/modules/notifications/providers/sms.provider.ts
 M apps/api/src/shared/config/env.validation.spec.ts
 M apps/api/src/shared/config/env.validation.ts
 M apps/api/src/shared/guards/incident-access.guard.spec.ts
 M apps/api/src/shared/guards/incident-access.guard.ts
 M apps/api/test/int/invitation-delivery-worker.int-spec.ts
 M apps/mobile-app/app/(auth)/activate.tsx
 M apps/mobile-app/app/(auth)/register.tsx
 M apps/mobile-app/src/store/authStore.spec.ts
 M apps/mobile-app/src/store/authStore.ts
 M apps/website/src/app/(console)/operator/(protected)/residents/resident-management.spec.tsx
 M apps/website/src/app/(console)/operator/(protected)/residents/resident-management.tsx
 M apps/website/src/app/api/operator/residents/bulk/route.spec.ts
 M apps/website/src/app/api/operator/residents/bulk/route.ts
 M apps/website/src/app/api/operator/residents/route.spec.ts
 M apps/website/src/app/api/operator/residents/route.ts
 M apps/website/src/lib/facility-admin-residents.spec.ts
 M apps/website/src/lib/facility-admin-residents.ts
?? apps/api/prisma/migrations/20260907120000_tenant_isolation_audit/migration.sql
?? apps/api/prisma/migrations/20260909120000_verification_first_enrollment/migration.sql
?? apps/api/src/modules/admin-provisioning/identity-delivery.ts
?? apps/api/src/modules/auth/auth.timing.spec.ts
?? apps/api/src/modules/auth/dto/verify-enrollment.dto.ts
?? apps/api/src/modules/auth/enrollment.module.ts
?? apps/api/src/modules/auth/enrollment.service.spec.ts
?? apps/api/src/modules/auth/enrollment.service.ts
?? apps/api/src/shared/security/enrollment-identity.spec.ts
?? apps/api/src/shared/security/enrollment-identity.ts
?? apps/api/src/shared/security/incident-scope.spec.ts
?? apps/api/src/shared/security/incident-scope.ts
?? apps/api/test/int/enrollment.int-spec.ts
?? apps/api/test/int/tenant-isolation.int-spec.ts
?? apps/mobile-app/app/(auth)/enroll.tsx
?? apps/mobile-app/src/store/authStore.enrollment.spec.ts
?? apps/website/src/app/api/operator/residents/enrollments/route.ts
?? docs/security/tenant-isolation-evidence.md
```

Exact git diff --stat (tracked changes only; Git excludes the new untracked files listed above):

```text
 apps/api/prisma/schema.prisma                      |  51 ++-
 .../admin-provisioning.controller.ts               |  30 +-
 .../admin-provisioning.invitation.spec.ts          |   1 +
 .../admin-provisioning.service.spec.ts             |  57 ++--
 .../admin-provisioning.service.ts                  | 341 +++++++++++++--------
 .../invitation-delivery.worker.spec.ts             |   2 +
 .../invitation-delivery.worker.ts                  |  27 +-
 apps/api/src/modules/auth/auth.controller.ts       |  40 ++-
 apps/api/src/modules/auth/auth.module.ts           |   2 +
 apps/api/src/modules/auth/auth.service.spec.ts     |  65 +---
 apps/api/src/modules/auth/auth.service.ts          |  68 +---
 apps/api/src/modules/auth/dto/register.dto.ts      |   7 +-
 .../modules/auth/password-reset.service.spec.ts    | 123 +-------
 .../api/src/modules/auth/password-reset.service.ts |  99 +-----
 .../src/modules/facilities/facilities.module.ts    |   3 +-
 ...-admin-resident-provisioning.controller.spec.ts |   1 +
 ...ility-admin-resident-provisioning.controller.ts |  31 +-
 .../guards/operator-facility.guard.spec.ts         |  10 +-
 .../facilities/guards/operator-facility.guard.ts   |  22 +-
 .../notifications/providers/email.provider.ts      |   4 +-
 .../notifications/providers/sms.provider.ts        |   7 +-
 apps/api/src/shared/config/env.validation.spec.ts  |   1 +
 apps/api/src/shared/config/env.validation.ts       |   1 +
 .../shared/guards/incident-access.guard.spec.ts    | 207 +++----------
 .../api/src/shared/guards/incident-access.guard.ts |  88 ++----
 .../int/invitation-delivery-worker.int-spec.ts     |   2 +-
 apps/mobile-app/app/(auth)/activate.tsx            |   4 +
 apps/mobile-app/app/(auth)/register.tsx            |  42 +--
 apps/mobile-app/src/store/authStore.spec.ts        |   2 +
 apps/mobile-app/src/store/authStore.ts             |  31 +-
 .../residents/resident-management.spec.tsx         |   7 +-
 .../(protected)/residents/resident-management.tsx  |  57 ++--
 .../app/api/operator/residents/bulk/route.spec.ts  |   6 +-
 .../src/app/api/operator/residents/bulk/route.ts   |   3 +-
 .../src/app/api/operator/residents/route.spec.ts   |   6 +-
 .../src/app/api/operator/residents/route.ts        |   4 +-
 .../src/lib/facility-admin-residents.spec.ts       |  52 +---
 apps/website/src/lib/facility-admin-residents.ts   |  96 ++----
 38 files changed, 628 insertions(+), 972 deletions(-)
```

## Remaining security gaps and release decision

No known in-scope tenant/account-existence gap remains from this review, and no environmental blocker remains. Review found and fixed the acceptance lifecycle race; no remaining unintended authorization/provisioning change was identified. Global uniqueness, platform authority, existing invitation cooldown/cancellation, legacy activation and audit transaction guarantees remain.

Before a future release, provision the new encryption key and ship the checked-in client updates with the breaking API contract. Existing installed older clients require update; no insecure legacy-registration bypass is provided. Actual email/SMS delivery and native-device institutional E2E have not been performed: the code is ready for controlled institutional E2E with test accounts and configured transports. This report is not a claim of production delivery validation.

SAFE FOR INSTITUTIONAL E2E: YES.
SAFE TO MERGE: YES.

No merge, commit, deployment, production/staging database operation, unrelated worktree edit, Command Center redesign, SSO or broad PII redesign was performed. All changes remain uncommitted and unstaged.

Proposed commit message: security: enforce tenant isolation and verification-first enrollment.
