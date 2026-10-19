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
- [ ] Production APK (fixed `production-apk` profile in `7f58f1a`) — rebuild if not yet produced.
- [ ] iOS build 7: failed on missing iOS 16.0 deployment target (never committed for build 5); fixed in repo, rebuild. App Review currently holds **1.0.0 (5)**.
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
| 17 Oct | Super admin | Invite | SMS never delivered: Africa's Talking returns 401 (email delivered). **Cause (18 Oct):** a new key was generated on the live app during sandbox setup, revoking production's key. Fix: `docs/releases/2026-10-18-sms-key-rotation.md` | SMS within a minute | blocker (Sunday) |
| 18 Oct | Build | iOS EAS | `pod install`: no RCT-Folly for Picovoice voice-processor (Expo 54 prebuilt RN) | Build passes | blocker (fixed `e0309c1`: build RN from source) |
| 18 Oct | Build | Android APK | `production-apk` rejected at "Read app config" (endpoint check had its own profile list) | APK builds | blocker (fixed `b13dcf2`; APK f62a643a built) |
| 18 Oct | Tester | Android install | APK will not install over the Play/older build ("package conflicts") | Clear instruction | minor (uninstall first; note in tester guide) |
| 18 Oct | Resident | Mobile enroll | "Invitation reference" is the 36-character request ID (UUID): impossible to type, only works via the link, and the link opens the website, not the app | Short reference a person can type or paste, or no reference at all (email/phone + both codes) | major (fixed `19ff3ab`: `OPA-XXXXXX` in SMS + email, no DB change; release 18 Oct) |
| 18 Oct | Resident | Mobile enroll (Android) | Intro text cut off ("…then choose your" — "password." missing) | Full text at any system font size | major (fixed `19ff3ab`: safe-area + keyboard layout, no fixed line heights; next APK vc23) |
| 18 Oct | Public | Mobile Create account | "Request enrollment" unclear: fields had no labels, raw error ("email must be an email"), and it was not said that this creates a **personal** account (codes go to the person; nothing goes to a facility admin) | Plain purpose, visible labels, plain errors, route invited people to Accept invitation | major (fixed in next APK) |
| 18 Oct | Resident | Mobile SafeWalk (code review) | Destination is typed as latitude and longitude numbers | Pick the destination by name/map or "share my live location" only | major (to confirm in SafeWalk physical test; design Monday) |
| 17 Oct | Resident | Mobile enroll (installed build) | Fields empty on one Android phone (invisible placeholders); title under status bar; button text cut | Readable labels and button | major (fixed in `ce36c8e`, needs new build) |
