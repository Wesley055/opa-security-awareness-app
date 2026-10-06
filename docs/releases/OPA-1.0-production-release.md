# OPA 1.0 Production Release Ledger

## Release Status

**PRODUCTION RELEASE CERTIFIED: NO**

Current phase: Production certification remediation

This document is the canonical release record for OPA 1.0.
Do not declare production release complete unless this ledger contains
the corresponding evidence.

---

## 1. Release Identity

| Item | Value |
|---|---|
| Candidate SHA | 9e6a0b0efca61759ab8329452801db8765d435e9 |
| Candidate branch | codex/bounded-support-hardening |
| Origin main baseline | a906e3e8ac2cfb90ce24bb237598dca0f4338b1c |
| Main-only commits | 0 |
| Candidate-only commits | 2 |
| Android current tested build | 1.0.0 / versionCode 20 |
| iOS previous physical build | 1.0.0 (5) |
| Current production API build observed | b02a851 |
| Final Android release build | PENDING |
| Final iOS release build | PENDING |
| Final website build | PENDING |
| Final API build | PENDING |

---

## 2. Product Scope Included in This Ship

### OPA Core

- Mobile emergency application
- SOS / emergency activation
- Emergency location
- SafeWalk / journey protection
- Enrollment and authentication
- Incident lifecycle
- Evidence and audit

### Institutional Command Center

- Super Admin
- Organization governance
- Facility governance
- OPA Technical Support
- Facility Administration
- Facility Operator
- Resident enrollment
- Operator enrollment
- Incident operations
- SafeWalk Protection
- Enrollment & Delivery
- Audit
- Reporting foundation
- Protected Identity

The Command Center is part of this production release.
This is not a mobile-only release.

---

## 3. Explicitly Deferred

The following are NOT release requirements for OPA 1.0:

- Resident Simple Activation V2
- Exceptional Operator resident lookup
- Case-free CommissioningEvidence
- Human Risk / insider-risk intelligence
- USSD integration
- Satellite / Starlink integration
- CIT / vehicle client
- Aviation telemetry
- Pipeline ROW product
- Drone integration
- Ambulance / fire-service integration
- New escalation architecture
- OPA Insight standalone product completion

These require separate production work.

---

## 4. Git Integrity

Status:

- Candidate committed: YES
- Candidate pushed remotely: YES
- Remote branch:
  origin/codex/bounded-support-hardening
- Main baseline is ancestor: YES
- Main-only commits: 0
- Candidate-only commits: 2

Checkpoint commit:

9e6a0b0
feat(release): harden institutional command center for physical acceptance

281 files were committed in the release checkpoint.

Generated docs/testing evidence and temporary *.before-* files were excluded
from the release commit.

---

## 5. Database and Migrations

Fresh migration certification:

- 42 / 42 migrations: PASS
- Baseline upgrade: 35 -> 42 PASS
- Final schema drift: NONE

Pending relative to production/main:

CERTIFICATION REPORTED: 7

Exact migration list: PENDING FINAL RECORD

Candidate introduced/reconciled migrations including:

- 20260928010000_support_role
- 20260928010100_institutional_authority
- 20260929090000_support_enrollment_provenance
- 20260930010000_canonical_organization
- 20260930010100_operational_response_policy
- 20261004010000_reporting_foundation_reconciled

Production migration plan: PENDING
Migration locking analysis: PENDING
Forward-recovery plan: PENDING
Application rollback compatibility: PENDING

RULE:

No production migration until migration/cutover/recovery plan is approved.

No manual production DB modification.

---

## 6. Production Environment

Production API endpoint:

https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net

Latest read-only health observation:

- HTTP: 200
- Environment: production
- Migration readiness: ready
- Observed build: b02a851

Candidate is NOT currently deployed.

### Endpoint Policy

Current committed production endpoint policy:

EXPIRED: 2026-09-27

Status: RELEASE BLOCKER

Policy must be legitimately re-issued against the intended production build.
Do not manually extend expiresAt.
Do not bypass environment-policy.

---

## 7. Dependency Security

### API / Root Production Audit

Current result:

8 vulnerabilities

- Critical: 1
- High: 3
- Moderate: 4

Known affected dependency families include:

- proxy-addr
- axios
- joi
- @nestjs/core / @nestjs/platform-express
- multer
- africastalking dependency chain

Status: RELEASE BLOCKER

Do not use npm audit fix --force without dependency-specific analysis.

### Website Production Audit

Current result:

5 vulnerabilities

- Critical: 1
- High: 3
- Moderate: 1

Known affected dependency families include:

- next
- postcss
- sharp
- source-map-js
- baseline-browser-mapping

Status: RELEASE BLOCKER

### Mobile Audit

Current audit result:

49 reported vulnerabilities

- High: 33
- Moderate: 16

This set includes runtime, Expo, React Native, Metro, Jest/build and transitive
dependency paths.

These findings MUST be classified before remediation.

Do not interpret all 49 as equivalent production runtime exposure.

Do not blindly force Expo or React Native version changes.

---

## 8. Automated Certification

### API

API unit:

- 105 suites
- 1,019 tests
- PASS

PostgreSQL integration:

- 29 suites
- 448 tests
- zero failures
- zero skips
- PASS

### Environment Policy

- 29 tests
- PASS

### Website

Clean production compilation:

PASS

Previous certification issue:

Enrollment test/group timeout.

Subsequent reproduction:

Original 12-file website group:
60 / 60 PASS
47.3 seconds
unchanged.

Original timeout has not reproduced.

Status:

Further deterministic certification required.

### Mobile

Certification:

278 tests PASS
1 timeout

Root cause: PENDING

Status:

RELEASE BLOCKER until deterministic gate passes.

### TypeScript

- API: PASS
- Website: PASS
- Mobile: PASS

### Lint

- Mobile: PASS
- API: PENDING deterministic completion
- Website: PENDING deterministic completion

---

## 9. Enrollment and Activation

### Physically Proven Earlier

- Technical Support invitation
- Facility Admin invitation
- Facility Operator invitation
- Resident dual-proof enrollment
- Email proof delivery
- SMS proof delivery
- Password establishment
- Role activation
- Institutional login

### Physical Finding

Invitation messages delivered verification proofs but lacked usable activation
navigation.

### Release Correction

Candidate now requires usable HTTPS enrollment navigation under valid
production configuration.

Expected institutional path:

Invitation
-> HTTPS /enroll?requestId=<opaque-reference>
-> email proof
-> phone proof
-> password
-> membership acceptance
-> role-appropriate destination

No verification code or password may be placed in the URL.

### Resident Simple Activation V2

DEFERRED.

Current production release preserves verification-first, non-enumerating
dual-proof resident enrollment.

---

## 10. Institutional Authority

Physically/automatically established architecture:

Super Admin
-> Organization
-> Facility
-> OPA Technical Support assignment
-> first Facility Administrator
-> Facility Admin staffing
-> Operator
-> Resident

Facility.id remains the authorization boundary.

Organization association does not automatically grant organization-wide
facility authority.

---

## 11. Protected Identity

Production requirements:

- masked identity by default
- plaintext resolution restricted
- plaintext resolution audited
- tenant isolation
- minimum necessary disclosure
- no unrestricted Operator resident directory

Candidate correction:

Ordinary Facility Operator directory enumeration/search removed.

Direct API authority must also deny enumeration.

Physical retest: PENDING

---

## 12. Incident / SOS

Required production E2E:

Resident
-> Mobile SOS
-> Production API
-> authoritative Facility
-> correct Operator Command Center
-> incident
-> location
-> acknowledgement
-> dispatch/progress
-> evidence/audit
-> resolution

Previous physical SOS attempt is INVALID as routing evidence because:

Android vc20 -> production Azure API

while

tested Operator Command Center -> local acceptance API.

Therefore no routing defect was established.

---

## 13. Location Truth

Candidate requires Operator incident presentation to distinguish:

- coordinate available
- capture time
- receipt time
- accuracy
- fresh
- stale
- waiting for location
- unavailable

Never fabricate location.

Never represent stale/delayed telemetry as live.

SafeWalk pre-emergency privacy remains isolated from Operator visibility.

Physical production retest: PENDING

---

## 14. Delivery Truth

Permanent invariant:

PROVIDER_ACCEPTED != DELIVERED != HUMAN_ACKNOWLEDGED

No UI or report may claim physical delivery merely because a provider accepted
a request.

Required:

- accepted
- delivered when provable
- unknown
- timeout
- retry/reissue
- human acknowledgement

---

## 15. SafeWalk

Privacy boundary:

Personal/family SafeWalk journeys are isolated from institutional Operator
visibility by default.

Institutional visibility requires explicit authorization or defined
emergency/escalation policy.

Pre-emergency coordinates must not leak into ordinary Operator views.

Physical release retest: PENDING

---

## 16. Production Credentials

Repository certification found no confirmed live credential committed to
source.

Physical acceptance provider credentials were used outside normal production
deployment.

Before production:

- identify active Resend credential
- identify active Africa's Talking credential
- identify production notification credentials
- reconcile Azure secrets
- reconcile JWT/session secrets
- reconcile database credentials
- reconcile PII encryption/HMAC secrets
- rotate any credential whose confidentiality cannot be confidently proven

Never record secret VALUES in this ledger.

Record only rotation status and date.

---

## 17. Mobile Builds

### Android

Current installed/tested:

1.0.0
versionCode 20

vc20 is production-bound.

Candidate source remains API-compatible by automated analysis.

Final candidate contains mobile UX corrections.

Final production Android build:

REQUIRED

Next versionCode: PENDING

### iOS

Previous physically accepted:

1.0.0 (5)

Build 5 source production profile points to production Azure API when built
with production profile.

Final candidate contains mobile UX corrections.

Final production iOS build:

REQUIRED

Next buildNumber: PENDING

---

## 18. Command Center Deployment

Included in this ship:

YES

Required production surfaces:

- Super Admin
- Technical Support
- Facility Admin
- Facility Operator
- Incident operations
- SafeWalk Protection
- Enrollment & Delivery
- Audit
- Reports

Production website deployment configuration:

PENDING CERTIFICATION

Production physical smoke:

PENDING

---

## 19. Physical Acceptance Checklist

### Governance

[ ] Super Admin production login
[ ] Organization creation/read
[ ] Facility creation
[ ] Organization -> Facility association
[ ] Facility lifecycle
[ ] Technical Support provisioning
[ ] Technical Support assignment

### First Administrator

[ ] Technical Support selects assigned facility
[ ] First Facility Admin provisioning
[ ] HTTPS invitation navigation
[ ] Email proof
[ ] SMS proof
[ ] Password
[ ] Activation
[ ] Facility Admin login
[ ] second ordinary first-admin attempt denied

### Operator

[ ] Facility Admin invites Operator
[ ] invitation navigation
[ ] dual proof
[ ] activation
[ ] Operator login
[ ] correct Facility
[ ] resident directory unavailable
[ ] direct API enumeration denied

### Resident

[ ] Facility Admin invites Resident
[ ] invitation navigation
[ ] dual proof
[ ] activation
[ ] OPA mobile login
[ ] correct Facility membership

### Emergency

[ ] SOS activation
[ ] incident reaches correct Facility only
[ ] Operator sees incident
[ ] truthful location state
[ ] acknowledgement
[ ] dispatch/progress
[ ] evidence
[ ] audit
[ ] resolution

### SafeWalk

[ ] SafeWalk start
[ ] normal journey remains private
[ ] escalation behavior
[ ] emergency conversion
[ ] institutional visibility only after permitted boundary

### Isolation

[ ] unaffiliated user cannot reach Facility Command Center
[ ] second-facility resident cannot reach first Facility
[ ] Operator cannot enumerate residents
[ ] Protected Identity remains masked

---

## 20. Production Deployment Sequence

NOT YET AUTHORIZED.

Expected controlled sequence:

1. Production certification PASS
2. Credential reconciliation/rotation
3. Production configuration verification
4. Database backup / recovery checkpoint
5. Migration readiness
6. Apply approved migrations
7. Deploy API
8. Verify API health/environment/build
9. Deploy Command Center website
10. Verify website/API compatibility
11. Produce/finalize Android production build
12. Produce/finalize iOS production build
13. Physical production smoke
14. Full critical-path E2E
15. GO / NO-GO
16. Release record finalized

---

## 21. Current Release Blockers

[ ] Production dependency vulnerabilities
[ ] Endpoint policy renewal
[ ] production-apk profile/environment correction
[ ] Mobile deterministic test completion
[ ] Website deterministic certification completion
[ ] API lint completion
[ ] Website lint completion
[ ] Seven-migration production plan
[ ] Migration forward-recovery/rollback plan
[ ] Production configuration verification
[ ] Credential reconciliation/rotation
[ ] Website deployment certification
[ ] Final Android build
[ ] Final iOS build
[ ] Physical production acceptance

---

## 22. Release Decision

Current decision:

**PRODUCTION RELEASE CERTIFIED: NO**

Candidate:

9e6a0b0efca61759ab8329452801db8765d435e9

Do not merge/deploy until release blockers are closed and certification is
rerun successfully.

---

## 23. Release History

### 2026-10-05 / 2026-10-06 — Institutional Production Candidate

Candidate:
9e6a0b0

Milestones:

- institutional physical acceptance performed
- organization/facility hierarchy physically proven
- Technical Support physically activated
- first Facility Admin physically activated
- Operator physically activated
- Resident dual-proof enrollment physically proven
- candidate hardening completed
- 768-test pre-release automated gate passed
- release candidate committed
- release candidate pushed remotely
- production certification performed
- certification returned NO
- blocker remediation started

Final production release:

PENDING

---

## 24. Rule for Future Releases

Every production release must update this ledger.

No production release may rely solely on:

- chat history
- terminal history
- local evidence
- memory
- screenshots
- uncommitted test results

The release ledger must identify:

WHO approved it
WHAT SHA shipped
WHAT migrations shipped
WHAT mobile builds shipped
WHAT website/API builds shipped
WHAT tests passed
WHAT physical acceptance passed
WHAT was deferred
WHEN deployment occurred
HOW rollback/forward recovery works


### 2026-10-06 — Dependency Topology Investigation

No dependency changes made yet.

API installed topology:
- @nestjs/core 10.4.22
- @nestjs/platform-express 10.4.22
- express 4.22.1
- proxy-addr 2.0.7
- multer 2.3.0
- africastalking 0.8.3
- africastalking -> axios 1.18.1
- africastalking -> joi 18.2.5

Website installed topology:
- next 16.2.10
- next -> postcss 8.4.31
- next -> sharp 0.34.5
- baseline-browser-mapping 2.10.43
- source-map-js 1.2.1
- separate @tailwindcss/postcss path uses postcss 8.5.26

Mobile key topology:
- expo 54.0.35
- react-native 0.81.5
- expo-router 6.0.24
- axios 1.18.1
- @xmldom/xmldom 0.8.13 under Expo CLI/plist tooling
- undici 6.27.0 under Expo CLI

Decision:
- DO NOT run npm audit fix --force.
- DO NOT blindly upgrade Nest major version.
- DO NOT downgrade Expo or blindly change React Native major/minor.
- Classify runtime versus build/test dependency exposure.
- Remediate each dependency family deliberately and rerun affected regression gates.


### 2026-10-06 — Dependency Remediation Targets

Registry investigation completed before package modification.

Available versions observed:

- proxy-addr: 2.0.8
- express latest: 5.2.1
- multer latest: 2.4.0
- africastalking latest: 0.8.3
- axios latest: 1.20.0
- joi latest: 18.2.9
- next latest: 16.3.8
- sharp latest: 0.35.5
- postcss latest: 8.5.29
- source-map-js latest: 1.2.2
- @xmldom/xmldom latest: 0.9.12
- undici latest: 8.11.2

Important:
Available latest version is not automatically an approved production target.

Initial remediation order:

1. proxy-addr critical
2. website Next.js critical dependency family
3. Africa's Talking / Axios / Joi dependency family
4. remaining API moderate findings
5. mobile runtime-vs-tooling classification

No npm audit fix --force.
No blind Nest major upgrade.
No blind Expo/React Native upgrade.


### 2026-10-06 — Dependency Remediation #1: proxy-addr

Status: CLOSED

Previous:
- proxy-addr 2.0.7
- severity: CRITICAL
- production audit: 8 vulnerabilities
- 1 critical / 3 high / 4 moderate

Remediation:
- Added root npm override:
  proxy-addr = 2.0.8
- package-lock resolved to proxy-addr 2.0.8
- installed dependency verified:
  express 4.22.1 -> proxy-addr 2.0.8 overridden

Post-remediation production audit:
- 7 vulnerabilities
- 0 critical
- 3 high
- 4 moderate

No Express major upgrade.
No Nest major upgrade.
No npm audit fix.
No npm audit fix --force.

Remaining API production families:
- axios / africastalking
- joi / africastalking
- @nestjs/core / @nestjs/platform-express
- multer

Separate environment observation:
africastalking 0.8.3 declares npm >=11.12.1.
Current npm is 10.9.8.
No npm/toolchain change made yet.


### 2026-10-06 — API Production Dependency Checkpoint

Production audit after proxy-addr remediation:

- Critical: 0
- High: 3
- Moderate: 4
- Total: 7

CLOSED:
- proxy-addr 2.0.7 -> 2.0.8
- critical IP-spoofing advisory removed from production audit

OPEN:
- axios 1.18.1 via africastalking 0.8.3
- joi 18.2.5 via africastalking 0.8.3
- @nestjs/core / platform-express advisory family
- multer 2.3.0 advisory

Africa's Talking investigation:
- SDK 0.8.3 pins axios 1.18.1 and joi 18.2.3.
- Disposable npm 11 resolution proved scoped overrides can resolve:
  axios 1.20.0
  joi 18.2.9
  with zero vulnerabilities in the isolated SDK test.
- Existing production lockfile does not surgically re-resolve those packages.
- Full lock regeneration materially changes the dependency graph and was
  rejected as an unsafe shortcut for this remediation.
- No forced downgrade of Africa's Talking.
- No Nest major upgrade.
- No lockfile replacement.

Status:
API dependency certification remains OPEN, but critical finding is CLOSED.


## 25. Apple App Review — 2026-10-06

Submission ID:
3dce3b60-c847-4be8-a642-3f3d5f9cd2f9

Reviewed version:
1.0 (5)

Review device:
iPad Air 11-inch (M3)

Result:
REJECTED / ACTION REQUIRED

### Guideline 2.1 — App Completeness / Information Needed

Apple reported that the supplied App Review demo account could not sign in.

Production requirement:

- Provide a valid production-accessible App Review account.
- Physically verify the exact credentials from a clean session before submission.
- Verify the account can access the functionality Apple needs to review.
- Do not record the review-account password in Git or this ledger.

Status:
OPEN

### Guideline 5.1.5 — Privacy / Location Services

Apple requires:

1. A EULA.
2. A disclaimer in the EULA addressing the specific emergency/location
   services offered.
3. Evidence that the intended emergency/security response recipient can
   receive and identify the location of the individual in distress.

Production requirement:

- Add/verify EULA presentation and acceptance as required for the release.
- Ensure product language accurately describes OPA's actual response model.
- Do not claim automatic police, ambulance, fire-service or government
  emergency dispatch unless that integration actually exists and is enabled.
- Physically prove the production emergency chain:
  enrolled resident -> SOS/location -> production API ->
  authoritative facility -> authorized Command Center responder ->
  identifiable incident location.
- Capture evidence suitable for replying to App Review.
- Explain any limitations and response dependencies accurately.

Status:
OPEN

### iOS Release Decision

Build 1.0 (5) will not be treated as the final production candidate.

A new iOS production EAS build is required because the current release
candidate also contains mobile enrollment/navigation corrections.

The next iOS build must incorporate and physically verify the Apple review
requirements before resubmission.

Final iOS buildNumber:
PENDING
