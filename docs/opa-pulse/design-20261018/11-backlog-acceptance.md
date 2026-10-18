# Phased implementation backlog and acceptance criteria

Everything below is future work after founder design approval. Estimates are relative complexity (S/M/L), not release promises. No implementation or deployment is authorized here. Teams/owners are proposed responsibility roles, not assignments to named employees.

| ID / phase | Slice / owner / size / dependencies | Definition of acceptance |
|---|---|---|
| B00 / 0 | Founder decisions and build/buy trial; founder/Ops, M | Approve scope/limits/retention/IdP/region; run synthetic scenarios for HubSpot/custom and record total cost, gaps and master-data choice |
| B01 / 0 | Dedicated boundary and contract schemas; platform/security, M; B00 | OpenAPI/event schemas validate; separate issuer/audience/data/secrets/storage; customer tokens rejected; no production dependencies |
| B02 / 0 | Design system/accessibility shell; UX, M; B00 | All navigation roles, responsive 360/768/1440 and 200% zoom; keyboard/focus, contrast and table/chart alternatives verified |
| B03 / 1 | Employee identity/lifecycle; identity/security, L; B01 | Unique People link, invite/activation/login/recovery/password/MFA/session/profile/preferences, immediate local revocation and reconciliation tests pass |
| B04 / 1 | Permissions and territory grants; security/CRM, L; B03 | Role/action/object/field policy, transfer/reassignment history and search/job/download ACL tests pass; no self-grant |
| B05 / 1 | Personal workspace/tasks/calendar shell; CRM, M; B03–04 | Own leads/deals/tasks/learning visible; team oversight explicitly scoped; no other mailbox/private notes |
| B06 / 2 | Accounts/branches/contacts/dedup; CRM/Ops, L; B04 | Hierarchy cycle blocked; buying committee multi-links; duplicate preview/merge retains ACL/history; contact minimization |
| B07 / 2 | Lead/opportunity lifecycle; CRM, L; B06 | Scoring explainable, gates enforced, convert idempotent; pilot distinct; reopen preserves stage history/next action |
| B08 / 2 | Import/export compatibility; integration/Ops, M; B06–07 | HubSpot external IDs/associations/owner/currency/stage round-trip reconciles; dry run and row errors; export approval/expiry |
| B09 / 3 | Academy content/fact registry; product/learning, L; B04 | Six role paths, versioned audience/evidence/owner/expiry, independent approval; LIVE/IN DEVELOPMENT mapping cannot overstate facts |
| B10 / 3 | Assessments/onboarding progress; learning/HR, M; B03/B09 | Version-pinned attempts, server grading, configurable retry/remediation and manager/HR progress summary only; dedup assignment |
| B11 / 3 | Proposal templates/quotation; commercial/product, L; B07/B09 | All five industries + sixth metadata-only template work; recurring/setup/discount/tax/FX/rounding gates; no unsupported claims |
| B12 / 3 | Approval/version/render/release; commercial/security, L; B11 | Same content snapshot produces verified DOCX/PDF; diff/hash/independent approver; edits/expired facts/withdrawals block delivery |
| B13 / 4 | Google/Microsoft delegated mail; integrations/security, L; B03/B04 | Authorized business account compose/send/receive/reply/attachments; exact sender ownership; sync recovery/dedup/revocation; no private mailbox leakage |
| B14 / 4 | Templates/signatures/scheduled sends; mail/commercial, M; B12/B13 | Exact human approval; recipient/body/hash/schedule edits invalidate; cancel/reply/suspension suppress; unknown send outcome reconciled |
| B15 / 4 | Calendar integration and meeting briefs; integrations/CRM, M; B05/B13 | Separate consent, timezone/DST/revision conflicts, reviewed tasks and evidence summaries; no silent calendar write |
| B16 / 5 | Durable workflows F01–F26; platform/Ops, L; relevant modules | Inbox/outbox, leases, effect dedup, replay/late event/dead-letter/approval expiry; external effects independently gated |
| B17 / 5 | Handover/renewals/expansion; commercial/implementation, M; B07/B12 | Signed evidence and accepted handover, renewal tasks 90/60/30, no emergency/customer auto-provisioning |
| B18 / 5 | KPIs/forecast/provenance; analytics/finance, L; B07/B17 | Dictionary reconciles to fixtures; currency/coverage/ACL and snapshot drilldown reproduce values; recognized revenue unavailable without ledger |
| B19 / 5 | Evidence-grounded intelligence; product/security, M; B09/B18 | AI drafts cite authorized versions, resist injected instructions, human review and deterministic fallback; no autonomous tool effects |
| B20 / 6 | Security/privacy/recovery verification; security/privacy, L; all | Threat tests, retention/holds, backup restore, token key rotation, access review, performance and incident drill meet agreed budgets |
| B21 / 6 | Founder UAT and release proposal; founder/Ops, M; B20 | Synthetic UAT signed, unresolved material defects visible; independent implementation rollout authorization required; no design approval implies deployment |

## Mandatory acceptance scenarios

| Test ID | Given / when / then |
|---|---|
| T01 Unique account | Given People employee A, duplicate invite or repeated event → one identity; reused email for employee B cannot inherit A's data |
| T02 Invite security | Expired/used/replayed invite or unknown employment → no activation; generic recovery response does not reveal account existence |
| T03 MFA/recovery | Password reset with lost MFA → no MFA bypass; independently verified recovery required; prior sessions revoked |
| T04 Boundary | Customer Super Admin/Facility Operator token or forged internal role → 401/403; no customer/emergency session reuse |
| T05 Personal scope | A requests B's tasks/deal outside grant, search result, count, attachment or export → denied without object disclosure |
| T06 Manager privacy | Manager/exec/admin reads employee private mailbox or payroll → denied; approved CRM snapshot alone visible |
| T07 Transfer | Territory transfer effective now → old grants/cache revoked, new grants independently approved; historical credit preserved |
| T08 Revocation race | Paused queued send/export/approval worker, then employee suspended → session denied and resumed worker makes no provider call; already-accepted send is audited |
| T09 Lifecycle ordering | Termination sequence 14 followed by activation sequence 13 or duplicate event → remains terminated; mismatched duplicate hash alerts |
| T10 Qualification | Missing required need/contact/next action → transition blocked; concurrent conversion with same key yields one opportunity |
| T11 Merge safety | Conflicting account restrictions/holds → preview warns and merged result cannot broaden audience or erase history |
| T12 Proposal truth | Expired/revoked/planned fact inserted as verified → blocked; legitimate PLANNED appendix needs product approval/non-commitment |
| T13 Quote controls | Effective concession >15% via free months → executive tier required; tax unknown/price expired → release blocked |
| T14 Approval integrity | Reviewer is author or edits happen after approval → approval rejected/stale, DOCX/PDF artifacts cannot release |
| T15 Industry export | Five templates, long names/Unicode/30 pages → totals/text match canonical snapshot, no clipping, internal notes or private links |
| T16 Mail sync | Duplicate notifications, expired Gmail history, Graph delta reset and rate limit → bounded resync/no duplicate messages, visible freshness |
| T17 Send uncertainty | Provider accepts but client times out → outcome_unknown/reconciliation, no blind retry or false delivered badge |
| T18 Mail authorization | Wrong tenant/sender alias, stale consent, suspended employee → no send or sync; scheduled payload changed → reapprove |
| T19 CRM mail sharing | Owner links selected reply → only previewed snapshot/audience shared; next reply remains private |
| T20 Academy governance | Technical author tries self-approve or stale fact → denied; new required content version prompts reassignment without rewriting historical pass |
| T21 Learning isolation | Sales manager requests Engineering/HR unrelated attempts/answers → denied; assigned progress summary allowed |
| T22 Workflow replay | F01–F26 duplicate/retry/dead-letter after cancellation → no duplicate local effect; no outbound without valid exact approval |
| T23 Analytics | Fixture pipeline 25m/weighted10.2m/Won4m → forecast14.2m; win6/loss4/open8→60%; retention fixture→85%/105% |
| T24 Analytics scope | Hidden territory excluded before aggregation; changing scope/FX/asOf changes provenance and reproducible rows, no leaked totals |
| T25 Privacy/export | Grant removed during export → render/download denied; legal hold prevents purge; restore reapplies tombstones |
| T26 Untrusted input | Email HTML/attachment/AI prompt requests secrets or cross-mailbox tools → no execution/access; sanitized preview and reviewed output |
| T27 Accessibility/load | All critical flows keyboard/screen reader at target widths/zoom and PRD load envelope → agreed budgets pass with evidence |
| T28 HubSpot/Connect | Repeat import/webhook with same key → one mapped effect; conflicts/quarantined PII don't publish to GitHub |

## Verification gates

Phase exit requires contract/policy tests for changed boundary, deterministic financial fixtures, workflow fake-clock/replay tests and relevant accessibility checks. Provider sandbox tests use authorized test tenants after implementation approval. DOCX/PDF require render-and-visual QA, not text extraction alone. No tests have been run against existing production systems. Founder UAT walks W01→C08→C10→P03→P05→M03 and I01→A04 with a deliberate suspension/expired-fact scenario.
