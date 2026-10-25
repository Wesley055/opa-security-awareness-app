# Release 48: emergency delivery (offline SOS, SMS fallback, USSD) and SafeWalk Nigeria-first — database 47 → 48

Design: `docs/design/2026-10-23-emergency-delivery-sms-ussd.md` (approved by the founder 23 Oct, including the section 10 recommendations).

**What ships, all switched off.** SMS fallback, USSD and SafeWalk do nothing until `SMS_FALLBACK_ENABLED=true` / `USSD_ENABLED=true` / `SAFEWALK_ESCALATION_ENABLED=true` are set in later, separate steps. SafeWalk (Issue #54, approved 24 Oct with the arrival rules) is in the same single migration. This release needs **no production setting or secret changes**.

| Part | Commit |
|---|---|
| Migration 48 and one-press-many-routes activation | `4b4e523` |
| SMS fallback and USSD (server) | `9b16338` |
| App: delivery coordinator, offline queue, Send by SMS | `572c68f` |
| App: Saved places screen | `7b16592`, `a4aa3d3` |
| Command Center delivery summary (API) | `665402d` |
| Command Center delivery summary (website) | `3bed662` |
| SafeWalk Nigeria-first (server) | `ae5853b` |
| SafeWalk Nigeria-first (app) | `936c05a` |

Live immediately after this release, even with both switches off:
- an SOS from the **new app** (Android 25 / iOS 12) carries its activation id and press time, is saved on the phone first, and is retried until OPA confirms it, without ever creating a second alert (fixes B1, B5, B6);
- residents can save up to four places;
- the Command Center shows how an alert arrived.

Older apps work exactly as before.

## Database package

`opa-release-db-48.zip`, SHA-256 `5029d887e86ecafbca9942279722a83db75b921f5ad1e3c88ce9a365fd9866aa`. **This replaces the earlier 48 package (`9899d59b…`), which must not be used.**

| File | SHA-256 |
|---|---|
| `activate.sql` | `a88b43b9…` (unchanged since 46) |
| `prepare.sql` | `f187bb2a…` (**new**) |
| `cleanup.sql` | `ea906124…` (47 cleanup plus 8 tables and 4 enums) |
| migration `20261024010000_emergency_delivery` | `3a6b58cb…` (delivery and SafeWalk in one transaction) |
| `schema.prisma` | `7d1f214f…` |

The migration is additive: eight new tables (five delivery, three SafeWalk: `SafeWalkPlan`, `SafeWalkContactConsent`, `SafeWalkContactNotice`), four enums and `User.preferredLanguage`. It deliberately **does not alter `Incident`, `JourneySession`, `EmergencyContact` or the existing SafeWalk tables**, which may be administrator-owned in production.

**Why prepare is back.** The new tables have foreign keys to `Incident`, `JourneySession` and `EmergencyContact`, and a foreign key needs the REFERENCES privilege. The rehearsal, using the production ownership layout with `Incident` owned by the administrator, reproduced the failure without prepare: `permission denied for table Incident`. Nothing was left behind. `prepare.sql`:
- grants REFERENCES on `Incident`, `JourneySession` and `EmergencyContact` to the scoped NOLOGIN release owner (idempotent; a no-op where the release owner already owns the table); refuses if any of them has an unexpected owner;
- **refuses** unless `User` is already owned by the release owner (release 46 added columns to it).

**Rehearsal** (local PostgreSQL 16, production role layout and ownership contract, with `Incident`, `JourneySession` and `EmergencyContact` administrator-owned as the worst case): migration fails without prepare, as expected, leaving 0 tables. Then prepare (run twice, idempotent) → activate → migrate as `opa_production_migrations` → cleanup:
- migrator-owned objects 0;
- new tables owned by the release owner: 8/8;
- enums owned by the release owner: 4/4;
- `preferredLanguage` column: 1;
- the migrator is no longer an owner member and cannot create objects in `public`;
- tables the runtime cannot read: 0;
- the runtime can insert and update every new table; the language check rejects `fr` and the notice-status check rejects unknown states.

`check` reports `NEXT prepare, then activate`. `activate` refuses (`RUN_PREPARE_FIRST`) until prepare has run. `verify` adds `deliveryTablesOwnedByReleaseOwner 8`, `deliveryTypesOwnedByReleaseOwner 4` and `preferredLanguageColumn 1` to every release-47 condition.

## Steps

0. **No emergency in progress.** `check` refuses while any incident is OPEN or ACKNOWLEDGED, or any journey is active. Save `opa-release-db-48.zip` to Downloads.
1. **Window 1:**
   ```powershell
   cd C:\Projects\OPA-release-simplification
   git pull --rebase --autostash
   powershell -ExecutionPolicy Bypass -File .\ops\production-release\release-api.ps1 -PreviousPolicy ".\artifacts\release-c889a81\api-release-c889a81.signed.json" -DbPackage "$env:USERPROFILE\Downloads\opa-release-db-48.zip" -DbPackageSha 5029d887e86ecafbca9942279722a83db75b921f5ad1e3c88ce9a365fd9866aa
   ```
   Expect `MIGRATIONS=48` (one new migration). It pauses at 4b/7.
2. **Window 2:** `az webapp ssh -g opa-production -n opa-api-production`, then:
   ```bash
   cd /home/opa-release-duty && /usr/local/bin/node opa-release-db.cjs check
   ```
   Expect `READY true` and `NEXT prepare, then activate`. Then paste:
   ```bash
   cd /home/opa-release-duty; echo "RESTORE_POINT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   /usr/local/bin/node opa-release-db.cjs prepare && /usr/local/bin/node opa-release-db.cjs activate && /usr/local/bin/node opa-release-db.cjs migrate; /usr/local/bin/node opa-release-db.cjs cleanup; /usr/local/bin/node opa-release-db.cjs verify
   ```
   Expect `VERIFY PASS` with `ledgerApplied: 48`. If any line says FAILED or STOPPED, don't retry; paste the output. Production keeps serving.
3. **Window 1:** type `VERIFY PASS`. Expect `FAILS=0`.
4. **Vercel:** promote the newest Ready deployment (Command Center delivery summary).
5. **Apps:** Android versionCode 25 (Play) and iOS build 12 (TestFlight first; 1.0.0 (11) is in App Review).

## Switching on (later, separate approval)

Prerequisites, from Africa's Talking on the **live** account:
- a two-way shared short code with a keyword;
- a shared USSD code;
- callback source IPs.

Settings to add to the signed environment policy:

| Setting | Value |
|---|---|
| `SMS_SIGNING_SECRET` | 32 random bytes, base64, Key Vault |
| `AFRICASTALKING_CALLBACK_TOKEN` | 40+ random characters, Key Vault |
| `AFRICASTALKING_SHORTCODE` | the short code |
| `AFRICASTALKING_SMS_KEYWORD` | the keyword |
| `AFRICASTALKING_CALLBACK_IPS` | the source IPs |
| `USSD_LANGUAGES` | `en` (add `ha` only after a native speaker approves the Hausa text in `ussd-text.ts`) |
| `SMS_FALLBACK_ENABLED` | `true` |
| `USSD_ENABLED` | `true` |

Callback URLs to give Africa's Talking:
- SMS: `https://<api>/integrations/africastalking/sms/<token>`
- USSD: `https://<api>/integrations/africastalking/ussd/<token>`

Test against the Africa's Talking sandbox simulator first.

## SafeWalk switch-on (later, separate approval)

Needs the same two-way short code (contacts reply YES / STOP to it) and:

| Setting | Value |
|---|---|
| `GOOGLE_MAPS_API_KEY` | existing server key, if production has one; it must have **Places API (New)** enabled and be restricted to the API server. Without it, search says so and people use saved places or a description |
| `SAFEWALK_ESCALATION_ENABLED` | `true` |

Rules built (owner, 24 Oct): arrival is detected (inside about 100 m, accuracy 50 m or better, for about a minute) and only **asks**; contacts are never told "arrived"; the check stays at +5 min and contacts at +8 min after the expected time; a contact is texted only after replying YES from that number, at most once per journey, and never after "I'm safe", cancel or SOS.

SafeWalk physical E2E (Android and iOS): place search, saved place, description; start; locked phone; arrival prompt and I'm safe from the notification (iPhone asks to unlock); no answer → prompt at +5, contact text at +8 with last location; contact YES and STOP; SOS during a walk stops the contact text; phone off; weak signal; old app still works.

## Physical E2E before switch-on

Design section 9:
1. Airplane mode on-screen SOS → saved → Send by SMS → incident with exact GPS and "Via SMS" → reply SMS → internet back → one incident.
2. Lock-screen SOS offline (B1b).
3. SMS from an unregistered phone → nothing created.
4. Same SMS twice → one incident.
5. USSD on a feature phone on MTN, Airtel, Glo and 9mobile → incident at "Yes, send".
6. Dropped USSD session after "Yes, send" → incident exists.
7. Saved place, landmark and "Can't talk" banner shown to the duty officer.
8. Hausa approved by a native speaker.
9. Old app version still works.

## Not in this release (follow-ups)

- **SafeWalk map pin:** dropping a pin on a map needs a native map library and a mobile Maps key; for now: search, saved places or a description.

- **Facility Admin registering feature-phone residents** (name, phone, language, saved places) with an SMS code confirmed over USSD. Until then, USSD works for residents who enrolled through the app.
- **Lock-screen (native) trigger:** still uses its own durable native queue; it does not yet carry an activation id or offer Send by SMS.
- **Location permission onboarding (L1):** an SOS with no GPS fix at all still stops with an error on the screen.
