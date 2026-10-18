# Screen inventory and UX specification

## Design language

Premium internal product: ink navy #10233F navigation, porcelain #F5F7FA canvas, white surfaces, teal #087F72 primary action, gold #B68628 emphasis, readable #24344A body. Gold is decoration, not small body text. Final color combinations require automated contrast validation; target 4.5:1 normal text and 3:1 large text/control boundaries. Use system sans with licensed brand font only when supplied. 8px spacing scale, 12px surface radius, 1px borders, restrained shadow; 28/22/18 headings, 14–16 body, tabular numerals. No unverified OPA logo assets copied from existing products.

Desktop: 232px sidebar, 64px topbar, max 1600px workspace and 24–32px gutters. Navigation: My Workspace, Revenue, CRM (Accounts/Leads/Pipeline), Proposals, Mail, Calendar, Academy, Analytics; Administration appears by grant. Global search, create action, task notifications and employee menu are persistent. Show current scope and identity; no ambiguous shared workspace identity.

Mobile: single-column cards, persistent page title and action, navigation drawer, stacked details, accessible table-to-list view. Dense pipeline becomes stage-filtered list at <768px; do not require drag-and-drop. Financial tables allow labeled horizontal scrolling. No native mobile application is part of this scope.

## Universal behavior and states

Every screen below inherits: skeleton with layout stability; genuine empty state with permitted next action; filtered-empty state with clear filters; retryable network error with correlation ID; 401 reauthentication; 403 safe access message; 404 without object disclosure; stale/version conflict preserving draft; disconnected integration status; accessible validation summary focusing first invalid field. Destructive actions require consequence review and reason. Unsaved changes guard navigation; drafts save status is explicit. Do not display fabricated zero for missing data.

Keyboard: landmarks/skip link, visible focus, logical tab order, ESC closes modal and restores focus, focus trapped in modal, labeled inputs and error associations; tables have header scopes/sort announcements. Status badges include text and icon. Charts have equivalent tables; trend arrows include period/basis. Async changes announce through polite live region. All controls ≥24px hit target with 44px preferred. 200% zoom and reduced motion supported. Date controls show locale and timezone; NGN first but never presume currency from location.

## Complete route inventory

Each ID is an independently testable screen or major dialog. The audience in permissions governs access; routes are illustrative.

| ID / route | User / purpose | Composition and primary action | Additional required states |
|---|---|---|---|
| I01 /login | All employees | OPA Pulse identity, business login, recovery; Continue | Locked, suspended, wrong identity realm, MFA required |
| I02 /activate/:token | Invited employee | Invitation scope, identity verify, policies, set password through IdP, enroll MFA | Expired/used invite, employment not active, resend request |
| I03 /mfa | All | Passkey/TOTP challenge, recovery code, device notice | Rate limit, clock drift, used code |
| I04 /recover | All | Generic recovery request/confirmation and IdP step | No account enumeration, expiry, independent MFA recovery review |
| I05 /me/profile | Self | Photo/contact, People-owned employment readout, timezone, Save | Invalid file, scan pending, read-only People fields |
| I06 /me/security | Self | Password account center, MFA methods, recovery codes, sessions | Recent-auth prompt, last factor protected, revoke current session |
| I07 /me/preferences | Self | Channels, digest, quiet hours, timezone, signature link | Security notifications mandatory, DST preview |
| W01 /my | All | Today, next actions, assigned leads/deals, calendar, learning, mailbox status | No assignments, overdue, manager-view switch labeled |
| W02 /tasks | Self/team grant | Filtered task list, due dates, bulk permitted actions | Reassigned, completed, overdue, recurrence conflict |
| W03 /calendar | Self | Week/agenda, meeting preparation panel, Create meeting | Provider disconnected, private details hidden, conflict/DST |
| W04 /meetings/:id | Attendees/record ACL | Brief, approved facts, relevant shared history, reviewed action checklist | AI draft label, missing consent, restricted notes |
| R01 /revenue | Executive/manager | MRR/ARR, pipeline, forecast, risks, territory table, source drawer | Unknown billing, stale projection, mixed currency, sparse sample |
| R02 /forecasts/:period | Authorized manager | Scenarios, category/probability, adjustments/reasons, freeze snapshot | Missing FX, late events, revised forecast comparison |
| R03 /performance | Manager/executive | Team/territory goals, cohorts, conversion and cycle | Partial tenure/territory transfer, suppressed comparisons |
| C01 /accounts | CRM grants | Search, industry/owner/territory filters, table, Create | Potential duplicate, incomplete country |
| C02 /accounts/new | Authorized author | Legal entity, industry, country, parent, territory, minimal contact | Duplicate warning, hierarchy cycle, missing owner |
| C03 /accounts/:id | Record ACL | Overview, branch tree, buying committee, opportunities, activity and shared conversations | Restricted branch, record archived, no next action |
| C04 /accounts/:id/branches | Record ACL | Branch list/map-free address hierarchy, Add branch | Cross-territory conflict, duplicate branch |
| C05 /contacts | CRM grants | Contact directory, relationship roles and consent metadata | Unverified email, invalid E.164, no marketing basis |
| C06 /contacts/:id | Record ACL | Dated relationships, shared activity, permitted deals, Edit | Multiple accounts, retired contact, restricted relationship |
| C07 /leads | BD/sales | Queue, scoring explanation, assignment, qualification panel | Unassigned SLA, score unknown, disqualified reason |
| C08 /leads/:id/qualify | Owner/manager | Need/authority/budget/timing evidence, score, Convert preview | Duplicate match, conversion conflict, unknown budget |
| C09 /pipeline | Sales/manager | Stage board/list, value/currency, owner, age, next action | Gate failures, forbidden drop, stale revision |
| C10 /opportunities/:id | Record ACL | Stage rail, health evidence, quote/proposal, activity, buying committee, next action | Stalled, lost, reopened, pilot distinct, missing contract |
| C11 /duplicates/:id | Ops/reviewer | Side-by-side fields, relationship/ACL impact and merge preview | Conflicting legal hold, stale preview, restricted field redacted |
| C12 /renewals | Assigned owner/team | Renewal dates, service status, risk reasons, expansion task | Cancelled service, unknown renewal value, no auto-renew assumption |
| C13 /handover/:id | Sales/implementation assignees | Contract scope, approved exclusions, contacts by ACL, checklist, accept | Rejected scope, missing owner, confidential annex restricted |
| P01 /proposals | Author/reviewer | Versions, status, industry, validity, customer delivery state | Expiring facts, rejected review, superseded version |
| P02 /proposals/new | Author | Industry template, brief, product package, allowed claims | No approved template/facts, planned-only package |
| P03 /proposals/:id/edit | Author | Left section outline, center page canvas, right facts/quote/validation | Unsaved, conflict, missing variables, revoked fact |
| P04 /quotes/:id | Author/Ops | Currency, price-book lines, recurring/setup, discount/tax/validity | FX stale, nonstandard terms, approval tier change |
| P05 /reviews/:id | Independent reviewer | Version diff, claim evidence, quote concessions, artifact preview, approve/reject | Self-approval denied, obsolete hash, absent reviewer |
| P06 /proposals/:id/history | Permitted users | Immutable version timeline, approvers, hashes, compare | Withdrawn artifact, historical fact status banner |
| P07 /proposals/:id/release | Author with approval | DOCX/PDF preview, recipients, attachment classification, release summary | Scan/render failure, expiry, approval invalidated |
| M01 /mail/connect | Self | Google/Microsoft choice, scopes/privacy, Connect | Wrong tenant, revoked consent, no provider license |
| M02 /mail | Mailbox owner | Folder rail, thread list, reading pane, sync freshness | Initial/resync, rate limit, offline, private badge |
| M03 /mail/compose | Owner | Verified From, To/CC/BCC, template/signature, attach approved document, send/schedule | Recipient warnings, blocked content, changed approval |
| M04 /mail/threads/:id | Owner | Conversation, reply/reply-all, attachments and CRM link suggestion | Remote images off, suspicious attachment, no implicit sharing |
| M05 /mail/link-review | Owner + target grant | Exact redacted shared snapshot and audience, Confirm link | Mixed private recipients, restricted target, attachment excluded |
| M06 /mail/scheduled | Owner | Approved payload/timezone, status, cancel/reschedule | Revoked employee, unknown send outcome, reconciled failure |
| M07 /mail/templates | Approved audience/Ops | Template versions and signatures, preview/render variables | Unapproved version, missing variables |
| A01 /academy | All assigned audience | Role path, continue learning, Library search, industry collections | No role path, overdue content, expired modules |
| A02 /academy/library | Audience-filtered | Product/technical/playbook/FAQ/proposal filters, status/review owner | Restricted results absent, retired content excluded |
| A03 /academy/content/:id | Audience | Version, exact claim statuses/evidence, owner/review date, acknowledge | Superseded/stale, evidence missing, download restricted |
| A04 /academy/paths/:id | Assigned employee | Ordered modules, assessment prerequisites, progress/due dates | Required new version, exemption reason, blocked module |
| A05 /academy/assessments/:id | Assigned employee | Accessible questions, progress, submit, outcome/remediation | Timeout policy, retry interval, no answer-key leakage |
| A06 /academy/my-learning | Self | Attempts, acknowledgements, version history and certificates | Passed older version, reassignment due |
| A07 /academy/team | Manager/HR scope | Completion summary by path/role, overdue follow-up | No unrelated answers/HR records, sparse-group suppression |
| A08 /academy/author | Assigned author | Content editor, audience, owner, review due, evidence refs, submit | Missing owner, self-review blocked, stale source |
| A09 /academy/reviews/:id | Assigned reviewer | Diff, facts, audience/expiry, approve/retire | Withdrawn evidence, affected proposals/remediation |
| N01 /analytics/funnel | Commercial scope | Stage/cohort funnel, time-window definitions, source table | Right-censored cohorts, sample size |
| N02 /analytics/intelligence | Commercial/product scope | Objections, feature demand, pilot/retention, evidence summaries | AI unreviewed, sanitized export preview |
| N03 /analytics/metric/:id | Authorized drilldown | Formula, numerator/denominator, currency, snapshot, rows | Stale revision, restricted row count excluded |
| S01 /admin/employees | Scoped admin | People status, invitation/grant state, revoke access | No HR salary, source offline, orphan account |
| S02 /admin/employees/:id/access | Scoped admin/manager reviewer | Dated roles/territories, grant diff, independent approval | Privilege escalation, termination, pending revoke |
| S03 /admin/territories | Scoped management | Hierarchy/memberships/routing policy and transfer preview | Cycles, unassigned coverage, ownership reassignment |
| S04 /admin/catalog | Ops/product reviewers | Product facts, status, price-book/template versions | No evidence, expiry, capability withdrawal |
| S05 /admin/workflows | Ops/security scope | Catalog, versions, dry-run, approvals, run/dead-letter inspector | Outbound disabled, replay blocked, overdue review |
| S06 /admin/integrations | Scoped admin | People, mail/calendar and approved Connect health, consent metadata | No token values, revoked connection, checkpoint stale; no CRM vendor setup |
| S07 /admin/imports/:id | Ops | Mapping, duplicate/conflict preview, row errors, apply | Partial failure, authority conflict, expired approval |
| S08 /admin/exports/:id | Requester/reviewer | Scope/columns/reason, approve, expiry/download audit | No self-approve, retention hold, scope changed |
| S09 /admin/audit | Security/business scoped | Search metadata, correlation timeline, verify integrity | Bodies/secrets excluded, denied event visible by policy |
| S10 /admin/retention | Privacy/security scope | Retention classes, holds, purge preview/approval | Hold blocks purge, provider copy responsibility |
| S11 /notifications | Self | Actionable alerts, read state, preference links | Restricted/deleted target, revoked action |

## Principal review flows

1. Employee: People grant approved → invitation → identity verify → MFA → personal workspace → separately authorize mailbox → assigned Academy path. Suspension from any screen ends active session and cancels future actions; displayed recovery path never promises reactivation without People clearance.
2. Lead-to-customer: capture → duplicate review → assignment → qualify → opportunity → solution fit → industry proposal/quote → independent approvals → render/release → employee-reviewed send → contract → accepted implementation handover. Stage movement is an action with requirements, not merely dragging a card.
3. Executive: choose reporting period/currency/scope → inspect forecast → open provenance drawer → source cohort → authorized deal → next action. Switching currency recalculates with a pinned rate snapshot and labels missing coverage.
4. Academy-to-proposal: role library → approved fact → evidence and version → insert into proposal → review exact wording and environment scope. Planned status cannot be converted to verified by editing a label.
5. Mail: private inbox → select thread → reply with approved proposal → approve exact recipients/content → send → provider status. Sharing thread content with CRM uses a separate audience preview; future replies stay private until shared.

Static review boards illustrate information hierarchy and these flows. Functional behavior, screen-reader verification and device testing are acceptance work after design approval, not claimed as completed UI tests.
