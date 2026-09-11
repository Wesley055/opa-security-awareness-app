# Controlled Command Center production reconciliation

CURRENT HEAD: cf21ec39555b9a66cc272143a385070fe53e1756 (unchanged, integration/institutional-security)

COMMAND CENTER SOURCE HEAD: 58b517270b8d7cc9aa6c850cd8ea9788dddf2ffd plus the source worktree's uncommitted production UI. No cherry-pick.

FILES INTEGRATED: See [complete file list](command-center-integrated-files.json). Selective incident UI, context invalidation, membership presentation, evidence adapter, delivery/reporting shells, responsive/accessibility improvements, reconciled browser tests, and documentation. Current Super Admin/enrollment/PII implementation retained. No API source or migration changes.

TENANT RECONCILIATION: Existing server-authoritative accepted Facility membership and live guards retained. Browser scope only invalidates presentation; it grants no access. Queue/membership derive tenant on the server. Cross-tenant reads/actions denied by current backend regression tests.

PII RECONCILIATION: Current masked institutional DTOs retained. Existing grant/purpose/case/audit reveal path retained; no platform plaintext bypass.

SUPER ADMIN RECONCILIATION: Command Center platform link targets the authoritative /super-admin workspace. Its separate existing session namespace remains; no competing admin API or authentication scheme imported.

FACILITY FLOWS: Current bounded directory, detail, creation, membership/access state and audit retained; website/API/PostgreSQL tests passed and directory/detail rendered in four viewports.

STAFF INVITATIONS: Durable verification-first operator/facility-admin invitations, idempotent receipts, status, resend/revoke and enrollment visibility retained. Pending intent stays separate from accepted membership.

RAW TOKEN EXPOSURE: No source legacy activation/provisioning endpoints imported. Current Super Admin allowlisted responses exclude activation tokens; regression tests passed. Recipients use current /enroll proof/consent flow.

INCIDENT QUEUE: Source responsive bounded queue and current guarded backend reader integrated; initial/polling errors remain distinct from confirmed empty data.

INCIDENT DETAIL: Source detail/evidence/delivery-unavailable UI integrated against current masked and guarded incident contract.

TRACKING: Existing guarded tracking, no-session/location uncertainty and polling preserved; website and API tests passed.

TIMELINE: Existing timeline and integrity verification preserved; source production presentation integrated.

LIFECYCLE: No operator acknowledgement authority exists; unavailable state is honest. Closure/cancellation remain owner-only. API lifecycle regression passed.

MOBILE: PASS — 360x640 Android and 390x844 smartphone; overflow, accessibility and interaction checks.

TABLET: PASS — 1024x768.

DESKTOP: PASS — 1920x1080.

DELIVERY DEPENDENCY: Separate frozen lane. No authoritative incident delivery reader integrated here. BACKEND_BLOCKED rendered; typed adapter preserved, proof required for DELIVERED, SENT remains provider acceptance. No duplicate backend.

REPORTING DEPENDENCY: OPA Insight remains unavailable. Required bounded list/detail/generation/aggregate/corrective-action shapes and authorization/provenance semantics documented in command-center-reconciliation-contracts.md. Proposed consumer contracts are not claimed backend endpoints.

SSO COMPATIBILITY: Existing OPA JWT/user/credentialVersion/live role/facility checks and HttpOnly access/refresh session functions retained. Exact cookie, subject mapping, membership and callback assumptions documented. No IdP, federation mapping or callback implemented.

FOCUSED TESTS: PASS — relevant API 23 suites / 171 tests. Focused Command Center component/adapter tests are included in the complete website run (33 files / 114 tests).

POSTGRES: PASS — 4 suites / 80 tests (Super Admin, tenant isolation, enrollment, protected identity), PostgreSQL 16.14, 28 migrations verified on opa_test. The guarded test harness resets test data. No operational database used.

WEBSITE: PASS — 33 files / 114 tests using --pool=forks --maxWorkers=1 --no-file-parallelism. Initial two request-shape assertions reconciled to timeout signals.

BROWSER: PASS — 40/40 headless Edge checks across four viewports, including axe accessibility, overflow, keyboard navigation and signed-out protection. Isolated test fixtures only; no claim of live institutional E2E. Earlier 36/40 runs exposed omitted source improvements in the retained resident form: its bulk-entry accessible label and button contrast. Both were restored and the website rebuilt before the final run. JSON/screenshots: apps/website/e2e-artifacts (ignored local output).

TYPESCRIPT: PASS — website production build TypeScript check.

BUILDS: Website production build PASS. API build not required: backend unchanged. Existing Next middleware deprecation warning remains.

LINT: Changed-file lint PASS, zero warnings.

DIFF CHECK: git diff --check PASS. Pre-existing root .gitignore change and unrelated untracked artifacts preserved.

REMAINING GAPS: Live provider/evidence-storage validation; future authoritative delivery reader and reporting backend; actual SSO implementation; upstream evidence list pagination. Browser fixtures are not live authorization/provider proof. Existing separate console sign-in namespaces can require signing into Super Admin separately.

SAFE FOR DELIVERY CONFIRMATION RECONCILIATION: YES — stable consumer boundary, implementation still owned by its lane.

SAFE FOR SSO INTEGRATION: YES — documented compatibility boundary; not an SSO readiness/deployment claim.

SAFE TO COMMIT: YES — reviewed reconciliation files only; do not stage unrelated artifacts. No commit performed.

SAFE FOR INSTITUTIONAL E2E: NO — delivery/reporting and live external dependencies remain.

No commit, push, main merge, deployment or unrelated cleanup performed.
