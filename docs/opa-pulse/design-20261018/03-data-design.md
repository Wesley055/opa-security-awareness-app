# Logical database design

This is a specification, not executable DDL or a migration. PostgreSQL is proposed. UUID primary IDs, UTC timestamptz, explicit IANA timezones for scheduling, ISO currency, fixed decimal money (never floating point), created_by/at, updated_by/at and optimistic version apply to mutable business entities. All tables carry organization_id; composite foreign keys prevent cross-organization references. Employee identity is globally unique within the dedicated internal boundary. Soft deletion does not bypass retention or legal hold.

## Entity dictionary

| Domain / entity | Required fields and relationships | Invariants / access |
|---|---|---|
| organization | id, legal_name, default_currency, reporting_timezone | Internal OPA operating entity; no institution admin |
| employee | id, people_employee_id, idp_subject, business_email, status, manager_id, department_id, auth_epoch | Unique people ID and issuer+subject; active/invited/suspended/terminated; no payroll |
| employee_profile | employee_id, display_name, photo_object_id?, phone?, timezone, locale | Self-edit allowlist; employment fields People-owned |
| invitation | employee_id, token_hash, expires_at, used_at, grant_request_id | Single-use 24h proposed; no raw token stored |
| access_grant | employee_id, role_id, territory_id?, account_id?, valid_from/to, approver_id, policy_version | No self-approval; deny overrides allow |
| session / recovery_factor | employee_id, session_hash, assurance, revoked_at, epoch; encrypted factor/ref, recovery_code_hash | No session tokens or recovery secrets in logs |
| notification_preference | employee_id, channel, event_type, quiet_hours, timezone | Security notices cannot be disabled |
| department / role / territory / membership | codes, parent_id?, effective dates, manager scope | Territory tree acyclic, transfers dated |
| account | legal_name, normalized_name, domain?, industry_id, parent_id?, country, owner_id, territory_id, status | Acyclic parent; domain alone not unique (shared groups) |
| branch | account_id, name, address_minimal, country, territory_id | Distinct branch ID, scope inherited or explicit restriction |
| contact / contact_relationship | contact names, email?, phone_e164?, lawful_basis_ref; contact_id, account/branch_id, decision_role, valid dates | Email normalization preserves provider semantics; never strip '+' universally |
| lead | source, account/contact refs?, owner_id, territory_id, qualification_json, score, score_rule_version, state | New/assigned/qualifying/qualified/disqualified/converted; unique converted_opportunity_id |
| duplicate_case / merge_record | candidate IDs, reasons, reviewed_by, canonical_id, field_decisions | Human-reviewed; retain redirect and provenance |
| opportunity | account_id, branch_id?, owner_id, territory_id, stage, currency, amount_net, close_date, next_action_id, forecast_category, probability_version | Nonnegative amount; stage transitions validated |
| stage_history | opportunity_id, from/to, occurred_at, actor, reason, revision | Append-only, source for funnel/aging |
| activity / task / meeting | linked_record, actor/assignee, type, due_at, timezone, state, visibility; provider_event_ref? | Personal or shared CRM; meeting private notes separate from shared actions |
| product / package / price_book / price_line | product_code, package version, currency, validity, recurring cadence, amount, approved_by | No live product claims inferred from names |
| capability / capability_version | key; status, exact_claim, evidence_refs, environment_scope, industry_scope, owner, reviewer, approved_at, review_due, expires_at | Immutable versions; status alone insufficient for customer use |
| industry / template / template_version / section | taxonomy code; industry_id, schema_version, sections, required_inputs, audience, owner, approval | Industry metadata, not hardcoded engine forks |
| proposal / proposal_version | opportunity_id, template_version, content_tree, fact_version_refs, quote_version_id, hash, state | Draft/review/approved/rejected/superseded/withdrawn; immutable version snapshots |
| quote / quote_version / quote_line | opportunity_id; currency, fx_snapshot?, tax_rule_ref, validity, totals; quantity, unit, cadence, discount | One currency per quote; line and total rounding specified |
| approval_request / decision | subject_type/id/version, payload_hash, policy_version, approver_scope, expiry, requester; decision/reason/time | Requester cannot approve own request; approval binds hash |
| document_artifact | proposal_version, format, object_ref, sha256, renderer_version, scan_state, classification | No public URLs; DOCX/PDF hashes independently approved for release |
| contract / subscription / renewal / handover | opportunity_id, signed_doc_ref, service_dates; recurring lines, currency; renewal_date, owner; checklist, accepted_by | Won is not active recurring revenue; subscriptions activate separately |
| mailbox_connection | employee_id, provider, provider_tenant, provider_user, address, scopes, secret_ref, state, auth_epoch | Unique org+provider+tenant+user; owner-only body access |
| mail_thread / message | connection_id, provider_thread/message IDs, internet_message_id?, folder, sent/received_at, body_ref, privacy | Unique connection+provider_message_id, not RFC Message-ID alone |
| draft / send_intent | connection_id, recipients, body_ref, attachment_refs, reply_refs, revision; hash, schedule_at, state, effect_key | Owner active and sender address verified; unknown outcome never blindly retried |
| crm_communication | source_message_id, record_id, redacted_snapshot_ref, linked_by, audience_scope, approval? | Explicit sharing; snapshot ACL independent from mailbox |
| signature / email_template_version | employee/org scope, content, approved_by, validity | No arbitrary sender substitution |
| knowledge_item / content_version | type, industry, owner, audiences; body_ref, version, state, review_due, capability_refs | Draft/review/approved/retired; searchable only within audience |
| learning_path / path_version / assignment | audience roles, ordered module versions; employee_id, due_at, source_people_event | Unique source event+path version+employee |
| assessment_version / attempt / progress | question/rubric version, pass_score; employee, answers_ref, score, submitted_at; module version, completion/ack | Attempts immutable; manager sees authorized summary, not unrelated HR records |
| workflow_definition / run / step / effect | version, trigger, conditions; event ID, state; approval/version, attempts; unique effect_key | Run pins definition; all external effects re-authorize |
| event_inbox / outbox / external_mapping | producer+event_id, sequence, payload_hash; aggregate_id/version; provider+object_type+external_id+local_id | Unique producer+event ID and mapping key; replay mismatch is security alert |
| forecast_snapshot / metric_snapshot / fx_rate | as_of, filters, probabilities, currency_basis, coverage, source_revision, permission_scope; currency_pair, rate, date, source | No mixing forecast currencies without pinned FX |
| objection / feature_request / pilot | opportunity_id, taxonomy, approved_sanitized_summary; github_ref?; pilot dates, criteria, outcome | Customer evidence remains private; no confidential GitHub text |
| export_job / audit_event / retention_hold | requester, scope, query_hash, approval, expiry; actor, action, object, reason, result, correlation, prev_hash; object scope, authority, release | Audit append-only; metadata excludes mail bodies/secrets; holds block purge |

## Relationships and integrity

Account 1:N branches/opportunities; contact M:N accounts/branches through dated relationship rows. Employee 1:N grants, sessions, tasks, mailbox connections, learning assignments. Proposal 1:N immutable versions; version N:1 template version and quote version; version M:N capability versions. Content can reference the same capability versions so Academy and Proposal Studio cannot diverge silently.

Ownership reassignment updates explicit owner/grants with history, never rewrites prior actor IDs or grants a manager private mailbox access. Termination retains company-owned objects with historical actor references; employee profile PII follows retention policy. Content revocation appends status event and prevents new use; historical delivered artifacts remain auditable and are flagged for remediation.

## Indexing, reporting and retention

Indexes: opportunity(org,territory,stage,close_date,id); task(org,assignee,state,due_at); account(org,normalized_name,country); contact(org,normalized_email); stage_history(org,opportunity,occurred_at); mail(connection,folder,received_at,id); audit(org,occurred_at,id); workflow(effect_key unique); event(producer,event_id unique). Use partial indexes for active work and unprocessed outbox. Search applies audience/ACL filters plus primary-store recheck before opening a result.

Partition audit/messages/activity by month after observed volume warrants it; no partition scheme is a reason to bypass holds. Reporting views include record IDs and source revisions and are scoped before aggregation. Sparse groups (<5 employees proposed) suppress individual comparative analytics outside authorized management scope.

Synthetic seed convention: example.invalid addresses, TEST-* account names, no real product evidence, labels "synthetic". Do not seed customer systems. Financial fixture: NGN 12,000,000 eligible pipeline at p=0.60 contributes NGN 7,200,000 weighted pipeline; annual contracted recurring NGN 2,400,000 yields booked MRR NGN 200,000, separate from activation/billing.
