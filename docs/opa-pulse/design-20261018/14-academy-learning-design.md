# OPA Academy — learning and content operating model

Academy is the internal employee knowledge portal; OPA Library is its searchable governed resource collection. It is not a public customer training site. Module and path versions are reusable across roles and industries. Learning completion never grants production/customer system privileges automatically.

## Role-specific paths

| Path | Required modules in sequence | Assessment / completion evidence | Owner / visibility |
|---|---|---|---|
| Sales | Employee privacy/security → approved product facts/status → qualification and buying committee → industry discovery → proposal/quote controls → ethical mail follow-up | Scenario: choose correct claim wording, qualify synthetic lead, identify discount approval tier; 80% proposed + policy acknowledgement | Sales enablement; self and scoped manager progress |
| Business Development | Common security/facts → industry research and account hierarchy → source/consent and duplicate review → qualification/scoring → accepted handover to sales | Scenario: assign territory, resolve likely duplicate without merging prematurely, qualify institutional interest | BD enablement; self/BD manager |
| Technical Support | Common security/facts → approved product runbooks → troubleshooting evidence → customer data handling → escalation/handover | Scenario: diagnose synthetic symptom using scoped evidence; critical privacy questions must all pass | Support knowledge owner; self/support manager |
| Engineering | Common security/facts → architecture and boundary docs → evidence/release status → incident-safe technical documentation → product request sanitization | Scenario: author a VERIFIED claim with test evidence and scope; reject unsupported DEPLOYED label | Engineering documentation owner; self/engineering manager |
| HR | Common security/facts → People/Pulse identity lifecycle → onboarding paths → suspension/revocation → learning privacy and retention | Scenario: termination sequence beats stale activation, no payroll copied to Pulse | HR learning owner; onboarding summaries only |
| Management | Common security/facts → permissions/territory oversight → independent approvals → forecast/KPI provenance → coaching and privacy | Scenario: reconcile weighted pipeline, reject self-approval and private mailbox request | Management enablement; self/designated leadership |

Mandatory core path is assigned at approved activation; role additions create dated additional assignments. Transfers keep historic completion, remove access to unrelated restricted learning content and assign delta modules; no blanket reset. Suspension blocks interactive access; reactivation after current People clearance reconciles grants and learning versions. Departed employee learning records follow privacy-approved retention.

Industry libraries initially cover estates, schools, banking, oil/gas and aviation, each with discovery questions, buying committee guide, approved fact selections, explicit exclusions, proposal template resources, objection FAQ and handover checklist. Add a new industry by taxonomy/configuration and independent content approval. Industry playbooks must not invent industry certifications or current OPA capabilities.

## Content types and governance

Content types: product documentation, capability fact, industry playbook, technical runbook, proposal section/visual, FAQ, assessment, demo resource and policy acknowledgement. Each item has stable ID, owner and backup, audience, industry/product tags, immutable content version, source/evidence, author, reviewer, approval date, review due/expiry, supersedes relation, locale and classification.

Draft → review → approved → superseded/retired. Author and reviewer must differ. Product facts require technical evidence review; pricing/proposal resources also require commercial review; HR policies remain HR-owned without exporting payroll. Proposed cadence: product facts every 90 days or on release, commercial templates every 90 days, technical runbooks every 180 days, HR policies per approved policy calendar. Expiry is explicit, not inferred from cadence alone.

Library search displays version/status/review due and excludes unauthorized content before snippets/counts. Historical versions are available to authorized auditors and employees' learning history with clear superseded banner. Customer-facing export uses only release-approved resources and strips internal annotations/evidence URLs. Proposal Studio inserts immutable references, never retrieves arbitrary draft Library prose as a factual claim.

## Assessment, progress and review behavior

Path snapshot pins module and assessment versions, prerequisites and required versus optional status. Progress states: not_started/in_progress/submitted/passed/needs_remediation/exempt/overdue. Opening a page alone does not prove completion. Completion requires acknowledgement plus assessment where configured. Server grading/rubric version is immutable; question bank randomized without exposing correct answers. Proposed 80% pass, critical privacy/security questions all correct, three attempts/day then 24h cooldown; domain owners approve actual policies.

Accessibility: assessments support keyboard/screen readers, untimed default, approved accommodations without publishing sensitive reasons. Track start/submission/score/attempt/version; avoid keystroke or browsing surveillance. Manager sees assigned-path completion/overdue status and necessary coaching outcomes, not unrelated answers or HR documents. Detailed answer access requires assessor grant.

Exemptions require independent owner approval, reason, expiry and evidence, and never bypass mandatory identity/MFA controls. A significant new required version creates a new assignment; minor typo corrections can preserve completion only through approved equivalence mapping. Do not rewrite the prior attempt.

Content withdrawal identifies affected proposals and learners. Product/Ops decide whether to issue corrections, retrain or contact customers; external remediation messages still require human approval. Analytics exposes coverage and overdue content separately from employee progress, so poor content availability is not blamed on learners.

## People and Proposal Studio contracts

People activation/transfer events carry opaque employee ID, department/approved role and sequence; Academy resolves an approved path-mapping version. Assignment effect key = producer event + employee + path version. Completion event returns employee opaque ID, assignment/path version, completion timestamp and result summary to authorized People onboarding workflow; answers and private CRM/mail content are excluded.

Proposal content lineage = proposal version → section version → capability/content version → evidence version → reviewer. A fact's expiry/withdrawal blocks new releases and scheduled sends using it. Historic delivered versions retain their exact wording and status-at-delivery, with current warning/remediation link rather than silent replacement.
