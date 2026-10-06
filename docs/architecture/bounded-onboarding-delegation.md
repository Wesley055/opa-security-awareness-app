# Bounded customer-service onboarding delegation

Implemented in C:\Projects\OPA-delegation on feature/bounded-support-delegation.
Base and HEAD remain a906e3e8ac2cfb90ce24bb237598dca0f4338b1c. Changes are uncommitted; nothing was pushed or deployed.

## 1. Architecture

OnboardingAuthorityGrant is a separate durable, facility-scoped STAFF_ONBOARDING capability. It has no relationship to protected-identity permissions and introduces no global role. An active ADMIN approves an active existing non-ADMIN user for an existing active facility, with an explicit future expiration. The employee's role and facility membership are not changed. Self-grants and duplicate active assignments are rejected; an expired or revoked grant can be replaced by a new historical record.

The existing /admin controller and AdminGuard are unchanged. A separate ADMIN-guarded controller manages delegation. The narrow /onboarding controller uses JWT authentication and database authorization inside each service transaction. Privileged staff operations reread the current actor, active facility and an unrevoked, unexpired grant; ADMIN needs no grant. Actor/facility/grant locks serialize privileged work against offboarding and deactivation. Expiration for privileged operations is checked using PostgreSQL clock_timestamp(). No JWT grant claims authorize an operation.

EnrollmentService remains the only invitation/enrollment implementation. Its idempotency, dual proofs, activation, delivery outbox and existing-account checks remain in use. The existing worker now revalidates scoped staff authority before preparing delivery. Status/resend/revoke reuse PlatformAdminService, with an internal staff-only mode. The default platform path remains ADMIN-only. Resident and accepted-membership operations have no delegated route. Support self-invitation and pending self-acceptance are explicitly rejected.

The UI adds /super-admin/onboarding and the separate /onboarding and /onboarding/login workspace. Support uses separate HttpOnly, SameSite=Strict cookies (Secure in production), strict upstream path allowlists, origin checks for writes, no-store responses, and projected metadata. Employee selection uses existing user UUIDs; operators must verify the reference against their employee records. No protected-identity search was added.

## 2. Exact files changed

- apps/api/prisma/migrations/20260922230000_bounded_onboarding_authority/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/src/modules/admin-provisioning/admin-provisioning.module.ts
- apps/api/src/modules/admin-provisioning/identity-delivery.ts
- apps/api/src/modules/admin-provisioning/platform-admin.service.spec.ts
- apps/api/src/modules/admin-provisioning/platform-admin.service.ts
- apps/api/src/modules/auth/enrollment.service.ts
- apps/api/src/modules/onboarding/onboarding-authority.spec.ts
- apps/api/src/modules/onboarding/onboarding-authority.ts
- apps/api/src/modules/onboarding/onboarding.controller.ts
- apps/api/src/modules/onboarding/onboarding.service.ts
- apps/api/test/int/assert-schema.ts
- apps/api/test/int/onboarding-delegation.int-spec.ts
- apps/website/src/app/(console)/onboarding/layout.tsx
- apps/website/src/app/(console)/onboarding/login/page.tsx
- apps/website/src/app/(console)/onboarding/page.tsx
- apps/website/src/app/(console)/onboarding/workspace.spec.tsx
- apps/website/src/app/(console)/onboarding/workspace.tsx
- apps/website/src/app/(console)/super-admin/(protected)/layout.tsx
- apps/website/src/app/(console)/super-admin/(protected)/onboarding/page.tsx
- apps/website/src/app/(console)/super-admin/(protected)/onboarding/workspace.tsx
- apps/website/src/app/api/onboarding-admin/[...action]/route.ts
- apps/website/src/app/api/onboarding/[...action]/route.ts
- apps/website/src/app/api/super-admin/[...action]/route.ts
- apps/website/src/lib/onboarding-fetch.ts
- apps/website/src/lib/onboarding-http.spec.ts
- apps/website/src/lib/onboarding-proxy.spec.ts
- apps/website/src/lib/onboarding-proxy.ts
- apps/website/src/lib/onboarding-session.ts
- docs/architecture/bounded-onboarding-delegation.md

Ignored local validation artifacts are node_modules, build outputs and apps/api/.env.test.local. They are not part of the change set.

## 3. Migration

20260922230000_bounded_onboarding_authority adds the OnboardingPermission enum and OnboardingAuthorityGrant table. Fields: UUID id, actorUserId, facilityId, permission, approvedByUserId, expiresAt, nullable revokedAt, createdAt. Foreign keys use RESTRICT on deletion. Checks require expiration after creation, revocation at/after creation and different actor/approver IDs. Indexes support actor/facility/permission/revocation/expiry authorization and facility/approver references.

The migration changes no existing records and removes no columns, tables or permissions. Migration-backed tests replayed all 36 migrations in a disposable PostgreSQL 16.14 database. Schema assertions check the grant constraints and scope index as well as the existing production migration assertions.

## 4. API endpoints added

| Method | Endpoint | Boundary |
| --- | --- | --- |
| GET | /admin/onboarding/employees | Active ADMIN |
| GET | /admin/onboarding/employees/:employeeId/grants | Active ADMIN |
| POST | /admin/onboarding/employees/:employeeId/grants | Active ADMIN |
| POST | /admin/onboarding/employees/:employeeId/grants/:id/revoke | Active ADMIN |
| POST | /admin/onboarding/employees/:employeeId/revoke-all | Active ADMIN |
| GET | /onboarding/facilities | Only currently authorized active facilities; ADMIN superset |
| POST | /onboarding/operators | Current facility authority |
| POST | /onboarding/facility-admins | Current facility authority |
| GET | /onboarding/facilities/:facilityId/invitations | Current facility authority; staff only |
| POST | /onboarding/facilities/:facilityId/invitations/:id/resend | Current facility authority; eligible staff only |
| POST | /onboarding/facilities/:facilityId/invitations/:id/revoke | Current facility authority; eligible staff only |

Website adapters: /api/onboarding-admin/[...action] and /api/onboarding/[...action]. Only the latter exposes its own login/refresh/logout actions. Pagination is bounded to 50 records with UUID cursors. No arbitrary upstream proxy was added.

## 5. Authorization matrix

| Operation | Active ADMIN | Active delegated employee | Missing/expired/revoked grant |
| --- | --- | --- | --- |
| Grant/revoke/revoke-all authority | Yes | No | No |
| Platform facility directory/create | Existing ADMIN behavior | No authority from delegation | No |
| Authorized-facility list | Active facilities | Explicit active grants only | Empty list |
| Invite Facility Admin/Operator | Directly, without grant | Granted active facility only | Denied |
| Staff status/resend/revoke | Directly, without grant | Granted facility and eligible pending invitation only for mutations | Denied |
| Resident provisioning | Existing ADMIN behavior | No authority from delegation | No |
| Accepted membership lifecycle | Existing ADMIN behavior | No authority from delegation | No |
| Incidents/evidence/SafeWalk/PII/SSO/Insight/reports | Existing independent boundaries | No authority from delegation | No |
| Employee self-provisioning | Existing platform rules | Denied for own identity and pending self-acceptance | Denied |

An inactive/pending employee, inactive facility or wrong facility fails closed. Grants confer no facility ownership. Existing account permissions outside this capability are neither removed nor expanded.

## 6. Audit and offboarding

AdministrativeAuditEvent records ONBOARDING_AUTHORITY_GRANTED, ONBOARDING_AUTHORITY_REVOKED and ONBOARDING_AUTHORITY_REVOKED_ALL. Grant lifecycle records include the acting ADMIN, employee/facility/grant references, original approving ADMIN, reason and applicable before/after state.

ENROLLMENT_REQUESTED, INVITATION_RESENT and INVITATION_REVOKED record the actual actor role, DELEGATED_ONBOARDING or PLATFORM_ADMIN authority, grant ID and approving ADMIN where applicable. ENROLLMENT_ACCEPTED continues to identify the accepting customer. Supplied invitation names/contact details, encrypted identity values, tokens and provider recipients are not copied into administrative audit metadata. The UI uses fixed operational reasons.

Revoke-all atomically marks every unrevoked grant for the employee revoked (including expired historical grants) and writes individual plus summary audits. It changes no facilities, accounts, accepted memberships or invitation records. Queued proofs become ineligible in the existing worker, and pending acceptance fails while the original inviter lacks authority. A current ADMIN or another delegated employee can issue a new invitation immediately. Existing accepted customer access remains intact.

## 7. Tests

- API unit: 65 passed across 9 suites (onboarding authority, enrollment, provisioning, invitation delivery, platform administration, AdminGuard and facility guard regressions).
- PostgreSQL full regression run after self-invitation protection: 97 passed across 4 suites (delegation, Super Admin, enrollment, tenant isolation).
- Additional final PostgreSQL regression: historical self-invitation acceptance after both proofs passed (1 test; the other 35 delegation tests were excluded by the targeted filter and passed in the preceding full run). This gives 98 distinct passing PostgreSQL tests and 199 distinct passing tests overall.
- Website: 36 passed across 7 suites (support workspace, proxy allowlist/projection/origin/session boundaries, existing Super Admin behavior).

Coverage includes the requested 21 security categories, plus duplicate grants, database constraints, concurrent offboarding, self-provisioning, delegated dual-proof activation and cancellation of queued delivery after revocation. Existing denial assertions were retained; the existing tenant-admin fixture now returns an empty grant lookup result. Initial implementation/test failures were corrected rather than accepted as baseline failures.

Tests used only the disposable local opa_delegation_test database on 127.0.0.1:55439, container opa-delegation-test-20260922. Delivery providers were stubs; no real customer messages or production data were used.

## 8. Lint, typecheck and builds

Changed API and website scopes pass ESLint with --max-warnings=0. API and website pass tsc --noEmit and production builds. git diff --check passes. The website build retains the repository's existing Next.js middleware-convention deprecation warning; no middleware/SSO/public-site redesign was included. No broad baseline test failure was observed.

## 9. Physical acceptance still required

Exercise the real authenticated Admin/support UI on desktop and narrow screens; verify employee reference selection, expiration display, pagination, session restoration and offboarding. Use two non-production facilities to confirm scope isolation with actual employee accounts. Verify actual email/SMS receipt and dual-proof enrollment with configured providers. Repeat revoke-one/revoke-all during pending delivery/acceptance and verify accepted customers remain unaffected. Review the additive migration through the normal release process before production application.

No real-provider or deployed end-to-end acceptance is claimed. Demo/test-data reconciliation remains a separate gate and was not performed.

## 10. Candidate status

This branch is a candidate for review and acceptance testing. Production promotion remains gated on the physical acceptance above and normal release approval. It is not deployed or production-approved. The dirty C:\Projects\OPA worktree was not touched; no commit, push, reset or production-data operation was performed.


## 10. Browser authority hardening

The preserved browser DOM established that Facility B was rendered and selected. Its historical facility response and authenticated actor were not retained; current diagnostic requests returned 401. This does not establish a server-side cross-facility authorization success. The original rendering cause and reason for that particular 401 cannot be reconstructed from these observations alone.

The previous workspace fetched facilities once and retained them after 401/403, focus restoration and actor changes. Regression tests reproduce that client defect. The hardened workspace clears scope on authentication/authorization failure, page/focus/visibility restoration and explicit session changes. It revalidates every five seconds while visible, applies a ten-second deadline to enumeration so a hung request fails closed, discards superseded responses, identifies the current account reference/role and resets selection when actor or authorized facility IDs change. Remote grant changes are reflected on the next successful poll (network latency applies), not by an instantaneous server push. Every privileged API operation still checks current database authority immediately, independently of rendered state.

Facility enumeration includes the database actor reference and role. Privileged website requests carry that displayed context; the proxy compares it against current context using the same captured onboarding access token before forwarding. This is an additional stale-context denial, never a grant of authority. Direct API calls retain their existing database checks. ADMIN remains grant-free and both session-cookie namespaces remain separate. A failed onboarding actor login clears the previous onboarding session. Support 401 responses require explicit session restoration instead of silently retaining the workspace through an automatic refresh.

Employee dropdown selection and manual-reference selection are alternative forms. Duration presets calculate absolute future expiry; the review screen requires a separate approval. Recipient eligibility, expiry, revocation, inactive facilities and self-escalation remain server-enforced. Phone inputs normalize with Nigeria as the default region and explicit international numbers accepted; malformed Nigerian international trunk prefixes and invalid lengths are rejected. Identifier-conflict messaging does not reveal which identifier exists. Enrollment links prefill the request reference only; both proofs and existing account checks remain mandatory. Configure the existing OPA_WEB_URL for delivered links. No provider dashboard is part of normal successful delivery.

### Repeatable acceptance

Use the integration harness only with its disposable database ending in _test. It truncates test tables. Set OPA_ONBOARDING_BROWSER=1 and run the onboarding-delegation integration suite to additionally launch a new headless Edge context and an isolated Next server on a temporary loopback port. The harness uses real password login, real proxies, PostgreSQL grants and runtime-generated synthetic credentials. It starts no external delivery worker, prints no session credentials and closes only its own browser/server. Website dependencies and Edge are prerequisites.

For a human retest in a separate clean browser profile and nonproduction deployment:

1. ADMIN selects the active non-ADMIN Support account from the employee dropdown, chooses Facility A, a duration and controlled reason, reviews, then grants. Do not fill the manual-reference alternative.
2. Support signs into the onboarding workspace. Confirm the displayed account reference/USER context and capture GET /api/onboarding/facilities: A only, no B.
3. Select A; load invitation status and create a synthetic staff invitation. Complete enrollment using the delivered link and separate proofs if checking delivery. Never reuse another account's identifiers.
4. Attempt B invitation status through both the bounded website proxy (with the displayed actor context) and directly through the API using the existing test session. Require 403. A proxy context denial alone is not evidence of backend tenant enforcement.
5. ADMIN revokes A without ending the Support session. Immediately retry the API operation: require 403. Confirm A and its form disappear on revalidation and that focus restoration cannot restore stale state. Expect up to the five-second polling interval plus response latency for a remote change with no local event.
6. In another tab of the same clean profile, change the onboarding actor between ADMIN and Support. Restore workspace focus; require fresh actor context and no ADMIN-era B selection. Old-context requests must fail.
7. Verify ADMIN can use the workspace without any ADMIN delegation grant. Inspect administrative audits for actual Support actor/USER role, Facility A, grant/approver, permission, reason, expiry and ADMIN revocation provenance. Confirm no protected identifiers or proof values appear in audit metadata.
8. Repeat expiry, revoke-all and inactive-recipient cases. Delete only the disposable test environment when finished; retain sanitized acceptance evidence.


### Hardening verification record

On the isolated hardening checkout based on e6c04b6: 78 API unit tests (11 suites), 71 affected website tests (14 suites), and 102 PostgreSQL tests (4 suites, including the opt-in clean-browser test) passed. Both typechecks, both scoped lint checks and both production builds passed; the website used Next's webpack production build. The 36 existing migrations and their schema/index assertions were validated; no migration or schema changes were made.

The clean browser used localhost with a separate temporary port/profile. Support enumeration contained only its Facility A; A returned 200; B returned 403 through both proxy and API. Revoking A left the same token denied with 403 and removed the rendered facility/form. ADMIN was grant-free, an ADMIN-to-Support switch cleared the previous selection, and audit actor/grant/facility/approval/revocation assertions passed. No external delivery provider was invoked. The original acceptance database and browser tab were not used for this run.

The website build also required moving an existing projection helper out of the Super Admin route's unsupported named export into a library module. The moved allowlist/projection is text-identical and its tests remain intact.
