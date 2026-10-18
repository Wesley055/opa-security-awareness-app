# Dependencies, risks, decisions and handover

## Decision log

| ID | Decision / status / rationale | Review gate |
|---|---|---|
| D01 | Proposed independent internal modular monolith with dedicated employee IdP realm/data/keys | Founder/security approve before implementation; never reuse customer auth |
| D02 | FINAL founder decision: fully proprietary, OPA-owned and independently operated Pulse is the authoritative CRM; third-party CRM evaluation/dependencies/synchronization removed | Decision closed; implementation and deployment require separate approval, not a renewed vendor decision |
| D03 | Proposed per-user delegated Workspace/M365 integration, no custom SMTP or broad app mailbox access | Provider admin consent/license/security assessment before live setup |
| D04 | Proposed canonical DEPLOYED/VERIFIED/PILOT/PLANNED fact status plus source maturity metadata | Product owners validate actual facts; no catalog claim certified by design |
| D05 | Proposed independent approvals tied to exact versions/hashes and send payload | Founder approves threshold defaults; no self-approval |
| D06 | Proposed People minimal events and auth-epoch fence, fail closed on stale lifecycle health | People contract authority and operational revocation SLO need agreement |
| D07 | Proposed retention, hosting, AI and commercial policy defaults | Privacy/legal/finance/security review; unresolved policies block live use |
| D08 | Design-only static boards, no functional prototype or production implementation | Founder design review precedes coding as required by #42/#45 |
| D09 | Separate local design repository/worktree due unborn source Git and OneDrive directory limitation | Preserve original workspace; remote design artifacts must remain on dedicated nonrelease branch |

## Dependency and risk register

| ID | Risk / likelihood / impact | Owner / mitigation / gate |
|---|---|---|
| R01 | Undefined employee IdP/People lifecycle authority; medium/critical | Identity owner; signed schemas, unique opaque links, emergency suspend and missing-event tests before any access |
| R02 | Revocation event delayed or provider send already accepted; medium/high | Security; synchronous local fence on receipt, stale heartbeat outbound stop, race disclosed and monitored |
| R03 | Google restricted scopes verification/distribution obligations or M365 tenant consent block; high/high | Integration owner; minimum scopes, test tenant feasibility, assessment/licensing before promise of live Mail |
| R04 | Duplicate/unknown provider send after timeout; medium/high | Mail owner; reconciliation state machine, no blind retry, employee resolution |
| R05 | Manager/executive mailbox/PII leakage through search, AI or exports; medium/critical | Security; unified object/field policy and adversarial tests before release |
| R06 | Unsupported product claims/expired evidence enter proposals; high/high | Product owner; immutable approved facts, scoped status, withdrawal remediation and exact artifacts |
| R07 | OPA bears full proprietary CRM delivery, maintenance and operational load; high/high | Engineering/Ops; module owners, funded test/operations capacity, phase gates and revised estimates in document 15; mitigate delivery risk without reopening the final architecture decision |
| R08 | Currency/tax/retention policy unapproved; high/high | Finance/privacy; configurable versioned defaults, no assumed tax/legal compliance; blocks live quotes/data |
| R09 | Analytics confuse pipeline/bookings/revenue or leak hidden scope; medium/high | Analytics/finance; dictionary, source reconciliation, FX versions and unavailable states |
| R10 | Academy becomes stale/unowned or mandatory training excessive; medium/medium | Learning/product owners; review due/expiry, role paths, evidence reuse and remediation |
| R11 | DOCX/PDF differ, clipping/unsupported accessibility; medium/high | Commercial/UX; canonical content and visual QA all industries; no renderer capability promises without test |
| R12 | Duplicate or corrupt OPA-native intake damages authoritative records; medium/high | CRM/Ops; versioned schemas, file-hash/row-key dedup, approved preview, Pulse revision checks and quarantine; no external CRM master/write-back |
| R13 | Excessive confidential detail published to GitHub; medium/high | Product/security; sanitized allowlist and human preview; issues only engineering metadata |
| R14 | Independent work contaminates EstateFlow E2E; low/critical | Project owner; no existing file/schema/pipeline edits, no live probes, separate repository and no merge/deploy |
| R15 | AI vendor region/retention or prompt injection; medium/high | Security/privacy; live-data processing disabled until approved, scoped evidence/human review |
| R16 | Founder timeline interpreted as production commitment; medium/high | Founder; package is design review baseline; backlog requires staffing/estimation and separate approval |
| R17 | OneDrive directory persistence/local Git has no history; observed/medium | Design owner; permitted visualization-root design repository/worktree; no alteration of source Git |
| R18 | API behavioral spec not yet machine validated; certain/medium | Platform owner; phase 0 OpenAPI schemas and contract tests, before application implementation |
| R19 | Proprietary module coupling or provider outages contaminate core CRM; medium/high | Platform owner; command/table ownership and architecture tests, isolated adapter queues, provider-disconnection tests T29–T31 |
| R20 | Preliminary effort exceeds staffing/budget or misses dependencies; high/high | Delivery owner; 112–166 baseline engineering/QA person-weeks plus 20% reserve, refine after phase 0; preserve approved scope and phase approval rather than silently omit features |

## Handover checklist

The founder reviews scope and static boards, then product/technical owners review facts/templates, finance reviews quote/KPI policy, security/privacy review identity/retention/integrations, and implementation owners estimate backlog. Record each approval with reviewer/date/version and conditions. No automatic transition from approved design to production rollout.

Open decisions: IdP/internal realm; People event producer and on-call owner; actual product evidence owners; approval thresholds; countries/hosting and cross-border policy; retention defaults; mail/calendar provider licenses/scopes; finance data source and taxes; official OPA brand assets; staffing, budget and priorities. Proprietary CRM ownership and authority are final and excluded from open decisions. Remaining gates use proposed defaults, not hidden completed work.

## Revision v1.1 — final founder direction

Supersedes v1.0's CRM vendor evaluation, compatibility adapter and synchronization requirements. Pulse owns accounts, contacts, leads, opportunities, proposals and commercial activity. Initial B00/B08/T28 now cover proprietary delivery planning/native governed intake; T29–T31 enforce CRM authority, provider independence and module boundaries. Full 64-screen scope remains; Google/Microsoft are mail/calendar options only. Revised implementation/testing estimates are in document 15. No customer-facing product or production infrastructure changes are part of this revision.

No existing API, product, mobile, EstateFlow, Command Center, production data/migration or deployment configuration was modified by this design work. No merge, deploy, outreach or live mailbox authorization occurred. Sunday EstateFlow physical E2E schedule remains outside this package.

## Founder review agenda

Review screens R01/W01/C03/C10/P03/M02/A01/I06, walk two acceptance flows from UX spec, examine planned-capability and employee-suspension failure cases, approve or revise gates, then authorize a separate phase-0 implementation task if desired. Approval is not requested for deployment.
