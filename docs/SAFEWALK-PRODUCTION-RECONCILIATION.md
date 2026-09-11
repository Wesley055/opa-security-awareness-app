# SafeWalk controlled production reconciliation

Validated 2026-09-11. Tests/builds ran in an isolated copy of the authoritative target plus these exact reconciled files, using installed target dependencies. No original environment files were copied. Validation-only Prisma output and Jest/TypeScript mappings isolate generated code.

**CURRENT HEAD:** f0038a8a7f0f5567e00a63e0cbc2b5cbee5cf684; integration/institutional-security. No commit, push, merge, deployment, or production migration.

**SAFEWALK SOURCE HEAD:** a36b5d39aeb4b73605936c40562813cdeb08059a; safewalk. Reconciled tracked changes and uncommitted SafeWalk source into the authoritative target. No cherry-pick. Source worktree untouched.

**FILES INTEGRATED:** Complete repository-relative list below. Existing unrelated target files and .gitignore are preserved.

**SCHEMA CHANGES:** Journey destination/ETA, confirmations, owner-scoped durable create key, emergency link/time, selected guardian codes/grants, escalation state, notice outbox, immutable lifecycle audit. SafeWalk notices participate in existing delivery attempts/events, owner constraints, receipt projection and protected recipient snapshots. No separate Incident lifecycle.

**MIGRATIONS:** Four additive SafeWalk migrations listed below. All 34 combined migrations applied successfully to a fresh disposable PostgreSQL database. The emergency FK and pair check, immutable audit trigger, delivery owner constraints and queue/event ownership triggers are SQL-enforced. Historical notices become FAILED/UNKNOWN; no fabricated historical delivery. No production database changed.

**PRIVACY INVARIANT:** Normal SafeWalk and missed-arrival state remain owner-private from institutional operators. Guardian grants provide status only. No normal route/destination is added to institutional, public tracking, analytics or Command Center APIs.

**MISSED ARRIVAL POLICY:** Nominal ETA +5 minutes queues a safety check; +8 minutes queues non-emergency overdue notices to selected guardians if no confirmation. Server database time and immutable ETA determine deadlines. If a worker runs late, the source policy preserves a minimum three-minute response window after creating the check, so guardian notification can occur later than +8. This is scheduling time, not a promise of recipient delivery. Missed arrival never creates an Incident.

**OWNER ACCESS:** Existing authenticated session principal owns create/read/confirm/cancel; tenant authority is never accepted from request data. Active lookup and exact-session terminal lookup support resume. Wrong-owner and ineligible-account access is denied.

**OPERATOR VISIBILITY:** No operator opt-in feature is introduced. Visibility is authorized only through the existing emergency path, scoped by current Incident authorization. Captured AND received timestamps must be at/after emergency authorization (or later Incident creation); historical private movement and destination remain excluded.

**GUARDIAN ESCALATION:** Up to five explicit account guardians using short-lived, hash-only pairing codes. Same tenant/facility, or both personal accounts; eligible USER accounts only. Revocation and scope changes invalidate grants. Messages contain minimal non-emergency text, and the guardian inbox returns status without coordinates or owner identity.

**INCIDENT ESCALATION:** Explicit user SOS uses the current orchestrator, including locationless emergency activation and reuse of an existing Incident. Existing authorized SOS policy also links an active SafeWalk. Link/time and reason are audited. Concurrent duplicate explicit activation returns one Incident; completion and emergency activation serialize.

**LOCATION:** Uses the existing foreground/background tracker and SQLite queue, bound to the exact SafeWalk session. Upload receipt time is identified as receipt time, never current location. Unavailable tracking and buffered/offline state are visible. Background notification now truthfully describes journey tracking. Permission-gated capture does not claim guaranteed monitoring.

**OFFLINE/REPLAY:** Create intent/key persists in SecureStore before POST and survives uncertain responses. Existing SQLite sequence/idempotency/replay behavior is reused. Auth-scoped resume binds the existing session; verified terminal state retires that exact persisted background session after cold start. Stale async starts cannot disable a newer walk. Offline status is explicitly last-known.

**NOTIFICATION INTEGRATION:** Durable SafeWalkNotice outbox uses the existing EmailProvider, dispatch evidence wrapper, shared DeliveryLedgerService and protected snapshot service. In-app owner/guardian views coexist with email. No separate provider stack. SAFEWALK_ESCALATION_ENABLED=true is required; production create fails closed when disabled.

**DELIVERY INTEGRATION:** Shared claim/attempt/recovery/verified receipt path; QUEUED and PROVIDER_ACCEPTED are not DELIVERED. Unknown provider outcomes remain unknown rather than blindly resent. Completion/revocation/emergency suppress unclaimed notices under lifecycle locks. An already-authorized in-flight provider request cannot be recalled; dispatch authorization is audited.

**PII:** Institutional recipient addresses use existing encrypted Protected Identity snapshots, source/subject binding and audited resolution, with current WRITE/DELIVERY authorization. Configure PII_DELIVERY_ACTORS_JSON or PII_DELIVERY_ACTOR_USER_ID and the existing identity crypto/grants. Personal recipient email follows existing account policy. No new crypto or PII authority.

**TENANT:** Existing account/facility/session model is authoritative. Guardian scope and eligibility are rechecked at grant, read, escalation and dispatch. Full PostgreSQL tenant and PII regressions executed.

**SSO:** Existing local/SSO guards and session resolution are reused. Full API and PostgreSQL suites include authoritative auth/SSO regressions. No live enterprise IdP sign-in was performed.

**COMMAND CENTER:** No normal SafeWalk listing or UI added. Existing Incident access remains the authorization boundary. Operator/public tracking and emergency-intelligence regressions prevent private pre-emergency route disclosure.

**MOBILE:** Authenticated home entry and complete SafeWalk screen: real destination coordinates/label and ETA, guardian pairing/selection/removal/inbox, active state, safety prompt, overdue, arrival, cancellation, explicit emergency consent, loading/errors/offline/resume. Destination coordinates are entered manually; no fake geocoder or map. Foreground prominent disclosure explains background location.

**CONCURRENCY:** Existing user lifecycle and journey ingestion lock order, unique create/audit/notice constraints and shared outbox claims protect duplicate create/arrival, overlapping workers, guardian races, completion versus escalation/dispatch, and retries. Cross-owner reuse of the same create key has a dedicated PostgreSQL regression. Mobile stale owner/permission responses and exact-session cleanup are covered.

**FOCUSED TESTS:** 3 suites / 31 tests passed. SafeWalk timing/ownership/privacy, guardian and lifecycle tests also run within full suites.

**POSTGRES:** 19 suites / 206 tests passed in the full suite; final lifecycle/key/outbox/PII follow-up: 1 suites / 8 tests passed. Full run preceded the final owner-scoped audit-key adjustment; the final targeted run verifies that adjustment. PostgreSQL 16.14, isolated localhost port 55439, database opa_safewalk_reconcile_test. No production DB URL used.

**FULL API:** 91 suites / 890 tests passed.

**WEBSITE:** Untouched. Website tests, type checks and builds were not run.

**MOBILE TESTS:** 26 suites / 245 tests passed. Includes actual React rendering regression plus queue/replay, background, auth and SOS regressions. Native functions are mocked in Jest.

**PRISMA:** Generate PASS (Prisma 6.19.3) and validate PASS. Isolated validation generated its own client; target client generation/type verification is part of the controlled apply validation.

**TYPESCRIPT:** API and mobile --noEmit PASS; website not touched. Includes changed test files.

**BUILDS:** Nest API build PASS. Expo Android export PASS (1170 modules, 3.1 MB Hermes bundle). This is a JS production export, not an APK/AAB build or physical-device test.

**LINT:** Changed API files PASS with existing API ESLint config. Changed mobile TS/TSX PASS using the same rule set extended to TSX in a validation-only config, because mobile has no existing ESLint config. Zero warnings. No broad lint configuration change.

**DIFF CHECK:** Staged per-file git diff --no-index --check PASS. Controlled apply additionally requires target git diff --check and exact installed-file hash verification.

**REMAINING GAPS:** Before pilot: physical Android/iOS locked/background/permission-denied/offline-replay and cold-start journeys; real email provider acceptance, verified receipts and failure recovery; institutional SSO/PII configuration and tenant E2E; operational worker availability, outage-delayed prompt behavior, alerting and provider limits; reviewed production migration/rollback rehearsal. Destination input is manual; push/SMS SafeWalk delivery and operator opt-in are not implemented. No end-to-end delivery or guaranteed background monitoring claim is made.

**SAFE TO COMMIT:** YES — reconciled code and validation evidence are ready for review/commit; commit was not performed. This does not authorize rollout.

**SAFE FOR SILENT SOS IMPLEMENTATION:** YES — as subsequent development against this reconciled architecture; no new Silent SOS implementation or production readiness claim.

**SAFE FOR CONTROLLED INSTITUTIONAL E2E:** YES — controlled non-production testing with test accounts and configured provider/PII/SSO is the next validation step, not a claim that live E2E has passed.

**SAFE FOR PRODUCTION SAFEWALK PILOT:** NO — real-device, provider, operational and institutional acceptance gates above remain.

## Files integrated

- `apps/api/prisma/migrations/20260904025423_add_safewalk_destination/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/emergency-intelligence/emergency-intelligence-snapshot.service.spec.ts`
- `apps/api/src/modules/emergency-intelligence/emergency-intelligence-snapshot.service.ts`
- `apps/api/src/modules/incident-access/public-tracking.service.spec.ts`
- `apps/api/src/modules/incident-access/public-tracking.service.ts`
- `apps/api/src/modules/incidents/incident-tracking.service.spec.ts`
- `apps/api/src/modules/incidents/incident-tracking.service.ts`
- `apps/api/src/modules/journey/dto/start-session.dto.ts`
- `apps/api/src/modules/journey/journey-ingestion.service.spec.ts`
- `apps/api/src/modules/journey/journey-ingestion.service.ts`
- `apps/api/src/modules/journey/journey-session.service.ts`
- `apps/api/src/modules/journey/journey.controller.ts`
- `apps/api/src/modules/journey/journey.module.ts`
- `apps/api/test/journey.controller.spec.ts`
- `apps/api/prisma/migrations/20260909010000_add_safewalk_confirmations/migration.sql`
- `apps/api/prisma/migrations/20260909020000_safewalk_guardians_escalation/migration.sql`
- `apps/api/src/modules/journey/safewalk-escalation.service.ts`
- `apps/api/src/modules/journey/safewalk-guardian.controller.spec.ts`
- `apps/api/src/modules/journey/safewalk-guardian.controller.ts`
- `apps/api/src/modules/journey/safewalk-guardian.service.ts`
- `apps/api/src/modules/journey/safewalk-policy.spec.ts`
- `apps/api/src/modules/journey/safewalk-policy.ts`
- `apps/api/src/modules/journey/safewalk.service.spec.ts`
- `apps/api/src/modules/journey/safewalk.service.ts`
- `apps/api/test/int/safewalk-confirmations.int-spec.ts`
- `apps/api/test/int/safewalk-guardian-escalation.int-spec.ts`
- `apps/api/src/modules/notifications/delivery-ledger.service.ts`
- `apps/api/src/modules/protected-identity/protected-snapshots.service.ts`
- `apps/api/src/modules/incident-orchestrator/incident-orchestrator.service.ts`
- `apps/api/src/modules/incident-orchestrator/dto/create-incident-request.dto.ts`
- `apps/api/src/modules/journey/safewalk-notification.worker.ts`
- `apps/api/prisma/migrations/20260911010000_safewalk_delivery_lifecycle/migration.sql`
- `apps/mobile-app/src/services/journey-tracker.ts`
- `apps/mobile-app/app/_layout.tsx`
- `apps/mobile-app/app/index.tsx`
- `apps/mobile-app/app/safewalk.tsx`
- `apps/mobile-app/src/services/safewalk.ts`
- `apps/api/test/int/safewalk-reconciliation.int-spec.ts`
- `apps/api/src/modules/incident-orchestrator/incident-orchestrator.service.spec.ts`
- `apps/mobile-app/src/services/safewalk-ui.spec.ts`
- `apps/mobile-app/src/services/safewalk.spec.ts`
- `apps/mobile-app/src/services/journey-tracker.spec.ts`
- `apps/mobile-app/src/services/active-incident-reconciliation.spec.ts`
- `apps/mobile-app/src/services/locked-background-trigger-ownership.spec.ts`
- `docs/SAFEWALK-PRODUCTION-RECONCILIATION.md`

## Validation evidence

Local logs and machine-readable Jest/results are retained at:

`C:\Users\mohammed.WESLEYWEST\.codex\visualizations\2026\09\11\01a08ecd-2d63-7072-ad9e-719b0fef5d34\safewalk-reconciled`

Disposable container `opa-safewalk-reconcile-0911` remains available on localhost:55439 for review. Existing database containers were not changed. No unrelated artifacts were cleaned.
