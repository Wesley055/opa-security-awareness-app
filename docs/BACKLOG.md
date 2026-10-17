# OPA backlog and progress

Single source of truth for what is done, in progress and planned. Update it in the same commit as the work.
Production branch: `wip/release-simplification-20261015` (do not use `main` for releases until the workflow guard is merged).

Last updated: 2026-10-17

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
2. Resident onboarding: invitation, 4-digit email + SMS codes, password rule, activation (web and both apps)
3. EstateFlow: visitor pass (QR + code), gate entry, exit, overstay alert, visitor context on SOS
4. Android and iOS: install, sign in, SOS, notifications, mobile UI
5. SafeWalk (live location, escalation) — not yet physically tested
6. Silent SOS — not yet physically tested
7. SSO sign-in — not yet physically tested
8. OPA Insight, AIR, corrective actions, audit trail, Head Office view
9. Resilience: network loss, retries, restart recovery, privacy and tenant isolation

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

## In progress

- [ ] **Invitation email/SMS not arriving after `d032e66`** (17 Oct). Staging slot stopped (it ran the old build and sent old-format codes). Collect production logs, check the delivery ledger. **Blocker for Sunday.**
- [ ] EstateFlow MVP: scope to agree before building (see Planned).
- [x] Mobile enrollment UI (`ce36c8e`, in repo, ships with next app build): visible placeholders, status-bar padding, full button label, hidden reference from link, 4-digit fields, 8–64 password rule on enroll/activate/reset. tsc clean, 279 tests pass.
- [ ] EAS builds Android + iOS from the agreed commit (runs on the founder's PC; needs Expo account).

## Planned

### EstateFlow (estate readiness)
- [ ] Estate overview landing for facility admins (open incidents, residents, staff, recent activity). Today the facility admin view is only Residents + Reports and looks empty.
- [ ] Visitor passes: resident creates a pass in the app with a **QR code** and a short code to share; guard scans the QR (or types the code) at the gate.
- [ ] Gate log: visitor check-in / check-out, with denials recorded.
- [ ] Overstay exceptions: visitor still inside after expected exit alerts the gate and the host resident.
- [ ] SOS integration: an incident shows visitors currently inside for that household.
- [ ] Resident register by phase / street.
- [ ] Estate notices to all residents.

### Platform
- [ ] Switch off background workers in the staging slot (slot setting), so a build waiting in staging never sends messages or alerts.
- [ ] Technical Support workspace, phase 1: Accounts & OTP diagnostics, Notification diagnostics (metadata only; codes never shown).
- [ ] Temporary Access needs approval from both OPA Super Admin and the customer's administrator.
- [ ] Insight API: Super Admin needs Temporary Access for facility Insight (currently allowed on any facility).
- [ ] Mobile enrollment screen: 4-digit codes + new password rule (committed in `d032e66`, ships with next app build).
- [ ] Review the ~100 uncommitted files in `C:\Projects\OPA` (`integration/institutional-security`); keep or discard deliberately.

### Bank (Providus)
- [ ] Demo organization with two branches and regions; Head Office account; end-to-end SOS shown on Head Office view.
- [ ] Verify item 2 (offline CIT van) and item 5 (measure sub-5-second alert claim, test escalation).
- [ ] REST API v1, organization-scoped API keys and webhooks: design after the presentation.
- [ ] Pilot proposal document.

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
| 17 Oct | Super admin | Invite | Email and SMS not arriving after `d032e66` | Arrive within a minute | blocker |
| 17 Oct | Resident | Mobile enroll (installed build) | Fields empty on one Android phone (invisible placeholders); title under status bar; button text cut | Readable labels and button | major (fixed in `ce36c8e`, needs new build) |
