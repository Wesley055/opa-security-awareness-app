# OPA Evidence & Insight handover

Validation completed: 2026-09-12. Final serial checks passed. This is an uncommitted internal foundation candidate, not a deployment or regulatory approval.

## Workspace and scope

WORKSPACE: C:\\Projects\\OPA-evidence-insight
BRANCH: codex/opa-evidence-insight
BASE HEAD: 3ae25962fae46103408b0e0d180bcc8dca4a9069

The interrupted candidate was resumed. Its seven copied API files matched staged hashes; tracked files remained at the stated base with no unexpected changes. The OneDrive staged originals were preserved. Implementation continued directly in the isolated worktree after staging writes failed.

No commit, push, merge, deployment or production operation was performed. C:\\Projects\\OPA was not modified. Installed dependencies use the existing lockfiles.

SCHEMA CHANGES: ReportingProjection, AfterIncidentReport, CorrectiveAction and CorrectiveActionStatus; composite action-to-AIR scope constraint and five CHECK constraints.
MIGRATIONS: one forward migration, 20260911170000_evidence_insight_foundation. No historical migration changed.

## Implemented foundation

REPORTING FOUNDATION: one allowlisted projector supplies persisted/rebuildable projections, aggregate metrics, AIR and Insight.
FACILITY/TENANT: current database account/facility; existing role guards; one facility per request; no wildcard platform aggregation.
PII: protected default output; no recipient/name/phone/email/guardian/free-text/precise-coordinate export and no new identity or reveal subsystem.
SAFEWALK PRIVACY: only matching authorized emergency incident linkage; personal journeys and missed-arrival notices excluded.
DELIVERY TRUTH: authoritative delivery ledger state and attempts; provider accepted remains unconfirmed.
UNKNOWN HANDLING: absent acknowledgement, unsupported source facts, missing closure information and unestablished measurements remain unknown.

AGGREGATE REPORTING: counts, activation trigger/mode/source, UTC daily volume, scoped facility map, resolution latency with known/unknown denominators, notification outcomes, location availability, unresolved/stale, SafeWalk emergencies, deterministic evidence coverage and corrective-action summaries.
SIZE LIMIT BEHAVIOR: maximum 366-day window, 1,000 incident candidates, 10,000 total source-history records checked before materialization; oversized requests fail without partial results.

FORENSIC AIR: stored structured snapshots; canonical document digest, version/schema/generator/cutoff provenance, source references, chronological timeline, masked human notes, honest missing-data indicators.
VERSIONING: same request key returns original; new key appends version and supersedes reference; previous document never regenerated on read.
SNAPSHOT MODEL: SERIALIZABLE transaction observation, not arbitrary past-state reconstruction or a legal evidence archive.
PROVENANCE: source event/notification/attempt/evidence references; actor denotes on-behalf-of and is masked in ordinary output.
UNCERTAINTY: source assertions distinguished from system observations; missing or withheld facts explicitly represented.

CORRECTIVE ACTIONS: catalog title/description, scoped owner, due date, priority, AIR/incident linkage, controlled lifecycle, completion/verification and audit.
LIFECYCLE: OPEN -> IN_PROGRESS -> COMPLETED -> VERIFIED; manager cancellation from active work; owner can return COMPLETED to IN_PROGRESS; VERIFIED/CANCELLED terminal.
OVERDUE: derived only for OPEN/IN_PROGRESS past due date.
COMPLETION EVIDENCE: authoritative STORED Evidence belonging to the same incident.
VERIFICATION SEPARATION: authorized manager different from owner.
CONCURRENCY: compare-and-swap version update, SERIALIZABLE retries and transactionally committed audit. Audit failure rolls back changes.

OPA INSIGHT:
- EXECUTIVE: volume/trend, unresolved, resolution, corrective actions and evidence coverage.
- OPERATIONS: acknowledgement unknown, resolution, delivery truth and scoped facility counts.
- RISK: observed categories and overdue work; no predictive/causal AI.
- EVIDENCE: fixed coverage and missing evidence/closure provenance; unestablished source audit coverage remains null.

CONTINUOUS COMPLIANCE EVIDENCE: latest stored AIR/version chain plus current corrective actions; no regulatory claim or framework mapping.

COMMAND CENTER: existing Reports page gains server-only, no-store 30-day Insight loading with four responsive views. Unavailable is not zero. AIR/action authoring controls remain future UI work; backend operations are wired.
SUPER ADMIN: existing AdminGuard; explicitly scoped masked reporting, no automatic PII reveal.
SSO / ACTIVE INCIDENT OPERATIONS: no lifecycle/authentication changes.

## Executed validation

| Check | Result |
| --- | --- |
| Focused projection/action unit cases, included in final full API run | 18/18 passed |
| Final full API with explicit local environment classification | 929/929 passed, 97 suites |
| Full PostgreSQL serial retry with local classification | 227/227 passed, 21 suites |
| Final PostgreSQL Insight tests | 15 tests passed, including HTTP, source-history cap and audit rollback |
| Prisma generate | Passed |
| Prisma validate with isolated DATABASE_URL | Passed |
| Clean empty-database migrate deploy | All 36 migrations applied |
| Repeat migrate deploy | No pending migrations |
| Base/candidate schema comparison | Identical pre-existing drift; no added drift |
| Reporting database objects | Three tables and all five CHECK constraints verified |
| Final API TypeScript/build/lint, including migration-script lint | Passed |
| Website TypeScript/build/lint | Passed |
| Final full website suite, serial worker | 141/141 passed, 38 files |
| DIFF CHECK | Passed for tracked changes and every added file; no conflict markers |

The schema comparison intentionally does not claim a zero global diff. Replaying the 35 migrations from BASE into a second empty _test database reproduces exactly the candidate's three SafeWalk differences: two ON UPDATE behaviors and the existing hand-added emergency-incident foreign key. verify-insight-migration.cjs compares the exact generated SQL and proves reporting adds no further drift.

## Infrastructure retries and implementation corrections

- Prisma validation initially lacked DATABASE_URL; rerun used the dedicated isolated test database.
- First focused PostgreSQL run: 10/12 passed. Corrected a fixture that tried to insert PROVIDER_ACCEPTED through a trigger that correctly marked it UNKNOWN, and corrected a synchronous-throw assertion. Production Delivery behavior was preserved.
- First full API: 912/924 passed with missing OPA_ENVIRONMENT. Explicit development classification produced 924/924.
- First website: 137/140 passed with missing classification. Configured run: 139/140; one new UI test timed out at the unchanged 5-second limit under overlapping validation load. Serial retry removed the timeout. An existing placeholder-text assertion then failed after the intentional UI wording change; the expectation was updated while retaining all four no-fabricated-data areas. Final serial result: 141/141.
- First full PostgreSQL: 202/225 passed; SSO fixture setup was denied without classification and two SafeWalk tests exceeded existing transaction timeouts during overlapping jobs. Configured serial rerun: 227/227, including two added tests.
- Final contract review replaced an incomplete activation-source allowlist with the existing OPA enum (LOCK_SCREEN and SAFEWALK_EXPLICIT included). Four enum tests added and passed in the final full API run. A further legacy-history regression requires durable queue evidence as well as matching attempt counts for notification-history completeness; it also passed.
- Test timeouts and operational domain behavior were not changed to mask failures.

## Reproduce locally

Use the existing locked dependencies and apps/api/.env.test.local pointing to a dedicated local database ending in _test. This harness truncates its test database.

Set OPA_ENVIRONMENT=development in the test process. Run the existing API unit and PostgreSQL scripts, then the website suite serially to avoid competing test/build load. Do not change test timeout values.

Run node apps/api/scripts/verify-insight-migration.cjs from any directory after candidate migrations are applied. It requires a local _test URL, creates a separate uniquely named baseline _test database, replays BASE's historical SQL read-only from Git, and compares schema differences. It never modifies operational databases.

Local test container: opa-evidence-insight-0911, localhost:55441, PostgreSQL 16.14. Candidate database: opa_evidence_insight_test. Validation outputs are retained as ignored evidence-*-validation.log and evidence-migration-proof.log files in apps/api and apps/website.

## Remaining foundation limits

No authoritative incident acknowledgement/arrival writer exists; these metrics are unknown. Precise tracking and identity reveal remain outside reports. Custom free-text corrective actions require a protected-content policy; initial actions use a bounded catalog. AIR/action authoring UI, asynchronous high-volume reporting, scheduled reconciliation, retention/legal holds, PDF/CSV formatting and signed exports are not implemented. No regulatory adapters or external Partner API/Webhooks were built.

The three pre-existing SafeWalk schema differences need separate integration awareness; this lane deliberately preserves operational migrations and behavior.

SAFE TO COMMIT IN ISOLATED BRANCH: YES.
SAFE FOR INTEGRATION RECONCILIATION: YES — review the documented inherited schema differences and foundation limits.
SAFE TO BEGIN PARTNER API CONTRACT DESIGN: YES — design only; external authorization, disclosure, export and retention contracts remain separate work. No publication or gateway implementation is authorized by this result.

## Final file inventory

CURRENT FILE COUNT: 26

FILES CHANGED:

- apps/api/prisma/migrations/20260911170000_evidence_insight_foundation/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/scripts/verify-insight-migration.cjs
- apps/api/src/app.module.ts
- apps/api/src/modules/insight/insight.actions.ts
- apps/api/src/modules/insight/insight.controller.ts
- apps/api/src/modules/insight/insight.dto.ts
- apps/api/src/modules/insight/insight.guard.ts
- apps/api/src/modules/insight/insight.module.ts
- apps/api/src/modules/insight/insight.projection.spec.ts
- apps/api/src/modules/insight/insight.projection.ts
- apps/api/src/modules/insight/insight.service.ts
- apps/api/test/int/insight.int-spec.ts
- apps/website/src/app/(console)/operator/(protected)/reports/page.tsx
- apps/website/src/components/console/insight-overview.spec.tsx
- apps/website/src/components/console/insight-overview.tsx
- apps/website/src/components/console/production-boundaries.spec.tsx
- apps/website/src/components/console/reporting-shell.tsx
- apps/website/src/lib/insight-overview.spec.ts
- apps/website/src/lib/insight-overview.ts
- docs/insight/OPA-AGGREGATE-REPORTING-CONTRACT.md
- docs/insight/OPA-CONTINUOUS-COMPLIANCE-EVIDENCE.md
- docs/insight/OPA-CORRECTIVE-ACTIONS-CONTRACT.md
- docs/insight/OPA-EVIDENCE-INSIGHT-ARCHITECTURE.md
- docs/insight/OPA-EVIDENCE-INSIGHT-HANDOVER.md
- docs/insight/OPA-FORENSIC-AIR-CONTRACT.md
