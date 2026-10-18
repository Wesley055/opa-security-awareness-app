# Dependencies, risks, decisions and handover

## Decision log

| ID | Decision / status / rationale | Review gate |
|---|---|---|
| D01 | Proposed independent internal modular monolith with dedicated employee IdP realm/data/keys | Founder/security approve before implementation; never reuse customer auth |
| D02 | Proposed custom Pulse UX with HubSpot interoperability, pending build/buy trial | Founder compares licenses/operations/control requirements |
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
| R07 | Custom CRM cost/complexity outweighs licensed option; medium/high | Founder/Ops; phase-0 cost and scenario trial, modular adapter, single master choice |
| R08 | Currency/tax/retention policy unapproved; high/high | Finance/privacy; configurable versioned defaults, no assumed tax/legal compliance; blocks live quotes/data |
| R09 | Analytics confuse pipeline/bookings/revenue or leak hidden scope; medium/high | Analytics/finance; dictionary, source reconciliation, FX versions and unavailable states |
| R10 | Academy becomes stale/unowned or mandatory training excessive; medium/medium | Learning/product owners; review due/expiry, role paths, evidence reuse and remediation |
| R11 | DOCX/PDF differ, clipping/unsupported accessibility; medium/high | Commercial/UX; canonical content and visual QA all industries; no renderer capability promises without test |
| R12 | HubSpot ownership/mapping conflicts, duplicate contacts; high/medium | Ops; dry run, authority map, external keys, staged reconciliation and no automatic delete |
| R13 | Excessive confidential detail published to GitHub; medium/high | Product/security; sanitized allowlist and human preview; issues only engineering metadata |
| R14 | Independent work contaminates EstateFlow E2E; low/critical | Project owner; no existing file/schema/pipeline edits, no live probes, separate repository and no merge/deploy |
| R15 | AI vendor region/retention or prompt injection; medium/high | Security/privacy; live-data processing disabled until approved, scoped evidence/human review |
| R16 | Founder timeline interpreted as production commitment; medium/high | Founder; package is design review baseline; backlog requires staffing/estimation and separate approval |
| R17 | OneDrive directory persistence/local Git has no history; observed/medium | Design owner; permitted visualization-root design repository/worktree; no alteration of source Git |
| R18 | API behavioral spec not yet machine validated; certain/medium | Platform owner; phase 0 OpenAPI schemas and contract tests, before application implementation |

## Handover checklist

The founder reviews scope and static boards, then product/technical owners review facts/templates, finance reviews quote/KPI policy, security/privacy review identity/retention/integrations, and implementation owners estimate backlog. Record each approval with reviewer/date/version and conditions. No automatic transition from approved design to production rollout.

Open decisions: build/buy; IdP vendor/internal realm; People event producer and on-call owner; actual product evidence owners; approval thresholds; countries/hosting and cross-border policy; retention defaults; provider licenses/scopes; finance data source and taxes; official OPA brand assets; staffing and priorities. These are deliberate gates with proposed defaults, not hidden completed work.

No existing API, product, mobile, EstateFlow, Command Center, production data/migration or deployment configuration was modified by this design work. No merge, deploy, outreach or live mailbox authorization occurred. Sunday EstateFlow physical E2E schedule remains outside this package.

## Founder review agenda

Review screens R01/W01/C03/C10/P03/M02/A01/I06, walk two acceptance flows from UX spec, examine planned-capability and employee-suspension failure cases, approve or revise gates, then authorize a separate phase-0 implementation task if desired. Approval is not requested for deployment.
