# Automation workflow catalog

Every workflow has versioned trigger/conditions/actions, owner, policy, dedup effect key, audit and cancellation condition. Internal notification is distinct from an external customer message. All customer messages require exact human approval; templates or enrollment in a sequence are insufficient. Proposed SLA thresholds are configurable business policy, not accepted service commitments.

| ID / trigger | Conditions → actions | Owner / timing / approval / dedup |
|---|---|---|
| F01 Lead created | Active approved territory owner → assign or exception queue | BD Manager; ≤15 min target; key lead+assignment-policy version; no customer send |
| F02 Lead unassigned 4 business hours | Still unassigned → manager task; 1 business day → Ops escalation | BD Manager; Lagos business calendar default, local holiday config; one effect per escalation level |
| F03 Next action due | Active assignee → reminder; overdue +1 business day → manager notice | Sales Manager; key task+due revision+threshold; completion/reassignment cancels |
| F04 Opportunity stalled | No meaningful shared activity 14 days AND open stage → owner/manager review | Sales Manager; nightly; email opens alone not meaningful; stage/activity change resolves |
| F05 Meeting approaching | Meeting accepted, record permission → reviewed brief from shared CRM and approved facts | Owner; 24h/1h; AI draft with evidence; never ingest private colleague mail |
| F06 Meeting completed | Employee reviews notes → explicit actions/tasks and optional follow-up draft | Owner; same day; external follow-up needs exact approval; meeting+action ID |
| F07 Proposal submitted | Valid version/hash → independent technical/commercial approval routes | Ops; 2 business day target, delegate/escalate at 1/2 days; never auto-approve |
| F08 Quote thresholds exceeded | Total concession/nonstandard terms → required higher tier | Ops; block release until all decisions; quote hash+policy |
| F09 Proposal approved | Facts/prices current → render/scan/QA → releasable bundle | Ops; format-specific hashes; render retries safe; no customer send |
| F10 Contract signed / Won | Valid evidence, implementation owner → handover checklist | Sales + implementation manager; target 2 business days; rejection returns scoped remediation, no automatic existing product provisioning |
| F11 Renewal approaching | Active subscription, renewal date → 90/60/30-day owner tasks and risk review | Account owner; each subscription+date+threshold; messages separately approved |
| F12 Expansion signal | Approved usage/commercial evidence or request → suggested opportunity | Owner; reviewed before creation; never infer sensitive personal attributes |
| F13 Employee approved | Current People sequence + approved grants → invite and role path | HR/manager; source event+employee+path; security invite uses approved transactional channel, no customer outreach |
| F14 Employee suspension/termination | Higher-priority lifecycle event → fence, revoke sessions, cancel sends/jobs, disconnect tokens, reassign company tasks | Security; synchronous fence on receipt; employee+status sequence; tokens never transferred to manager |
| F15 Employee transfer | Effective-dated department/manager/territory → grant diff review and learning reassignment | HR + managers; removing grants immediate, added grants require approval; no private mail transfer |
| F16 Mail provider change | Valid notification → incremental sync → suggestions for CRM links | Mail operations; provider-event/checkpoint dedup; notification duplicate safe; no automatic private→shared promotion |
| F17 Scheduled send due | Active identity, valid approval/hash, authorized sender/recipient, scan and capability valid → provider send | Employee; exact scheduled timezone; intent ID; unknown outcome pauses/reconciles, no blind retry |
| F18 Customer reply received | Owned thread matched → cancel unsent follow-up suggestion and create review task | Employee; message+intent key; do not leak body to manager notification |
| F19 Mail follow-up deadline | No observed reply and intent active → owner reminder/draft | Employee; reply detection uncertainty visible; send requires fresh approval |
| F20 Content review due | Review date minus 14 days → owner task, expiry → block new fact use | Product/Academy owner; content version+threshold; notify affected proposal owners |
| F21 Content withdrawn | Enumerate affected proposal versions/learning → block release, remediation review and reassignment | Product owner + Ops; delivered docs remain auditable; no automated customer correction send |
| F22 Assessment submitted | Server-grade immutable attempt → progress, remediation or completion event | Academy owner; pass default 80%, max 3 attempts/day proposed, 24h after third fail; policy configurable |
| F23 Import/export requested | Authorized preview and independent approval → apply/scoped file | Ops/privacy; job+preview hash; partial failure report, no all-or-nothing claim across remote systems |
| F24 Product request approved | Sanitized preview → narrowly scoped GitHub issue/link | Product owner; request ID+destination; no raw customer or employee evidence |
| F25 Retention deadline | No legal hold + approved policy → purge eligible cache/object/projection | Privacy/security; two-person destructive approval; purge evidence without retained PII |
| F26 Lifecycle/provider heartbeat stale | Threshold exceeded → block entitlement increases/outbound effects, alert operations | Security; heartbeat epoch; restoration requires reconciliation before release |

## Execution semantics

Run states pending/running/waiting_approval/scheduled/succeeded/failed/cancelled/dead_letter/outcome_unknown. A workflow step stores input versions and hash, attempt count, lease owner/expiry, actor/effective principal, policy epoch and effect key. Side effects use transactional outbox where local; approvals expire after 7 days proposed or subject expiry, whichever first. Approvals cannot survive payload changes, employee suspension, scope loss or proposal withdrawal.

Business clocks store timezone/calendar version; scheduled sends store absolute UTC and original timezone/local intent. DST ambiguity prompts selection; nonexistent local time is invalid. Monthly recurrence uses explicit end-of-month policy. Quiet hours delay noncritical internal notifications, never security revocation.

Retries respect adapter Retry-After and backoff; cancelled jobs cannot be resurrected by dead-letter replay. Operator replay requires reason, fresh policy check and same dedup key. For accepted-but-timeout email, reconcile provider Sent/message metadata against stored intent and message identifier; if not conclusive, outcome_unknown requires employee resolution. Local idempotency cannot guarantee a remote provider won't duplicate if its API lacks an idempotency guarantee.

## AI assistance

Allowed: meeting briefs, evidence-linked summaries, objection grouping, proposed learning suggestions and opportunity-health explanations. Input retrieval is permission-scoped; private mail only for its owner with consent. Output includes source record/version links, time window, missing evidence, draft status and reviewer. No invented product facts, external send, deal-stage change, employee evaluation or autonomous permissions. Malicious instructions in inbound email/docs are treated as data; tools cannot act on them. AI model/vendor, retention, region and contractual terms require approval before any live data processing. Deterministic non-AI fallback remains available.
