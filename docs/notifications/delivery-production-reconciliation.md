# Delivery Confirmation — controlled production reconciliation

**CURRENT HEAD:** `35ac7a555d8e2d80bed32f048faede4d5969cd24`
**Workspace / branch:** `C:\Projects\OPA` / `integration/institutional-security`
**DELIVERY SOURCE HEAD:** `58b517270b8d7cc9aa6c850cd8ea9788dddf2ffd`, `codex/delivery-confirmation`, `C:\Projects\OPA-delivery-confirmation`. The implementation was uncommitted work over that older base. Files were reconciled against the authoritative contracts; no cherry-pick was used.

**FILES INTEGRATED:** 47 code/schema/dependency/test files, plus this report. Exact inventory follows below. Pre-existing `.gitignore` changes, installer scripts, `app.json`, the unrelated item3 migration utility, and evidence artifacts were preserved.

**SCHEMA CHANGES:** Adds `DeliveryStatus`, `DeliveryFailureCategory`, `DeliveryAttempt`, `ProviderReference`, `DeliveryStatusEvent`, and `ProviderDeliveryReceipt`. Both existing outboxes gain delivery projections and timestamps. The incident outbox gains a retry due time. Existing tenant, enrollment, administrative audit and Protected Identity schema remains intact. No competing tenant or PII store was added.

**MIGRATIONS:** `20260910010000_delivery_confirmation` is additive. Existing rows remain UNKNOWN with no invented delivery/attempt timestamps. Queue triggers write evidence in the outbox transaction; ownership constraints and immutable audit/reference triggers preserve provenance. Applied successfully to the local integration database with all 29 migrations. Separate empty-database legacy verification preserved both outboxes without inventing history. The bounded `protect-delivery-snapshots.cjs` utility reuses the existing authorized snapshot backfill; it is dry-run by default. No production migration or backfill was performed.

**TENANT RECONCILIATION:** Delivery reads use the shared `incidentScope` and existing JWT/incident guards. Actor authority is reread from the database. Both incident existence and notification queries carry scope. Browser facility/organization fields confer no authority; notification IDs/cursors cannot select another incident's rows. No unscoped delivery-ID route exists.

**PII RECONCILIATION:** New institutional incident outboxes are encrypted through `ProtectedSnapshotsService.notificationData` and `ProtectedIdentityService.protectInTransaction` inside the original outbox transaction. Stored recipient/contact fields become `[protected]` and plaintext payload becomes database null. Dispatch uses the existing source-bound, authorized, audited resolver. Protected institutional views are fully masked without decryption. Legacy institutional plaintext rows fail closed at dispatch pending controlled cutover.

**SUPER ADMIN RECONCILIATION:** Existing staff invitation/enrollment ownership and eligibility remain authoritative. Delivery evidence cannot create memberships, verify proofs, accept an invitation, restore a revoked enrollment, or reset a password. No activation credential is added to delivery storage or DTOs.

**INVITATION WORKER:** Retains `prepareIdentityDelivery` for current enrollment and password-reset outbox work, including enrollment row locking and transactional credential preparation. The ledger claim joins that transaction. Legacy invitations retain their current eligibility checks and protected-recipient resolver. Ineligible work is cancelled/failed with durable attempt evidence. Abandoned attempts become UNKNOWN without blind resend or credential rotation.

**COMMAND CENTER DELIVERY READS:** `GET /incidents/:incidentId/deliveries?after=<UUID>` provides version 1, up to 50 records, and a scoped cursor. The same-origin operator bridge uses the current session adapter and whitelists fields. Incident detail shows masked recipient, channel, all six states, queued/first/latest attempt/acceptance/proven delivery times, failure category, attempts/retries and retry due time. Refresh and pagination are implemented. Unconfirmed outcomes and incomplete history are explicit. Provider references, raw receipt payloads and secrets are not exposed.

**SMS PROVIDER:** Africa's Talking, retained behind the SMS adapter. Successful provider submission means PROVIDER_ACCEPTED only.

**SMS VERIFIED RECEIPT:** Unavailable. This is an **accepted provider limitation, not a software defect**. No verified cryptographic callback contract has been established in this implementation. The Africa's Talking endpoint rejects callbacks, and the ledger independently refuses unsupported provider receipts as delivery proof. SMS therefore cannot be promoted to DELIVERED by an unverified callback.

**STATUS SEMANTICS:**

| State | Meaning |
| --- | --- |
| QUEUED | Durable dispatch intent exists. |
| ATTEMPTING | A numbered attempt has been claimed; validation can still prevent transport. |
| PROVIDER_ACCEPTED | Submission accepted; final delivery remains unconfirmed. |
| DELIVERED | Authenticated supported provider evidence proves delivery. Resend means recipient mail-server delivery, never reading. |
| FAILED | Classified failure was established. Retry policy is separate. |
| UNKNOWN | Outcome cannot be established, including ambiguous transport and legacy history. |

Scheduling status remains separate from delivery truth. A queued retry may retain FAILED delivery truth. Confirmed delivery dominates weaker later evidence. Late authenticated receipts can strengthen an older attempt and its owner.

**CALLBACK SECURITY:** Resend verification uses the exact raw body and the locked Standard Webhooks verifier. Missing configuration fails closed. Invalid/missing signatures, malformed headers, oversized bodies and expired/future envelopes are rejected. Only normalized facts are persisted. Parser/controller error responses and receipt logging are sanitized. No live provider callback configuration was changed.

**CALLBACK IDEMPOTENCY:** Unique provider/account/event identity; identical duplicate insertion is harmless, conflicting identity is rejected. Receipt application and audit insertion commit atomically. Unmatched references remain in the durable inbox for bounded reconciliation.

**REPLAY PROTECTION:** Five-minute signed-envelope tolerance plus durable event identity. Expired/future signed replays are rejected. Out-of-order receipt tests preserve stronger truth.

**CONCURRENCY:** Parent outbox row locks serialize claims, completions and receipt application. Immutable attempt IDs fence completion; network I/O occurs outside transactions. Real PostgreSQL tests prove concurrent dispatch of a protected institutional outbox causes one provider send after one resolution audit, and duplicate receipt application records one receipt event.

**RETRY POLICY:** At most five attempts. Known retryable refusal uses 1/5/15/60-minute delays plus bounded jitter. Authentication, invalid recipient, rejection, expiry and internal failures cannot retry automatically. Network/timeouts/ambiguous 5xx remain UNKNOWN with no blind resend. Worker wait is bounded at 30 seconds; late responses remain observable. Stale-attempt recovery after five minutes records uncertainty.

**PLAINTEXT PII EXPOSURE:** No complete phone/email, contact name, capability URL, provider reference, payload or raw diagnostic in ordinary delivery DTOs. No new delivery table stores recipient snapshots. New institutional outboxes are protected before persistence; historical institutional rows require authorized cutover. Existing **personal, non-tenant** outbox storage remains compatible with the current architecture and may contain plaintext at rest: the institutional Protected Identity adapter has no tenant/grant context for those accounts. This change does not claim global elimination of legacy/personal plaintext.

**REPORTING PROJECTION:** Preserves the API projection for future OPA Insight: per-recipient/channel states, attempt history, queued/attempted/accepted/proven-delivery timestamps, failed-attempt count, retries, unknown/unconfirmed outcomes and latency metrics. Incomplete historical failure counts and unavailable/negative latency are null, not fabricated zeroes. The website uses a smaller display projection. No full Insight implementation was added.

**FOCUSED TESTS:** PASS — 9 suites / 67 tests, covering delivery policy, signed receipt security, dispatch, retry/worker behavior, masking and reconciliation. The real PostgreSQL delivery suite also passes.

**POSTGRES:** PASS — 15 suites / 145 tests on local PostgreSQL 16.14, database `opa_test`, all 29 migrations verified. Includes delivery receipt/concurrency, tenant, PII, enrollment/reset, invitation worker, Super Admin and incident regressions. Dedicated legacy database `opa_delivery_reconciliation_20260910_test` also passed the additive migration proof. It contains synthetic fixtures only and was left in place.

**FULL API:** PASS — 83 suites / 712 tests. No skipped tests in the successful final run.

**WEBSITE:** PASS — 34 suites / 124 tests using `--pool=forks --maxWorkers=1 --no-file-parallelism`. Includes delivery bridge/projection/UI and existing relevant website regressions. No live institutional browser E2E was executed.

**PRISMA:** Generate PASS (Client 6.19.3); validate PASS.

**TYPESCRIPT:** API and website `tsc --noEmit` PASS.

**BUILDS:** API Nest build and website Next production build PASS. API rebuilt after the final resolver change. Existing Next middleware deprecation notice remains.

**LINT:** All changed TypeScript/TSX files PASS. Both delivery CJS utilities pass syntax checks; the legacy verification utility executed successfully, and the cutover utility booted and completed a dry run against an empty synthetic test scope.

**DIFF CHECK:** PASS — `git diff --check`.

Earlier failed runs were investigated and corrected, not counted as passes. Enrollment fixture configuration was isolated after the installed ConfigService's environment priority caused string bcrypt rounds to override typed test settings. Existing worker fixtures were updated to exercise the authoritative ledger rather than manually claiming rows or expecting blind resend. Interrupted checks are not included in successful counts.

## Cutover contract

This is a runbook; none of these production actions were performed.

1. Coordinate worker shutdown during schema/application cutover. Apply the additive schema migration using the existing deployment procedure.
2. Use the existing protected crypto/key configuration. Configure a server-selected delivery actor with current, unexpired WRITE and DELIVERY grants in each institutional tenant. `PII_DELIVERY_ACTORS_JSON` maps tenant UUIDs to actor UUIDs. When present, a missing tenant mapping fails closed. The existing `PII_DELIVERY_ACTOR_USER_ID` remains a single-tenant compatibility fallback when no map is configured. Every selected actor still passes the current grant, active account and membership checks.
3. From `apps/api`, after building, run `node scripts/protect-delivery-snapshots.cjs --tenant <UUID> --actor <authorized-migration-actor-UUID>` for a dry run. Add `--apply` only in the approved operational cutover. Each invocation processes at most 100 notification snapshots and 100 legacy invitation snapshots; successful rows are resumable through the existing backfill contract.
4. Resolve remaining or in-flight legacy records under existing authorization and retention rules. The utility excludes SENDING rows and preserves scheduling. Missing durable payloads, inactive/moved subjects, missing grants, and stale versions are refused by the existing adapter; never fabricate payloads, bypass grants, or blindly requeue unknown outcomes to make a migration appear complete.
5. Configure the Resend signing secret, stable provider account scopes and relevant receipt subscriptions, then perform environment-specific verification. Africa's Talking SMS remains acceptance-only.
6. Resume workers and validate the authorized institutional operator workflow before declaring that environment ready.

**REMAINING GAPS:** Production/environment cutover, tenant actor/grant/key provisioning, historical-row disposition, provider configuration and live institutional E2E remain unperformed. Production-scale migration lock duration and receipt backlog monitoring require operational validation. Push, WhatsApp and voice retain explicit unimplemented baseline transports. Direct utility sends are outside the incident/invitation reporting denominator. Personal non-tenant plaintext storage is unchanged. The SMS receipt limitation is accepted and does not justify inventing DELIVERED.

**SAFE TO COMMIT: YES** — reconciliation and required automated checks are complete; no commit was made.
**SAFE FOR SSO INTEGRATION: YES** — as a code integration baseline; SSO itself has not been implemented or validated here.
**SAFE FOR INSTITUTIONAL E2E: NO** — environment cutover/preflight and the live institutional workflow still need execution. The isolated automated institutional regressions pass.

No commit, push, merge to main, deployment, production database mutation, or unrelated artifact cleanup was performed.

## Exact integrated file inventory


- apps/api/package.json
- apps/api/prisma/migrations/20260910010000_delivery_confirmation/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/scripts/protect-delivery-snapshots.cjs
- apps/api/scripts/verify-delivery-migration.cjs
- apps/api/src/main.ts
- apps/api/src/modules/admin-provisioning/invitation-delivery.worker.spec.ts
- apps/api/src/modules/admin-provisioning/invitation-delivery.worker.ts
- apps/api/src/modules/incident-orchestrator/incident-orchestrator.service.spec.ts
- apps/api/src/modules/incident-orchestrator/incident-orchestrator.service.ts
- apps/api/src/modules/notifications/delivery-confirmation.spec.ts
- apps/api/src/modules/notifications/delivery-dispatch.ts
- apps/api/src/modules/notifications/delivery-ledger.service.ts
- apps/api/src/modules/notifications/delivery-policy.ts
- apps/api/src/modules/notifications/delivery-read.controller.ts
- apps/api/src/modules/notifications/delivery-receipt.controller.ts
- apps/api/src/modules/notifications/delivery-receipt.worker.ts
- apps/api/src/modules/notifications/delivery-recipient.ts
- apps/api/src/modules/notifications/delivery-reconciliation.spec.ts
- apps/api/src/modules/notifications/notification-dispatch.worker.spec.ts
- apps/api/src/modules/notifications/notification-dispatch.worker.ts
- apps/api/src/modules/notifications/notification.module.ts
- apps/api/src/modules/notifications/notification.service.dispatch.spec.ts
- apps/api/src/modules/notifications/notification.service.ts
- apps/api/src/modules/notifications/providers/email.provider.ts
- apps/api/src/modules/notifications/providers/notification-provider.interface.ts
- apps/api/src/modules/notifications/providers/push.provider.ts
- apps/api/src/modules/notifications/providers/sms.provider.spec.ts
- apps/api/src/modules/notifications/providers/sms.provider.ts
- apps/api/src/modules/notifications/providers/voice.provider.ts
- apps/api/src/modules/notifications/providers/whatsapp.provider.ts
- apps/api/src/modules/protected-identity/pii-logging.spec.ts
- apps/api/src/modules/protected-identity/protected-snapshots.service.ts
- apps/api/src/shared/filters/global-exception.filter.ts
- apps/api/src/shared/middleware/request-logging.middleware.ts
- apps/api/test/int/delivery-confirmation.int-spec.ts
- apps/api/test/int/enrollment.int-spec.ts
- apps/api/test/int/invitation-delivery-worker.int-spec.ts
- apps/api/test/int/locationless-incident.int-spec.ts
- apps/api/test/int/protected-identity.int-spec.ts
- apps/website/src/app/(console)/operator/(protected)/incidents/[incidentId]/incident-detail.tsx
- apps/website/src/app/api/operator/incidents/[incidentId]/deliveries/route.spec.ts
- apps/website/src/app/api/operator/incidents/[incidentId]/deliveries/route.ts
- apps/website/src/components/console/delivery-confirmation.tsx
- apps/website/src/components/console/production-boundaries.spec.tsx
- apps/website/src/lib/delivery-confirmation.ts
- package-lock.json
- docs/notifications/delivery-production-reconciliation.md
