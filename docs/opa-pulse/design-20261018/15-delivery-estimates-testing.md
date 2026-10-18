# Proprietary delivery estimates and comprehensive automated tests

Design v1.1 incorporates the final founder decision of 18 October 2026. OPA owns and independently operates Pulse as its authoritative CRM. No third-party CRM evaluation, license, adapter or synchronization work appears in this estimate. Authorized Google Workspace/Microsoft 365 mail/calendar integration remains fully included. This document plans future implementation; it authorizes neither coding nor deployment.

## Revised estimate basis

The v1.0 S/M/L backlog supplied complexity markers rather than numerical estimates. The ranges below are the initial bottom-up planning envelope for implementing the full proprietary scope, including automated tests, documentation and defect correction. They are not a fixed-price quotation or delivery promise.

Assume four experienced full-time engineers plus one dedicated QA automation engineer; a product/UX owner, security/privacy reviewer, platform/operations reviewer, finance reviewer and product-fact owners contribute part-time. Engineering/QA person-weeks below include the five-person delivery team only; specialist review, content authorship, licenses and infrastructure costs require separate budget. A person-week is five working days. Team recruitment, leave and provider-approval queues can extend elapsed time.

| Phase / backlog | Scope retained | Engineering + QA person-weeks | Exit evidence |
|---|---|---|---|
| 0 / B00–B02 | Delivery/policy closure, OPA-controlled module contracts and isolated foundations, design system | 6–8 | Approved ownership/boundaries, contract validation and synthetic test plan; no vendor trial |
| 1 / B03–B05 | Employee identity, permissions/territories, personal workspace/tasks | 14–20 | Identity lifecycle, revoked-worker, role/object/field and personal-scope tests |
| 2 / B06–B08 | Native institutional CRM, lead/deal lifecycle, governed CSV/JSON intake/export | 16–24 | Domain/database/concurrency tests and synthetic browser journey; no CRM adapter |
| 3 / B09–B12 | Academy/facts/learning, five proposal templates, pricing, approvals, DOCX/PDF | 22–32 | Six role paths, immutable truth/approval tests and all-industry export QA |
| 4 / B13–B15 | Both mail-provider options, signatures/templates/scheduling, calendar/meeting flows | 20–30 | Adapter conformance, provider-failure/revocation/sender-privacy and schedule tests |
| 5 / B16–B19 | All 26 workflows, handover/renewals, revenue/KPIs and reviewed intelligence | 22–34 | Replay/fake-clock/financial/provenance/ACL and evidence-grounding tests |
| 6 / B20–B21 | Independent security/privacy/recovery verification and founder UAT preparation | 12–18 | Security review, performance/accessibility/restore evidence and documented residual risks |
| Total baseline | Full approved enterprise scope | 112–166 | No omitted screens, industries or provider options |
| Planning reserve | 20% for estimation uncertainty | 22.4–33.2 | Controlled by delivery owner; scope changes recorded |
| Rounded planning envelope | Baseline + reserve rounded upward | 135–200 | Re-estimate after phase 0 and each phase exit |

At five dedicated delivery staff, the reserved envelope represents about 27–40 fully utilized team-weeks before sequencing and review delays. Use an indicative 36–52 elapsed-week planning window to allow for dependencies, specialist review and provider consent/testing; validate with actual staffing and critical-path planning before committing dates. This is not a promise to implement in the design deadline. Lower staffing or delayed provider approvals requires replanning, not silent removal of scope.

Independent work may overlap only after its dependencies are approved: Academy content model can follow identity/permissions while CRM is built; provider sandbox feasibility can be investigated without live customer data while Proposal Studio is developed. Proposal delivery still depends on approved facts, pricing, artifacts, mail policy and permission checks. Google and Microsoft each require adapter-specific verification; one provider working does not satisfy the other.

## Proprietary ownership and dependency controls

OPA controls repositories, domain models, schemas, business rules, API contracts, deployment definitions and operational access for the future independent Pulse system. Every module has a code owner and operational runbook. General-purpose libraries, database engines, approved IdP and infrastructure services receive license/security/portability review; they do not delegate CRM ownership or require a CRM SaaS backend.

Keep an approved dependency inventory/SBOM, pinned reproducible builds, license review, secret scanning and software composition scanning. Reject CRM vendor SDKs, URLs, credentials and hidden background adapters in the initial implementation. Architecture tests enforce module imports and command/table ownership. CRM records must be readable/writable through Pulse without any external CRM service configured. No installation, deployment or production configuration changes are performed by this specification.

## Automated verification strategy

| Suite | Required cases / fixtures | Backlog and scenarios |
|---|---|---|
| Domain unit and property tests | Qualification gates, lead score explanation, stage reopen/history, hierarchy cycles, duplicate merge precedence; generated boundary inputs | B06–B07; T10–T11 |
| Identity and policy tests | Unique immutable People link, invitation replay, MFA/recovery, issuer/audience rejection, grant expiry and deny precedence across all roles/actions | B03–B04; T01–T09 |
| Database integration tests | Composite organization FKs, uniqueness, decimal constraints, transactions/outbox atomicity, row-policy filtering, isolation and stale revision rejection | B01/B04/B06–B08; T05/T10/T11/T28/T31 |
| API/event schema and consumer contracts | OpenAPI validation, field types/errors/pagination, idempotency conflicts, People sequence/replay/gaps, Connect signature and version compatibility | B01/B03/B08; T09/T28 |
| Workflow concurrency and fake-clock tests | All F01–F26, duplicate events, competing leases, retries/dead letters, cancellation, late replies, DST/quiet hours, revocation before external effect | B14/B16; T08/T17/T18/T22 |
| Financial unit/property tests | Fixed decimals, rounding, concession tiers/free months, tax unknown, FX snapshot, recurring normalization, forecast/GRR/NRR/cohort arithmetic | B11/B18; T13/T23/T24 |
| Proposal and content invariant tests | Immutable facts/content/assessment versions, author/reviewer separation, expiry/withdrawal, exact hash/recipients, PLANNED status and affected-version remediation | B09–B12; T12/T14/T20 |
| Document-generation regression | Five industry fixtures plus a sixth metadata-only industry; long names/Unicode/30-page tables, canonical text/totals, artifact hashes and macro/external-link removal | B11–B12; T15; automated checks plus mandatory human render QA |
| Mail/calendar adapter contract tests | Fake provider server: consent tenant mismatch, refresh/revoke, duplicate events, cursor expiry/resync, 429/5xx, ambiguous send timeout, verified aliases and event revision conflicts | B13–B15; T16–T19/T30 |
| Authorized provider sandbox tests | Separate Google Workspace and Microsoft 365 test mailboxes/tenants, real send/reply/receive/attachment/scheduling and consent revocation evidence | B13–B15; T16–T18; only after separate implementation/test-tenant approval |
| Role-based browser E2E | Employee activation → personal workspace → lead/deal → proposal review → exact approved send → handover; Academy assignment/assessment; deliberate suspension/withdrawal paths | B02–B21; T01–T22 |
| Security and privacy automation | Object-level attacks on reads/search/counts/files/jobs/AI, private mailbox protection, CSRF/XSS/SSRF/upload abuse, export revocation and legal-hold/tombstone behavior | B04/B20; T04–T09/T25/T26 |
| Evidence-grounded intelligence evals | Allowed source retrieval, citations to correct versions, missing evidence, injection attempts, no unauthorized tools/actions, deterministic fallback | B19; T26 |
| Analytics reconciliation | Source IDs reproduce scoped aggregates, event-time/asOf/FX revisions, hidden territory filtering, immature cohorts and late arrivals | B18; T23/T24 |
| Accessibility automation and human review | All 64 screens cataloged; semantic/contrast/keyboard checks, critical journeys at 360/768/1440 and 200% zoom; screen-reader review | B02/B20; T27; automated tools alone do not establish WCAG conformance |
| Performance and recovery | PRD sizing/p95 budgets, queue backpressure, provider outage isolation, DB/object restore consistency, revocation/tombstone reapplication and RPO/RTO evidence | B20; T08/T25/T27/T30 |
| Architecture and dependency tests | Pulse-only CRM commands, module/table boundaries, no customer/emergency credentials or network access, core functionality without third-party CRM/provider configuration | B01/B20; T29–T31 |

Use synthetic identities, institutions, capabilities and finance fixtures. Unit/integration suites run hermetically with disposable independent data stores and fake clocks/providers. Sandbox mail cannot target real customers. Fixtures must not read existing OPA APIs, databases, secrets, migrations or deployment pipelines.

## Coverage and phase gates

Maintain a machine-readable matrix linking 64 screen IDs, all 26 workflows, 31 acceptance scenarios, both mail providers and five industry templates to tests and owners. Cover each permission decision with positive and negative cases; every state transition needs valid/invalid/concurrent/replayed cases. Automate every endpoint's auth/error/contract checks. Require branch coverage ≥85% for changed domain/policy/workflow/financial code as a proposed floor; coverage is insufficient without the explicit invariants above. Any uncovered critical invariant blocks phase exit regardless of percentage.

Future independent Pulse CI runs fast unit/schema/policy checks per change and full database/browser/security suites before phase review; scheduled isolated stress/restore runs use only approved test environments. No existing customer-product pipeline is changed to host these checks. Dependency/secret findings and severity thresholds are approved by security; no unresolved critical/high vulnerability or access-control failure may be waived silently.

Failed deterministic tests block a phase. Quarantined flaky tests require owner, reason and repair date, and cannot replace a required permission/revocation/financial invariant. Persist reports, test seeds, content/renderer versions, contract revisions, screen/workflow coverage and approved exceptions. Provider sandbox and human document/accessibility reviews are explicit additional gates.

Phase 6 prepares evidence for founder review; implementation approval does not imply production release approval. A future release plan, infrastructure provisioning and live-data migration each require their applicable separate approval. Design consistency checks in validate-design.cjs are the only checks executed in this design revision; none of the future runtime suites is claimed to exist or pass.
