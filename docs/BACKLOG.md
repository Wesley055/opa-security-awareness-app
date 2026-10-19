# OPA backlog and progress

Single source of truth for what is done, in progress and planned. Update it in the same commit as the work.
Production branch: `wip/release-simplification-20261015` (do not use `main` for releases until the workflow guard is merged).

Last updated: 2026-10-19

## Plan

| Day | Focus | Rule |
|---|---|---|
| Sat 17 Oct (today) | Fix invitation delivery · EstateFlow MVP · mobile UI changes · EAS builds (Android + iOS) | Build day |
| Sun 18 Oct | **E2E and physical testing only.** Navigate every role and flow, record every gap below. | No feature work |
| Mon 19 – Tue 20 Oct | Fix gaps from Sunday · Providus bank needs · presentation readiness | |
| Wed/Thu | Providus presentation | |

## Sunday 18 Oct acceptance agenda (testing only)

Each failure gets: steps to reproduce, expected vs actual, severity, owner, evidence, and a row in "Gaps found".

1. Authentication and authorization: Super Admin, Technical Support, Facility Admin, Operator, Head Office
2. Resident onboarding: invitation, short reference, 4-digit email + SMS codes, password rule, activation (web and both apps); **bulk invitation** (2–3 real rows from Command Center → Residents → Bulk add)
3. EstateFlow: visitor pass (QR + code), gate entry, exit, overstay alert, visitor context on SOS
4. Android and iOS: install, sign in, SOS, notifications, mobile UI
5. Providers and billing: Africa's Talking (fix 401, live username + new key, sender ID, one real SMS), Resend (delivery + spam placement), Google Maps, Azure billing / budgets
6. SafeWalk (live location, escalation) — not yet physically tested
7. Silent SOS — not yet physically tested
8. SSO sign-in — not yet physically tested
9. OPA Insight, AIR, corrective actions, audit trail, Head Office view
10. Resilience: network loss, retries, restart recovery, privacy and tenant isolation

## In production (verified)

| Date | Commit | What | Evidence |
|---|---|---|---|
| 15 Oct | migrations 36–42 | 14-day-stuck production migration applied | 42 / 0 ledger |
| 16 Oct | `bff1579` | Expired environment policy no longer takes the API offline | 5 outages ended |
| 16 Oct | `6d98b2a` | Website uses the committed endpoint policy, never crashes on it | |
| 16 Oct | `0a8e418` | Insight reports Command Center acknowledgement time | |
| 17 Oct 02:21 UTC | migrations 43–44 | Head Office schema: `ORGANIZATION_ADMIN`, `User/EnrollmentRequest.organizationId`, `Facility.region` | `VERIFY PASS`, 44 / 0, migration role idle |
| 17 Oct 02:45 UTC | `d718c64` | Head Office (bank) cross-branch Insight, branch regions, Head Office invitations | swap probe 0 failures |
| 17 Oct 17:15 UTC | `d032e66` | 4-digit email + SMS enrollment codes (both required, 5 attempts, keyed HMAC); passwords 8–64 with letters + number/symbol; simpler enrollment page | swap probe 0 failures |
| 18 Oct 01:24 UTC | migration 45 | EstateFlow schema: `VisitorPass`, `GateEvent`, estate visitor settings | `VERIFY PASS`, 45 / 0, new tables owned by release owner, migration role idle; restore point 01:23:53 UTC |
| 18 Oct 01:28 UTC | `7045bde` | EstateFlow API (visitor passes, gate, overstay sweep, SOS visitor context, estate overview) | swap probe 0 failures; staging stopped after swap |
| 19 Oct 05:13 UTC | `79b6120` | Short invitation reference `OPA-XXXXXX` in SMS/email; **new Africa's Talking key** (Key Vault `fbda6376…`, signed binding) | swap probe 0 failures; staging stopped; endpoint policy `3c33d1a` (valid to 17 Jan 2027) |

## In progress

- [x] Invitation delivery diagnosed (17 Oct): **email works** (Resend: every enrollment email SENT + DELIVERED, including after `d032e66`; check spam). **SMS has never been delivered from production**: every Africa's Talking attempt since 15 Oct failed; root cause is **HTTP 401 from Africa's Talking** (key clean, `atsk_`, 77 chars; username 9 chars) — the API key is invalid/revoked or does not belong to that username. Fix moved to Sunday E2E (provider setup). Note: the signed API policy may pin secret versions/hashes, so a key rotation needs Key Vault version → re-sign → swap.
- [x] EstateFlow MVP built (not yet deployed): `ac8333c` API + migration 45, `4cbb8cc` Gate screen / Estate overview / SOS visitor context, `be9693b` resident Visitors screen. Code-first, QR optional (P1). API 1089 tests, website 556, mobile 281.
- [x] EstateFlow API + migration 45 released (18 Oct 01:28 UTC).
- [x] EstateFlow website promoted (Vercel, `87f9b1c`); Estate overview and Gate verified live.
- [x] Endpoint policy re-signed for API `7045bde` (`9cc77df`, valid to 16 Jan 2027).
- [x] Android store build vc22 (`.aab`) built 17 Oct.
- [x] Production APK vc23 (`5e82ad86`) built from API `79b6120` policy; installed on the Android test phone 19 Oct; enroll / create-account screens verified.
- [x] iOS build 7 **built 19 Oct** (`fb49719e`) after fixes `04678bf` (iOS 16.0), `e0309c1` (React Native from source for Picovoice/RCT-Folly), endpoint policy for API `79b6120`. Next: TestFlight. App Review currently holds **1.0.0 (5)**.
- [ ] Submit to stores only after Sunday testing passes.
- **Release rule:** after every API release, re-sign the endpoint policy (`sign-endpoint-policy.py --expect-build <sha>`) before any mobile build; the build-time check requires the live API build to match.
- [x] Mobile enrollment UI (`ce36c8e`, in repo, ships with next app build): visible placeholders, status-bar padding, full button label, hidden reference from link, 4-digit fields, 8–64 password rule on enroll/activate/reset. tsc clean, 279 tests pass.
- [ ] EAS builds Android + iOS from the agreed commit (runs on the founder's PC; needs Expo account).

## Planned

### EstateFlow (estate readiness)
- [x] Estate overview landing for facility admins (open incidents, visitors inside, departures not confirmed, entries/passes today, gate activity, visitor settings).
- [x] Visitor passes: six-digit code (shown once, estate-scoped HMAC, encrypted visitor identity), share via SMS/WhatsApp, new code, cancel.
- [x] Gate: type code, confirm visitor + house, admit / deny / exit, recorded-inside list, manual entry, offline banner, wrong-code limits (10 per guard, 50 per estate / 10 min).
- [x] Overstay: "departure not confirmed" after expected exit + estate grace (default 240 min / 30 min, configurable).
- [x] SOS context: incident shows visitors recorded for the household.
- [ ] **Visitor stay extension (P0, not built yet — record as outstanding on Sunday, build Monday).** Resident extends an active visit from the app, within estate limits; after an overstay it needs security review (no silent clearance); revoked, denied or departed passes cannot be extended; the gate shows the new departure time; overstay uses the latest approved time; every extension is audited (old time, new time, who, reason); never authorizes re-entry after a recorded exit.
- [ ] Overstay **SMS/push to the host resident** (today it shows on the gate, overview and the resident's pass list).
- [ ] QR code on the pass + optional camera scan at the gate (P1).
- [ ] Visitor SMS with the code sent directly by OPA (today the resident shares it).
- [ ] Resident register by phase / street; estate notices.
- [ ] Resident register by phase / street.
- [ ] Estate notices to all residents.

### Platform
- [ ] **Onboarding model (final, Issue #47, 18 Oct):** (1) Create OPA account = personal only, no facility access; (2) Accept invitation = short reference + two 4-digit codes; (3) **Join your estate** = optional, off by default, signed-in users only, estate-issued join code (no admin identity shown), Command Center queue with batch approve/decline, no estate access until approved. Schools/banks invitation-only by default. Design sign-off before code; build after Providus. **Bulk invitation with emails only** (resident adds and verifies own phone during activation) — see Issue #47 addendum.
- [ ] Staff profiles (Monday): display name, phone, notification settings and in-session password change for operators, facility admins and technical support; photo **mandatory for operators** (cannot go on duty without an approved photo), optional for others; residents see the responding operator's name and photo during an active SOS; no demo/placeholder staff names in production.
- [ ] Switch off background workers in the staging slot (slot setting), so a build waiting in staging never sends messages or alerts.
- [ ] Technical Support workspace, phase 1: Accounts & OTP diagnostics, Notification diagnostics (metadata only; codes never shown).
- [ ] Temporary Access needs approval from both OPA Super Admin and the customer's administrator.
- [ ] Insight API: Super Admin needs Temporary Access for facility Insight (currently allowed on any facility).
- [ ] Mobile enrollment screen: 4-digit codes + new password rule (committed in `d032e66`, ships with next app build).
- [ ] Review the ~100 uncommitted files in `C:\Projects\OPA` (`integration/institutional-security`); keep or discard deliberately.

### Monday 19 Oct morning — pick up here
Done overnight: SMS fixed (API `79b6120`), APK vc23 + iOS build 7 built, pilot facility **Quartz** (COMMISSIONING) with Technical Support **Alex Moore** active and assigned.
1. [ ] **Build "Retire test account"** (Super Admin): deactivate an old test/demo account and release its phone + email, with reason, audited; refused for active staff and Super Admin. Then retire the demo accounts. *Blocks the pilot: every tested number is held by an old account.*
2. [ ] Vercel: promote `a5750d2` or later (readable enroll Resume step).
3. [ ] iOS: `eas submit --platform ios --latest` → TestFlight 1.0.0 (7).
4. [ ] Pilot: ~~Alex re-invites **Matt Hays** (first Facility Admin)~~ **done 19 Oct 16:28 UTC, Matt signed in to Quartz** → Matt invites **Philips** (operator) → residents (single + bulk). Then SOS + Google Maps, silent SOS (lock screen / foreground / background), airplane-mode buffering, AIR / Insight.
5. [ ] **OPA Pulse (internal CRM)**: review the other agent's branch `codex/opa-pulse-design-20261018` (auth and roles, no customer safety data, secrets in Key Vault, dependencies, backups; separate database and resources from OPA production), then deploy to its own resources.

### Monday 19 Oct build (one API + web + app release, Monday night)
- [ ] **Staff profiles** (needs migration 46: photo): photo (mandatory for operators, admin-approved), display name, phone, notification settings; residents see the responding operator's name + photo during SOS.
- [ ] **In-session password change** and **sign out** on every staff screen (web) and the app settings screen.
- [ ] **Shift summary email (operator → facility admins)**: "Send shift summary" in the Command Center emails the facility's admins (OPA looks up their verified addresses; the operator never sees them): incidents opened/closed, response times, gate entries/exits, departures not confirmed, notes. Optional automatic daily summary. No resident contact details in the email.
- [ ] **Email-only bulk invitation** (Issue #47 addendum) + its acceptance tests.
- [ ] Visitor stay extension (P0), overstay SMS.
- Demo data is **data, not code**: no "demo" names exist in the Command Center code. Replace by creating the real pilot estate and staff accounts; deactivate (never delete) demo users/estates so the audit trail stays intact.

### OPA Insight industry modules (planned, not built)
One Insight platform with industry modules, not separate engines: Insight Core → **Insight Energy** (Oil & Gas: permit-to-work, contractor competency and authorization, hazardous-area access, HSE incidents, inspections, corrective actions) → **Insight Aviation** (occurrence reporting, maintenance findings, personnel authorization, airside access, corrective-action verification; scope depends on airline / airport / MRO / ground handler). Shared evidence and reporting; different inputs, control libraries and outputs. Regulatory mappings must be verified with qualified domain specialists; OPA does not claim certification or regulatory approval from its reports.

### SmartBranch and SchoolShield (after Providus)
- [ ] One-page product specs (no code yet): users, five core workflows, OPA reuse, new pieces, Nigerian operating conditions.
- [ ] Sales exec discovery: 3 schools, 2 bank branches; position SmartBranch to Providus as a 2027 rollout with Providus as design partner.

### Bank (Providus)
- [ ] Demo organization with two branches and regions; Head Office account; end-to-end SOS shown on Head Office view.
- [ ] Verify item 2 (offline CIT van) and item 5 (measure sub-5-second alert claim, test escalation).
- [ ] REST API v1, organization-scoped API keys and webhooks: design after the presentation.
- [ ] Pilot proposal document.

### Internal CRM (built by the other agent; reviewed and deployed by Claude)
- [ ] OPA's own internal CRM for sales and progress (leads, deals, stages, notes). Separate repo/folder and database from the OPA product; never the production API or production PostgreSQL.
- [ ] Review before deployment: authentication and roles, no customer safety data, secrets in Key Vault (not in code), dependencies, backups. Deployment by Claude only, to its own resources.

### Operations and security
- [ ] Move the PostgreSQL admin credential out of App Service settings.
- [ ] Off-machine backup of the release signing key.
- [ ] Merge the staging-slot workflow guard to `main`, then make `main` the release branch again.
- [ ] Commit the database release runner (`opa-release-db.cjs`) to `ops/production/` for future migrations.

## Gaps found in testing

Record each gap as: date · role · screen · what happened · expected · severity (blocker / major / minor).

| Date | Role | Screen | What happened | Expected | Severity |
|---|---|---|---|---|---|
| 17 Oct | Facility admin | Dashboard | Only Residents and Reports; looks empty | An estate overview | major |
| 17 Oct | Super admin | Invite | SMS never delivered: Africa's Talking returns 401 (email delivered). **Cause (18 Oct):** a new key was generated on the live app during sandbox setup, revoking production's key. Fix: new key released in `79b6120` | SMS within a minute | blocker — **FIXED, verified 19 Oct 07:06 UTC**: Technical Support invitation SMS + email delivered to a Nigerian number |
| 18 Oct | Build | iOS EAS | `pod install`: no RCT-Folly for Picovoice voice-processor (Expo 54 prebuilt RN) | Build passes | blocker (fixed `e0309c1`: build RN from source) |
| 18 Oct | Build | Android APK | `production-apk` rejected at "Read app config" (endpoint check had its own profile list) | APK builds | blocker (fixed `b13dcf2`; APK f62a643a built) |
| 18 Oct | Tester | Android install | APK will not install over the Play/older build ("package conflicts") | Clear instruction | minor (uninstall first; note in tester guide) |
| 18 Oct | Resident | Mobile enroll | "Invitation reference" is the 36-character request ID (UUID): impossible to type, only works via the link, and the link opens the website, not the app | Short reference a person can type or paste, or no reference at all (email/phone + both codes) | major (fixed `19ff3ab`: `OPA-XXXXXX` in SMS + email, no DB change; release 18 Oct) |
| 18 Oct | Resident | Mobile enroll (Android) | Intro text cut off ("…then choose your" — "password." missing) | Full text at any system font size | major (fixed `19ff3ab`; **verified on device, APK vc23, bold font, 19 Oct**) |
| 18 Oct | Public | Mobile Create account | "Request enrollment" unclear: fields had no labels, raw error ("email must be an email"), and it was not said that this creates a **personal** account (codes go to the person; nothing goes to a facility admin) | Plain purpose, visible labels, plain errors, route invited people to Accept invitation | major (fixed; **verified on device, APK vc23, 19 Oct**) |
| 19 Oct | Technical Support | Web enroll → Resume | Resume screen: invisible Email/Password boxes, unclear wording (asks to "resume" with no codes), weak buttons | Visible fields, plain wording (codes are single-use; sign in to finish), clear primary button | major (fixed on branch; Vercel promote) |
| 19 Oct | Super admin | Invite | When contact details already belong to an account, the message does not say so | After both codes: say the email/phone already belongs to an OPA account; warn the inviter before sending | minor (Monday) |
| 19 Oct | Technical Support | /institutional sign-in | Browser autofilled a different (non-staff) account; page only said "Sign-in was not accepted" (403 from context) | Say "This account has no Command Center access" and show which email was used | minor |
| 19 Oct | Technical Support | Commissioning | "Update commissioning state" is greyed out for Technical Support without a Support Case, although first-admin provisioning needs COMMISSIONING and no case (API allows it); Super Admin had to set it | One consistent rule: either TS can start commissioning on an assigned facility, or the screen says "Ask Super Admin to start commissioning" | minor |
| 19 Oct | Facility Admin (first) | Web enroll | Invitation fails ("Enrollment could not be completed") because the phone belongs to an old test account; no tool exists to release a number from an old/test account | Audited "release phone number" for Super Admin (old/test or deactivated accounts only, with reason; never for active staff); clear message that the number is already in use | major (pilot needs fresh numbers until built) |
| 18 Oct | Resident | Mobile SafeWalk (code review) | Destination is typed as latitude and longitude numbers | Pick the destination by name/map or "share my live location" only | major (to confirm in SafeWalk physical test; design Monday) |
| 17 Oct | Resident | Mobile enroll (installed build) | Fields empty on one Android phone (invisible placeholders); title under status bar; button text cut | Readable labels and button | major (fixed in `ce36c8e`, needs new build) |
