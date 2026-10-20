# Release: Duty Reports + staff profiles (database 45 → 46)

Build: `wip/release-simplification-20261015` at the commit that adds this file, or later. Migration `20261020010000_duty_reports_staff_profiles` is additive only: four new FacilityType values, five nullable User photo columns, the DutyShift and DutyReport tables, three enums and the `duty_report_immutable` trigger.

Database package: `opa-release-db-duty.zip`, which contains the runner, `activate.sql` (`a88b43b9…`, unchanged), `cleanup.sql` (`8cdfc636…`, the EstateFlow cleanup plus the duty objects), the migration and the schema. The runner pins all of these by hash.

Rehearsed on PostgreSQL with the production role layout (activate → migrate as `opa_production_migrations` → cleanup). Result: migrator-owned objects 0, duty tables owned by `opa_production_release_owner`, runtime can write them, 4 sector types, trigger present, and the migrator is no longer a member of the owner role.

**Order matters.** Once migration 46 is applied, the running API (`2b0df79`) keeps serving but cannot restart. Steps 2 to 4 run back to back. There is no instant rollback (the old build can't start on 46): fix forward.

## 0. Before you start
- **No emergencies in progress.** `check` refuses while any incident is OPEN or ACKNOWLEDGED, or while any SafeWalk is active. The resident who raised the test SOS must close it from the phone first (only the resident can close their own incident).
- One PowerShell window for the script and a second one for `az webapp ssh`.
- Save `opa-release-db-duty.zip` to Downloads and check its SHA-256 matches the one Claude gave you.

## 1. Run the release script (window 1)
```powershell
cd C:\Projects\OPA-release-simplification
git pull
powershell -ExecutionPolicy Bypass -File .\ops\production-release\release-api.ps1 -PreviousPolicy ".\artifacts\release-2b0df79\api-release-2b0df79.signed.json" -DbPackage "$env:USERPROFILE\Downloads\opa-release-db-duty.zip" -DbPackageSha <sha256 from Claude>
```
The script runs steps 1–4: build (expect `MIGRATIONS=46`), sign, stage, and upload the database package. It then pauses and asks you to type `VERIFY PASS`.

## 2. Migrate (window 2)
```powershell
az webapp ssh -g opa-production -n opa-api-production
```
```bash
cd /home/opa-release-duty && /usr/local/bin/node opa-release-db.cjs check
```
Continue only if it prints `READY_FOR_ACTIVATE true` (ledger 45, no open incidents, no active SafeWalk). Then paste all of this at once:
```bash
cd /home/opa-release-duty; echo "RESTORE_POINT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
/usr/local/bin/node opa-release-db.cjs activate
/usr/local/bin/node opa-release-db.cjs migrate
/usr/local/bin/node opa-release-db.cjs cleanup
/usr/local/bin/node opa-release-db.cjs verify
```
Expect `VERIFY PASS` with `ledgerApplied: 46`, `dutyTablesOwnedByReleaseOwner: 2`, `staffPhotoColumns: 5`, `sectorFacilityTypes: 4`, `dutyImmutableTrigger: 1` and `migratorOwnedObjects: 0`.

If any line says FAILED or STOPPED, don't retry. Paste the whole output to Claude. Production keeps serving.

## 3. Back in window 1
Type `VERIFY PASS`. The script restarts staging on the new build, waits for it to be ready, swaps with the probe (expect `FAILS=0`), stops staging and signs the endpoint policy.

## 4. Website
Vercel: promote the newest deployment on this branch that shows **Ready**. Before this release, don't promote anything newer than `91f4b1c`, because those deployments already show Duty Reports and My profile, which need this API.

## 5. Proof (E2E)
1. **Philips:** My profile → upload a photo → it shows "Waiting for your Facility Admin to approve". Reports / Analytics → **Start duty** is disabled, with the photo note. The incident queue still works.
2. **Matt:** Reports & Analytics → "Operator photos to review" → **Approve**.
3. **Philips:** **Start duty**. Raise an SOS from the resident's phone and acknowledge it as Philips. Raise a second SOS and leave it unacknowledged.
4. **Philips:** "Show what OPA has recorded so far" shows Raised 2, Acknowledged 1, Not acknowledged or unknown 1. Add a note and a handover item → **End duty and submit report**.
5. **Matt:** gets the email; Philips never sees Matt's address. Duty Reports → open → **Acknowledge**. Audit shows `DUTY_REPORT_SUBMITTED` and `DUTY_REPORT_ACKNOWLEDGED`.
6. **Profile:** change the password → you're signed out everywhere → sign in with the new password.

Not included in this release:
- Changing an existing facility's type, so Quartz stays "Other" and its reports say "members". This needs a small Super Admin control, which is in the backlog.
- A list of active sessions. "Sign out on all devices" is provided instead.

## 20 Oct: first attempt failed safely; recovery with package v2
At 19:14 UTC, `migrate` stopped on the migration's **first statement**: `must be owner of type "FacilityType"`. FacilityType is a baseline enum still owned by the administrator. Earlier releases transferred only `UserRole` and five tables to the release owner, and the rehearsal had wrongly assumed every object was already transferred. **Nothing was applied**: duty tables 0, photo columns 0, sector values 0. Cleanup restored the idle posture. Prisma recorded the attempt as failed (`ledgerIncomplete: 1`). The running API was unaffected, but it would refuse to restart until that row is resolved.

Package `opa-release-db-duty-v2.zip` (SHA-256 `9a4540ef743003f23dd7b5383df1091f45b422d8aa2c910dca2b46928290ed4b`) adds:
- `prepare.sql` (`61a00948…`): transfers only FacilityType to `opa_production_release_owner`, following the reviewed UserRole pattern, and refuses if the owner is anyone other than the administrator or the release owner;
- `resolve`: `prisma migrate resolve --rolled-back` for that one failed attempt, allowed only while ledger = 45 and none of migration 46's objects exist;
- `check` now prints `READY` and `NEXT` (prepare or activate), plus `facilityTypeOwner` and `failedAttempt`.

The migration file is unchanged (`771ad63b…`). The rehearsal now uses the production ownership contract (baseline owned by the administrator; the five tables, UserRole and newer objects owned by the release owner). It reproduced the exact production error, then passed with prepare → activate → resolve → migrate → cleanup: migrator-owned objects 0, duty tables 2, photo columns 5, sector values 4, trigger 1, no failed attempts pending.

Commands (window 2, after uploading v2 to `/home/opa-release-duty2`):
```bash
cd /home/opa-release-duty2 && /usr/local/bin/node opa-release-db.cjs check
# READY true, NEXT prepare, failedAttempt 1 → then:
cd /home/opa-release-duty2; echo "RESTORE_POINT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
/usr/local/bin/node opa-release-db.cjs prepare && /usr/local/bin/node opa-release-db.cjs activate && /usr/local/bin/node opa-release-db.cjs resolve && /usr/local/bin/node opa-release-db.cjs migrate; /usr/local/bin/node opa-release-db.cjs cleanup; /usr/local/bin/node opa-release-db.cjs verify
```
