# Product requirements

## Purpose and success

OPA Pulse is the internal commercial system for institutional acquisition and customer expansion, with OPA Academy as its governed knowledge foundation and Pulse Mail as each employee's authorized business conversation workspace. It serves Nigeria first and supports Africa/global operations through currencies, time zones, localization and country-specific policy configuration. It must never inherit customer Super Admin, Facility Operator or emergency responder privileges.

Proposed pilot targets, measured against a four-week baseline: 95% of open opportunities have owner/next action/date; 30% lower median time from qualified brief to approved proposal; 90% of follow-ups completed within agreed SLA; 100% of customer proposals contain approved, evidence-backed capability versions; 100% of active users have unique employee accounts with MFA; zero unauthorized cross-territory or mailbox reads in release tests. Sample size, baseline period and exclusions accompany the report; targets are not guarantees.

## Users and jobs

| Persona | Core job | Primary outcome |
|---|---|---|
| Business Development | Capture institutional interest, research account relationships, qualify | Accepted, deduplicated lead with evidence and accountable next action |
| Sales Executive | Advance assigned accounts, prepare meetings, send approved proposals | Traceable deal progression and timely conversations |
| BD/Sales Manager | Allocate territory, coach team, approve within limits | Healthy pipeline, accountable forecast and appropriate access |
| Commercial Operations | Curate catalog, pricing, imports, approvals and handover | Consistent commercial records and reliable operations |
| Executive | Inspect revenue, risks, cohorts and product demand | Explainable decisions with scoped drill-down |
| Support/Engineering | Learn, curate technical evidence, accept authorized handover | Accurate claims and implementable commitments |
| HR | Drive identity lifecycle and learning assignment through People | Timely onboarding and immediate revocation without exposing payroll |

## Functional requirements

P01: Personal workspace displays own tasks, assigned leads/deals, calendar and learning; filters persist per employee. Manager view is explicitly labeled and scoped. No shared login.

P02: Account hierarchy supports legal organization, parent/subsidiary, branches and buying committee relationships (sponsor, economic buyer, procurement, technical evaluator). Store industry taxonomy and country; support multiple industries. Prevent hierarchy cycles. Contacts can relate to multiple branches with dated roles.

P03: Lead capture accepts manual entry and reviewed import; owner assignment obeys territory/routing version. Qualification records need, authority, budget range, timing, source and consent context. Scoring is explainable, versioned and advisory; missing data is distinct from a low score. Proposed score: fit 0–40, confirmed need 0–25, engagement 0–20, timing 0–15; no sensitive personal traits. Manager can override with reason.

P04: Opportunity pipeline: Discovery → Qualified → Solution Fit → Proposal → Negotiation → Won/Lost. A pilot is a linked evaluation, not an automatic Won. Discovery→Qualified requires buying contact, need and next action; Proposal requires package and approved facts; Negotiation requires approved proposal version; Won requires signed contract reference, currency/lines, service dates and handover owner. Lost requires reason and closed date. Reopen requires manager reason; retain original stage history and reporting snapshots.

P05: Duplicate candidates use normalized domain/legal name/country, email, verified external ID and branch context. Show confidence/reasons; no automatic destructive merge. Commercial Operations previews field precedence, relationships, grants and history before merge. Audit canonical IDs and redirect references; preserve deny restrictions and legal holds.

P06: Command center shows pipeline/forecast, contracted recurring value, win/loss, stage aging, territory/rep performance and renewal risk. Every tile includes currency basis, as-of, coverage, permissions and source drill-down. Missing billing source means booked recurring value, never realized revenue.

P07: Proposal Studio assembles versioned industry templates and immutable approved capability facts. Quotes support NGN default plus ISO currencies; discounts/FX/tax are explicit inputs with approval. DOCX/PDF generated from the same approved snapshot. Editing, withdrawal or fact expiry prevents customer delivery until approval is renewed.

P08: Pulse Mail handles inbox, sent, drafts, compose/reply, approved attachments, signatures/templates and scheduled sending through authorized Google Workspace/Microsoft 365 business mailboxes. Scope each connection to an active employee; private mail is separate from selected company CRM conversation records. Manager reporting does not disclose private message bodies. No custom SMTP infrastructure or shared mailbox passwords.

P09: External messages are explicit human sends or individually approved automation payloads. Approve sender, recipients, subject, body, attachment hashes and send time/window; changes invalidate approval. No autonomous outreach. Receiving customer mail does not constitute consent to future marketing.

P10: Academy supports Library, product facts, industry playbooks, proposal resources, technical documentation, FAQs, assessments and progress. Versioned owner/reviewer/review date/audience/approval are mandatory. Sales, BD, Support, Engineering, HR and Management have distinct learning paths. Acknowledgements and attempts are pinned to content versions. An expired fact cannot be reused for a new proposal.

P11: People emits minimum employment/access events; Pulse handles invitation, activation, login, password/MFA, recovery, profile, preferences and sessions. Suspension/termination immediately fences local access, queued work and mailbox use. No payroll fields or unrestricted HR documents enter Pulse.

P12: HubSpot import/export preserves external IDs, associations, owners, custom industry/stage mappings and currency; dry-run validation, conflicts and row errors precede application. One chosen source of truth per object/field; never run competing bidirectional masters.

P13: Product requests can link to GitHub using a sanitized summary and opaque request ID. Customer identity, email, contract amounts, attachments and message text remain private. Future Connect contracts are explicit external adapters; no existing customer API is modified.

## Nonfunctional acceptance budgets

Proposed sizing envelope: 500 employees, 100,000 accounts, 1 million contacts, 250,000 opportunities, 10 million activity records; validate before infrastructure procurement. At 100 concurrent users, authenticated list/detail p95 ≤800 ms server latency; dashboard cached p95 ≤2 seconds; search p95 ≤1.5 seconds; mail synchronization freshness target ≤5 minutes excluding provider outages; document generation p95 ≤60 seconds for 30 pages. Proposed monthly availability 99.9%, RPO ≤15 minutes, RTO ≤4 hours after disaster declaration. No production SLA is implied.

WCAG 2.2 AA target, keyboard complete, screen-reader names, 200% zoom, responsive 360/768/1440 widths, timezone-aware dates and low-bandwidth progressive loading. Read-only cached summaries may show age; never accept offline approval/send. No PII in offline caches by default.

## Build versus buy

Evaluate HubSpot-first against custom Pulse before coding: total three-year licenses/operations, mailbox privacy granularity, identity termination behavior, proposal fact/version enforcement, Academy governance, data residency/export and integration maintenance. Run the same synthetic scenarios against both. HubSpot-first reduces core CRM build burden but custom governance and licensing require validation; custom Pulse offers integrated control but creates substantial security/provider obligations. Proposed design is modular custom Pulse with a migration adapter; founder must choose based on measured trial and cost. Do not duplicate master contacts while evaluating.

Out of scope: emergency dispatch, EstateFlow/mobile changes, payroll calculation, live employee onboarding, live customer imports, accounting ledger/revenue recognition, payment collection, autonomous campaigns and production implementation. Founder approval of this design precedes any prototype or implementation.
