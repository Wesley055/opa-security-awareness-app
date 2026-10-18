# Security, privacy and audit design

This is an engineering proposal requiring security/privacy review, not legal compliance certification. Applicable Nigerian and cross-border privacy duties, employment monitoring, retention and provider transfers must be confirmed by qualified owners before live processing; no legal conclusions or tax rules are assumed.

## Identity lifecycle

Invitation requires a current People employment record, approved manager scope and unique immutable employee link. Invitation token is random, hashed, single-use, expires in 24h proposed; rate limit/resend invalidate prior token. Activate through dedicated employee IdP, require MFA before data access. No shared accounts or email-only automatic relinking. Domain membership alone does not create an account.

Dedicated IdP owns password hashing/policy and breached-password controls; support passkeys/WebAuthn, TOTP fallback and hashed recovery codes. Proposed password policy where passwords are used: ≥15 characters, permit password managers/paste, no routine forced rotation absent risk, block known-compromised values; security owner finalizes. MFA for all; phishing-resistant factor required for privileged roles. Recovery cannot silently remove MFA; lost-factor recovery requires independently verified People identity and two-person security approval with alerts and cooldown.

Session defaults proposed: 30-minute inactivity timeout, 12-hour absolute session, recent MFA within 5 minutes for exports/grant changes/token connection/recovery changes. Dedicated Secure/HttpOnly cookie, CSRF protection, server-side session store and auth_epoch checked per request. Risk-based reauthentication; sessions list own devices/time, no tracking beyond security need. IdP logout failure does not prevent local revocation.

Suspend/terminate: persist deny/fence first → revoke sessions/grants → cancel pending customer sends/exports/approvals → disable token decryption and revoke provider consent where possible → reassign company records with manager approval → retain governed history. A failed provider revoke alerts security but never re-enables local use. Cached authorization, signed download links, websocket sessions and worker leases must respect revocation; signed URLs ≤60 seconds proposed with proxy delivery for immediate deny requirements. No token reassignment to managers.

## Threat and control matrix

| Threat | Prevention / detection | Required adversarial test |
|---|---|---|
| Customer token accepted internally | Dedicated issuer/audience/keys and employee record check | Customer Super Admin/Facility Operator token rejected even with matching role string |
| Cross-territory object enumeration | Object/field authorization, row policy, opaque scoped cursors | Read/update/search/count/attachment/AI/export all denied |
| Manager reads private mailbox | Owner-bound connection and private data store ACL; explicit snapshot sharing | Team/executive/admin roles cannot read another employee body or attachment |
| Stale worker sends after suspension | Auth epoch fence immediately before dispatch/token use, lease invalidation | Pause job, suspend, resume; no provider call |
| Approval bypass via edit | Immutable versions, hash+policy+recipient binding and independent reviewer | Edit attachment/recipient/quote/fact or schedule; send/release blocked |
| OAuth theft/CSRF | PKCE/state/nonce, strict redirects, encrypted refresh tokens, no browser token storage | Replayed callback/wrong tenant/stolen state fails |
| Malicious email/document | Sanitize HTML, block scripts/remote images by default, sandbox render/scan, MIME sniffing | Stored XSS, macro, zip bomb, SSRF image and malicious prompt cannot execute |
| Export exfiltration | Column minimization, reason/approval, reauth, rate limits, expiring downloads | ACL changes between request/render/download prevent leak |
| Prompt injection | Untrusted content isolation, source-grounded generation, no autonomous tools | Inbound instruction to reveal mail/secrets fails; output reviewed |
| Webhook replay/forgery | Authenticated producer, raw-body signature, timestamp, inbox ID/hash and sequence | Duplicate harmless; old activation cannot undo termination |
| Audit alteration | Append-only restricted service, immutable copy, hash chain and external checkpoint | Delete/tamper detected, privileged actions independently reviewed |
| CRM/HR data crossing | Allowlisted People schema and distinct storage/service identity | Payroll/bank/medical fields rejected, not silently logged |

## Data classes and proposed retention

| Class | Default proposal | Controls |
|---|---|---|
| Private mailbox cache | 30 rolling days, owner may fetch older permitted mail on demand | Owner-only; purge local bodies on disconnect/offboarding after governed extraction; provider mailbox policy separate |
| Linked CRM communications | 24 months after relationship end | Company record ACL, minimization/redaction, legal hold overrides |
| Accounts/contacts/leads | Annual review; inactive unqualified leads 12 months proposed | Lawful-purpose review, deletion/anonymization as approved, don't retain forever by default |
| Contracts/approved proposals/quotes | 7 years after contract end proposed | Finance/legal validation required, holds, version/hash integrity |
| Audit/security events | 24 months proposed, sensitive body excluded | Restricted access, immutable archive, alert checkpoints |
| Learning progress/attempts | Employment +24 months proposed | Role/manager access, minimal assessment answers and periodic purge |
| Profile/session/recovery | Profile 90 days after termination unless required; sessions 30 days revoked metadata; tokens immediately unusable | Erase secrets immediately, pseudonymize actor references when lawful |
| Backup | 35-day rolling proposed | Encrypted, isolated credentials; expiry rather than unsafe selective editing; deletion tombstones reapplied on restore |

Retention policies are separately versioned per country/entity and approved before live use. Legal holds record authority, scope, reason and release approval; block deletion in primary/derived/object stores. Data access/correction/deletion requests use identity verification, scoped discovery, reviewer decision and auditable completion. Purpose limitation and notice apply to employee learning/performance analytics.

Encrypt in transit and at rest with managed keys; envelope-encrypt OAuth secrets using dedicated KMS scope. Rotate keys, restrict secret read to adapter identity, redact logs/errors. Private buckets, malware quarantine, short-lived download grants, content security policy and no public tracking pixels. Proposed upload limit 20 MB, safe MIME allowlist and archive decompression limits; provider-specific lower limits enforced before send.

## Audit model

Each action records event ID/time, actor employee/service, effective principal, organization, action, resource/version, result, reason/approval reference, policy epoch, before/after allowed-field diff, correlation ID and request context minimized for security. Do not store passwords, tokens, recovery codes, full message bodies or full PII snapshots in audit. Communications record intent hash, recipient identifiers under restricted access, provider status and attachment hashes; denied actions also audited without disclosing hidden object data to users.

Audit writer has append-only privileges; readers scoped by business/security purpose. Immutable archive and hash-chain checkpoints detect tampering (hash chain alone cannot prevent a privileged attacker rewriting all events). Proposed alert review daily, access review quarterly, privileged grants monthly. Test restore quarterly; rerun revocations/tombstones before restoring access. Incident playbook can disable outbound mail globally without stopping customer emergency products because boundaries are independent.
