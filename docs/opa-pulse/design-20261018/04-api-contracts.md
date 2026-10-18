# API and event contracts

Design notation only; no server or executable client is included. Future base /pulse/v1; dedicated employee OIDC audience. JSON camelCase, UUID identifiers, RFC3339 timestamps, ISO dates/currency and decimal strings. IDs in examples are placeholders; implementation schemas must enforce UUID. Deny by default.

## Shared protocol

All state-changing business POSTs accept Idempotency-Key (UUID), scoped to organization+actor+route, retained ≥7 days (workflow effect IDs retained for workflow life). Same key/body returns original response; different body returns 409 IDEMPOTENCY_MISMATCH. PATCH/transition requests require If-Match revision; stale returns 412 REVISION_CONFLICT. GET collections use opaque cursor and limit 1–100, deterministic ordering, scoped filters and nextCursor; never leak total counts across ACL. Unknown or invisible object returns 404. Authentication failure 401, action denied on visible resource 403, validation 422, rate limit 429 + Retry-After, async operation 202 + job resource.

Error shape: {"error":{"code":"APPROVAL_STALE","message":"Review the updated version.","fieldErrors":[],"correlationId":"opaque-id"}}. Logs exclude request body/PII. Browser sessions use Secure HttpOnly SameSite cookies, CSRF token/origin validation; service events use dedicated OAuth scopes plus signed payloads, never browser cookies. Bulk exports are async, policy-approved and scanned.

## Identity and profile

| Method / route | Input → output | Authorization and invariants |
|---|---|---|
| POST /employee-invitations | peopleEmployeeId, proposedGrants, managerApprovalId → invitationId, expiresAt | Scoped admin + approved manager grant; approved employment only; invitation delivery separately authorized |
| POST /identity/activate | oneTimeToken, IdP activation proof → enrollmentRequired | Token single use, 24h; no grant before MFA; no tokens in URL logs |
| GET /identity/authorization-start; GET /identity/callback | redirect/PKCE/state flow → dedicated session | Internal issuer/nonce/audience, current employment and assurance checked |
| POST /identity/recovery-requests | businessEmail → generic 202 | Same response/timing for unknown user; rate limited |
| POST /identity/recovery-completions | token, IdP recovery proof → revokedPriorSessions=true | Single-use; no MFA removal via password reset |
| POST /identity/password-change | current-auth proof, IdP transaction → 204 | Reauth and IdP-owned password policy |
| POST /identity/mfa/enrollments; POST /identity/mfa/confirmations | factor ceremony → confirmed factor | WebAuthn preferred; recovery codes hashed; secret never returned again |
| DELETE /identity/mfa/{factorId} | recent MFA proof, replacement factor → 204 | Cannot remove last factor; recovery alternative requires independently approved recovery |
| GET /me; PATCH /me/profile; PATCH /me/preferences | profile allowlist / timezone / notification settings → me | Cannot patch role, manager, status or People ID |
| GET /me/sessions; DELETE /me/sessions/{id}; POST /identity/logout | scoped session data → 204 | Self only; logout clears local session |
| POST /employees/{id}/suspend; POST /employees/{id}/grant-reviews | reason / dated grant request → employee or review | Authorized HR lifecycle service or scoped security admin; no payroll |
| GET /me/workspace; GET /teams/{id}/summary | date window → scoped cards | Manager team scope explicit; mailbox bodies excluded |

Federated password change/recovery routes broker to the dedicated IdP; they do not store passwords in Pulse. If chosen IdP does not support an operation, UX links to its approved account center and confirms updated assurance on return.

## Business resources

Collection/detail GET and POST/PATCH exist for accounts, branches, contacts, leads, opportunities, tasks, meetings, objections, feature-requests, pilots and renewals. Create payloads follow required fields in data dictionary; owner/territory assignments validated against requester grant. No hard-delete CRUD endpoint for audited commercial records; POST /{resource}/{id}/archive requires reason and retention evaluation.

| Operation | Contract and policy |
|---|---|
| POST /leads/{id}/qualify | qualification evidence, nextAction, scoreRuleVersion → qualified lead; missing budget is explicit unknown |
| POST /leads/{id}/convert | expected revision, accountId or proposedAccount, contactIds, opportunity fields → canonical account/contact/opportunity IDs atomically; repeated key cannot duplicate deal |
| POST /opportunities/{id}/transitions | targetStage, reason, evidenceRefs → opportunity+history; enforce PRD gates |
| POST /duplicate-cases/{id}/merge-preview | candidateIds, precedence → conflict report and permission impact |
| POST /duplicate-cases/{id}/merge | approvedPreviewHash, canonicalId → merge record; Ops only, recheck revisions |
| POST /imports/hubspot/preview | uploadedFileId, mappingVersion, authorityMap → job/errors/conflicts |
| POST /imports/{id}/apply | previewHash, selectedRows, approvalId → job; changed inputs require fresh preview |
| POST /exports | type, filters, columns, reason, approvalId → job; server intersects permission scope |
| GET /jobs/{id}; GET /exports/{id}/download | requester/authorized reviewer only; short-lived URL after reauth |
| GET /analytics/{metric} | from,to,territory,asOf,currencyBasis → value, denominator, coverage, sourceRevision, freshness, drilldownToken |
| GET /analytics/drilldowns/{token} | opaque scope-bound expiring token → authorized source rows |
| POST /forecast-snapshots | period, scenario, FXVersion, probabilityVersion → immutable snapshot |

## Proposal and Academy

| Operation | Payload / response and rule |
|---|---|
| POST /proposals | opportunityId, templateVersionId, brief → draft version |
| POST /proposals/{id}/versions | baseVersion, contentTree, capabilityVersionIds, quoteVersionId → immutable version/hash, validation report |
| POST /quotes/{id}/versions | currency, lines, taxRuleRef, validity, fxRef? → calculated totals and required approval tier |
| POST /approval-requests | subject/version/hash, policyVersion, intendedRecipients? → pending request; route server-selected |
| POST /approval-requests/{id}/decisions | decision, reason, expectedHash → signed audit decision; no requester self-approval |
| POST /proposal-versions/{id}/renders | formats [docx,pdf] → rendering job; validate approved content and fonts/links |
| POST /proposal-versions/{id}/release | artifactHashes, approvalIds, recipientSet → releasable bundle; send remains separate employee action |
| GET /capabilities; GET /knowledge; GET /learning-paths; GET /me/learning | filters and permitted audiences → content/status/reviewDue |
| POST /knowledge/{id}/versions; POST /knowledge-versions/{id}/submit-review | version tree, ownership, audiences → draft/review; author cannot self-approve |
| POST /content-versions/{id}/retire | reason, remediationOwner → blocked future use and affected proposal list |
| POST /learning-assignments | pathVersionId, employeeIds, dueAt → assignments; HR/manager scope only |
| POST /assessments/{versionId}/attempts; POST /attempts/{id}/submit | answers → attempt; server grades, never exposes answer key |
| POST /learning/{assignmentId}/acknowledgements | moduleVersion, attestation → version-pinned progress |

## Mail and calendar

POST /mail/connections/authorize returns provider authorization URL with PKCE/state bound to session and employee. Callback verifies business tenant/account and approved scopes; GET /me/mail/connections exposes status only, never tokens. DELETE /me/mail/connections/{id} cancels pending sends, removes local token and attempts provider revocation.

GET /me/mail/threads and /me/mail/threads/{id} owner-only. POST /me/mail/drafts accepts connectionId, to/cc/bcc, subject, sanitizedBody, attachmentIds, replyToMessageId?, templateVersionId, signatureVersionId. Server validates From as connection identity or explicitly provider-verified permitted alias. PATCH draft requires revision. POST /me/mail/drafts/{id}/send-intents accepts payloadHash, approvalId?, scheduleAt? and timezone; returns state and cancelUntil. POST /send-intents/{id}/cancel only succeeds before provider dispatch. POST /mail/messages/{id}/link-preview returns exact shared snapshot and target ACL; POST /mail/messages/{id}/crm-links requires previewHash and targetRecordId. No unrestricted GET /employees/{id}/mail.

State: draft → pending_review → approved → scheduled/queued → dispatching → provider_accepted → observed_sent; delivery_failed or outcome_unknown are distinct. Delivered is shown only with trustworthy provider delivery evidence; Sent-folder presence alone is not delivery. Direct human send is an explicit approval of exact payload; scheduled/automated messages require stored human approval. A changed attachment, recipient, content, signature or material send window invalidates it. Suppressed/blocked recipients and expired proposal bundles are rejected again at dispatch.

POST /me/calendar/connections/authorize separately consents. GET /me/calendar/events, POST /me/calendar/events, PATCH /me/calendar/events/{id}, DELETE /me/calendar/events/{id} obey event ownership and provider revision. POST /meetings/{id}/actions creates explicit task assignments and shared notes after review.

## Event envelopes and example exchanges

People event example (synthetic):

```json
{"specVersion":"1.0","eventId":"uuid","type":"employee.suspended.v1","producer":"opa-people","organizationId":"uuid","aggregateId":"opaque-people-id","sequence":14,"occurredAt":"2026-10-18T10:00:00Z","data":{"status":"suspended","effectiveAt":"2026-10-18T10:00:00Z"}}
```

POST /integrations/people/events verifies issuer/service audience, signature, timestamp (±5 minute replay window), event ID and aggregate sequence. Durable inbox acknowledgement 202 occurs only after persist; effect dedup prevents reprocessing. Exact replay returns 200 duplicate; same ID/different hash 409 security event. Out-of-order activation never overrides a newer termination; sequence gaps quarantine entitlement increases while urgent suspension fences immediately. Future-effective transfer is scheduled but security suspension takes effect at the specified effective time or immediately if past.

Future Connect webhook envelope adds schemaVersion, subject opaque ID and correlationId; HMAC signature over raw body + delivery timestamp, key ID for rotation, unique delivery ID, bounded replay and receiver inbox. Consumer returns 2xx only after durable receipt. Event catalog: employee.access_revoked.v1, opportunity.stage_changed.v1, proposal.approved.v1, handover.accepted.v1, subscription.renewal_due.v1, academy.assignment_completed.v1. Public payloads contain no mailbox body, employee PII or institutional incident data.

Synthetic stage response:

```json
{"id":"uuid","version":8,"stage":"Proposal","currency":"NGN","amountNet":"12000000.00","historyId":"uuid","nextAction":{"dueAt":"2026-10-20T09:00:00+01:00"},"provenance":{"source":"pulse","eventRevision":8}}
```

Every endpoint must publish a machine-readable OpenAPI schema and generated contract tests during implementation phase 0; this design contract specifies behavior, not a claim of an already validated OpenAPI server.
