# Pilot E2E findings: Quartz (21 Oct 2026)

Physical testing on Android, build 24, against production `47e37bf`, with the website restored to `ba832fb`. Findings only: nothing below has been changed yet. Each fix is approved here before it is built.

## Results so far

| Area | Result |
|---|---|
| SOS with map, foreground | PASS |
| Silent SOS: foreground, lock screen (no PIN to raise it, unlock needed to end it), background | PASS. Location attached at the press, SMS within 1–3 s, Command Center LIVE in about 20–35 s |
| SMS to emergency contacts (Africa's Talking) | PASS (provider accepted; delivery receipt not available) |
| Location buffering during an active SOS | Not yet tested |
| SOS started offline | FAIL (B1–B5) |
| SafeWalk | Blocked: switched off on purpose; Nigeria-first rebuild (Issue #54) |
| EstateFlow | Next |
| Command Center (Technical Support → Facility Admin → Operator) | Itemized walkthrough pending; large |

## Findings

**Mobile app**
- **L1:** no clear setup step for "Allow all the time" location, and no warning when it is missing (FAIL)
- **S1:** raw incident ID shown on Safety controls (FAIL)
- **S2:** "Welcome," shown with no name (FAIL)
- **S3:** "SafeWalk · Private journey" heading on the home screen when no SafeWalk is running (NEEDS IMPROVEMENT)
- **S4:** Log out sits behind Android's navigation bar (FAIL)
- **S5:** "Done – keep the emergency active" doesn't look tappable (NEEDS IMPROVEMENT)
- **S6:** long Silent SOS explanation crowds the home screen (NEEDS IMPROVEMENT)

**Offline / no data**
- **B1:** an on-screen SOS pressed offline is not saved or retried (FAIL, verified)
- **B1b:** lock-screen/notification SOS offline. The trigger is saved on the phone (up to 8) and retried; this still needs a physical test.
- **B2:** the error tells the person in danger to "check your connection" (FAIL)
- **B3:** no SMS fallback when data is off but phone signal is on (NOT BUILT)
- **B4:** the Back button is cut off (FAIL)
- **B5:** no shared ID across an app SOS, its retries and any future SMS or USSD, so there is no cross-channel de-duplication (GAP)

**SafeWalk:** see Issue #54, items 1–13.

**Command Center**
- **C1:** "Last fix 0s ago" shown next to "stale or current freshness unconfirmed" (NEEDS IMPROVEMENT)
- Itemized walkthrough to follow.

## Offline SOS audit: current release verified (v24 = `4155103`)

An earlier source inspection was done on vc12 (`58b5172`). I re-checked the code that build 24 was made from:

| Capability | v24 finding |
|---|---|
| Online SOS (screen, lock screen, background) | PASS, physically tested |
| Server SMS to emergency contacts (Africa's Talking) | Implemented; PASS (provider accepted) |
| SMS permission or SMS code on the phone | **None.** Android permissions are location, foreground service and microphone only |
| On-screen SOS queued when offline | **No.** One HTTP attempt, then an error screen |
| Lock-screen/notification trigger queue | Present (native store, up to 8, retried until acknowledged); physical test pending (B1b) |
| Trigger ID or request key sent to the server | **No.** `/incident-orchestrator/activate` carries only trigger type, mode, source, confirmation and location. Duplicates are avoided only because the server reuses an open incident (re-trigger). |
| Press time sent with the SOS | **No.** A retried trigger would be timed on arrival, not when it was pressed (B6) |
| Location buffering during an active SOS | Implemented (SQLite queue and replay); physical replay not yet tested |
| SMS/HTTP reconciliation, cross-channel ID | Not present (B5) |

- **B6:** the SOS carries no press time, so a delayed or retried activation is timed on arrival (GAP)
- **Direction:** one emergency delivery coordinator. A stable ID is created at the press and stored on the phone. States: *pending on the phone → acknowledged by the server → SMS submitted → reconciled → delivery uncertain*.
- **Rules for SMS:** a phone-originated SMS never becomes a trusted incident without verified ingestion (anti-spoofing and anti-replay). Automatic background SMS depends on Google Play SMS-permission policy, so it is not promised until feasibility is confirmed; a one-tap composer is the safe default.
- **Approval:** this is a design before implementation and needs founder approval. No code, deployment or settings change until then.

## EstateFlow E2E (in progress): core visit lifecycle PASS, owner: "a milestone"

| # | Step | Result |
|---|---|---|
| 1 | Resident creates a visitor pass (Bryan, "Bk 30 shagarri estate", valid until 22 Oct 22:48 WAT) | PASS |
| 2 | Gate: code 121833 checked → "Code accepted", visitor name, masked phone (•••• 9196), destination and validity shown | PASS |
| 3 | Gate: **Admit** → "Visitor admitted"; Bryan shown under "Recorded inside", in 23:01, expected out 00:01 | PASS |
| 5a | Wrong code recorded in "Today at the gate" (22:50 · Wrong code) | PASS (rate limit still to test) |
| 4 | Gate: **Record exit** → "Exit recorded"; inside list empty; log shows 23:20 Left; resident pass shows **Left** | PASS |
| 6 | Resident cancels a pass before arrival → shows **Cancelled**; the code at the gate is refused with a neutral "No valid visitor pass for this code at this estate" (reveals nothing); recorded as Wrong code | PASS |
| 5b | 10 wrong codes in 10 minutes → "Too many incorrect codes. Wait 10 minutes, or call the resident to confirm the visitor." (limit 10 per guard and 50 per estate per 10 min) | PASS |
| 7 | Manual entry → "Manual entry recorded." | PASS (recording); see G4, G5 |
| 8–9 | Overstay, estate overview | pending |

**Resident (mobile) EstateFlow findings**
- **E3:** while the visitor is inside, the resident's pass still said **"Waiting at gate"**; it showed **Left** after the exit. The status updates on reload, not live. Expected: "Inside since 23:01" (NEEDS IMPROVEMENT)
- **E4: withdrawn (owner decision, 21 Oct).** Correct as built: **only the gate records exits**. Residents can **cancel before arrival only**; once the visitor is inside, Cancel is refused with a clear explanation. PASS, by design.
- **E5:** the stay-length button "Overnight" is cut off ("Overnigh") (FAIL)
- **E6 (owner):** stay length should be set with **hours and minutes** pickers. Proposed:
  - two drop-downs side by side, **Hours (0–36)** and **Minutes (0–59, every minute)** (owner clarification), for example 1 h + 45 min;
  - quick chips (1 h, 2 h, 4 h, Overnight) kept;
  - **estate-configurable maximum** (for example Kurudu might allow 12 h), with **36 h as the platform ceiling**. The minimum stays **15 minutes** (current database rule) unless changed deliberately;
  - pass validity, approved stay and actual entry/exit stay **separate records**. A visitor past the approved stay is marked **overdue**, never checked out automatically;
  - the result shown as "until 02:30 tomorrow".
  (NEEDS IMPROVEMENT)

**Gate findings**
- **G1:** every wrong attempt logged with its time (PASS)
- **G2:** repeated "Wrong code" lines flood the log and push real entries and exits out of view. Group them ("10 wrong codes, 23:56–23:58") and show a "Possible code guessing" warning (NEEDS IMPROVEMENT)
- **G4:** a manual entry is not counted as inside ("Recorded inside (0)"), so there is no exit record and no overdue flag for exactly the visitors who were never verified (FAIL)
- **G5:** the visitor-code field keeps the previous code after another action (NEEDS IMPROVEMENT)
- **G3:** the lockout does not say when the gate works again. Show "Try again at 00:08" (NEEDS IMPROVEMENT)

**Facility Admin findings**
- **A1 (owner):** the Overview reads like a diagnostic screen: "Residents in loaded records", "Operators in loaded records", "Loaded records may be limited", raw "COMMISSIONING", "SMS: CONFIGURED" and "Configured… does not prove credentials". Proposed:
  - true totals ("Residents 1 · Operators 1 · Pending invitations 0"). The API currently returns **up to 100 members**, so this needs an **authorised count endpoint**; a partial page must not be relabelled as a facility total;
  - "Admitted" is used for **visitors only**; people are counted as Residents, Operators, Active accounts and Pending invitations;
  - a new **Visitors** card: Inside now · Admitted today · Left · Overdue;
  - plain status ("Setting up" instead of COMMISSIONING; "SMS and email ready");
  - qualifications moved behind "About these figures".
  (NEEDS IMPROVEMENT)
- **E1:** the Facility Administration dashboard has **no Visitors/Estate section**. Visitor activity is only in the operator console (`/operator/estate`, "Estate overview"), which an admin would not find from their dashboard (FAIL)
- **E2:** facility type shows "Other" for an estate (backlog: facility type edit and sector types)
- **I1:** Insight shows raw codes ("SOS BUTTON", "LOCK SCREEN", "PROVIDER ACCEPTED"); the label sweep was reverted with the website restore (NEEDS IMPROVEMENT)
- **I2:** Insight figures match the tests exactly (6 incidents, 4 lock screen, 5 silent, 6 provider-accepted) (PASS)

## EstateFlow finishing scope (owner, 21 Oct): before Kurudu Estate

**Build:**
- professional Facility Admin visitor oversight (E1, A1, with true counts);
- configurable visit duration (E6);
- overdue-visitor visibility;
- manual entries tracked as inside (G4);
- gate log grouping and lockout time (G2, G3);
- E3, E5, G5;
- the remaining negative and security E2E cases.

**Preserve, already physically verified:**
- six-digit verification and the wrong-code limit;
- the operator alone admits and records exits;
- residents cancel before arrival only;
- immutable gate history.

## Proposed resilience package (owner plan, 21 Oct): design before building

1. **Offline SOS queue** (B1, B2, B5): every SOS is saved on the phone with the true press time and location, then sent automatically when any connection returns. One emergency ID across every channel.
2. **SMS fallback** (B3): when there is no data but there is signal, OPA opens a pre-written SOS text with the location. Play does not allow apps to send SMS silently, so it takes one tap. Option: an inbound OPA number on Africa's Talking, so the text creates the incident on the server.
3. **USSD SOS:** dial `*code#` from any phone, including feature phones, to raise an SOS for a registered number. This needs a USSD service code from Africa's Talking (a shared code is quick; a dedicated code takes weeks), plus pricing.
4. **Network failover:** retry across Wi-Fi, mobile data, SMS and USSD, with honest status shown to the user.
5. **Operator without a computer:** the on-duty operator receives each incident by SMS and replies with short codes (for example `ACK 4821`, `DISP 4821`) to acknowledge and dispatch. This needs two-way SMS (an inbound number or short code). Later, a mobile Command Center.

## Fix plan by priority (21 Oct): approve before building

**P0: safety-critical, fix first**
1. **Offline SOS lifecycle** (B1, B1b test, B2, B5, B6): save on the phone, stable emergency ID, true press time, automatic resend; error wording for someone in danger.
2. **Location permission onboarding** (L1): a required first-run step for "Allow all the time", and a visible warning when location is off.
3. **iOS release:** the TestFlight upload of 1.0.0 (7) failed on 19 Oct; fix it and resubmit (see iOS below).

**P1: before the Kurudu pilot and the bank demo**
4. **EstateFlow finishing scope:** E1, A1 (with true counts), E6, G4, overdue visibility (test 8), E3, E5, G2, G3, G5.
5. **Command Center walkthrough** (Technical Support → Facility Admin → Operator), itemized; C1; I1 (plain labels, applied screen by screen).
6. **Mobile screen defects:** S1–S6, B4.
7. **Facility type and edit** (E2, release 48) plus sector types.

**P2: next level (designed first, then one release each)**
8. **SafeWalk Nigeria** (Issue #54), switched on only after physical E2E on Android and iOS.
9. **Resilience package:** SMS fallback, USSD SOS, network failover, operator SMS dispatch (two-way SMS).
10. **How OPA staff activity appears to Facility Admins** (decision pending), plus the release-process simplification review.

## iOS
- **I-OS1:** App Store Connect shows 1.0.0 (7) **Failed** (19 Oct 03:11). Reason to be read from App Store Connect.
- **Suspected cause:** `app.json` has **no `NSMicrophoneUsageDescription`**, but the app records audio (voice protection: Picovoice, Android `RECORD_AUDIO`). Apple rejects binaries that use the microphone without that purpose string (ITMS-90683). Location strings are present through the expo-location plugin.
- **Fix:** add the microphone purpose string, raise `buildNumber` to 8, rebuild with EAS and submit to TestFlight.
- **Done 21 Oct:** `b6eeaf5`. iOS **1.0.0 (8)** built (EAS `2f34638e`) and **uploaded to App Store Connect** at 19:51 CT (submission `9e3a11c9`). Apple processing is pending; then add internal TestFlight testers.
- **Submitted for App Store review 21 Oct, 20:34 CT:** iOS App 1.0, build 1.0.0 (8), status **Waiting for Review**. Keep the demo resident account active, with its password unchanged, until Apple decides.
- **I3 (P0, 21 Oct 21:02 CT): build 8 crashes immediately on launch on the owner's iPhone (TestFlight).** Build 8 is the first iOS build to run on a device. Since build 5/6 it adds `expo-build-properties` (deploymentTarget 16.0, `buildReactNativeFromSource: true`, added in `e0309c1` for Picovoice's RCT-Folly pod). Suspects: the Picovoice native pods (voice protection is Android-only; `voice-protection-service.ts` imports Porcupine at top level), or the from-source React Native build. Needs the device crash log (.ips) before changing anything. **Crash log received 22 Oct** (`20D84F18`, iPhone 8, iOS 16.7.16, build 8): `EXC_BAD_ACCESS / SIGSEGV` on the JavaScript thread inside Hermes (`stringPrototypeMatch → getMethod → GCScope`), while at the same moment the TurboModule queue (`com.meta.react.turbomodulemanager.queue`) was building an NSException call stack (`_NSCallStackArray` / `backtrace_symbols`). Reading: a native module threw an Objective-C exception, and React Native converted it into a JavaScript error from the wrong thread, corrupting Hermes. Process ran 21:05:25–21:12:15. App frames are unsymbolicated. The only legacy (non-Expo) native modules on iOS are Picovoice's `PvPorcupine` and `PvVoiceProcessor`; voice protection is Android-only at runtime. **Fix `2dfefa5`: build 9** (Picovoice excluded from iOS, Expo's prebuilt React Native as in build 5). EAS build `53bcdd09` (22 Oct 07:02); uploaded to App Store Connect 22 Oct ~18:50 CT (submission `54eb06fc`). Next: TestFlight check on the iPhone 8 (opens, sign-in, 10 min in background, test SOS with location), then attach 1.0.0 (9) to version 1.0 and submit for review. `eas.json` still has no `submit.production` profile, so `--auto-submit` fails (backlog). **22 Oct 19:12 CT: build 9 also crashes on the iPhone 8.** So Picovoice and building React Native from source are ruled out as the only cause. Waiting for the build 9 crash log, the timing (at launch or after sign-in or minutes of use), and whether build 5 still opens on the same phone. **Owner, 22 Oct 21:11:** build 5 ran on this iPhone without crashing; it was uninstalled only to install 8. Source comparison of 5 (`9e6a0b0`) and 9: dependency versions identical (lockfile adds only expo-build-properties and three helpers); the differences are app code (Visitors screen, enrollment/register/activate screens, FormScreen, password rule, Visitors button on Home), app.json (ITSAppUsesNonExemptEncryption, microphone purpose string) and the committed iOS stub for `opa-protection`. Diagnosis handed to Codex (diagnosis only); Claude reviews and releases the fix. **Root cause found 23 Oct (build 9 crash `E61BEAF1`, 0.6 s after launch):** the faulting frame is `ObjCTurboModule::performVoidMethodInvocation → convertNSExceptionToJSError` (React Native 0.81's off-thread conversion of a native exception), with the JS thread inside `JSError::recordStackTrace`, i.e. a fatal JavaScript error at startup reported through ExceptionsManager. The JavaScript error: `modules/opa-protection/package.json` had `"main": "index.ts"`, so Metro bundled the **Android** file on iOS and `requireNativeModule('OpaProtection')` threw when `app/_layout.tsx` imported it. Proven by exporting the iOS bundle: it contained the native call and not the iOS stub. **Fix:** `"main": "index"`. Re-exported bundles: iOS has the stub and no native call; Android has the native module. Regression test `opa-protection-resolution.spec.ts`. **Build 10.** `eas.json` now has `submit.production` (ascAppId 6813264191) so `--auto-submit` works. Build 5 probably came from a working copy without this main field. Owner is pulling 8 from review and considering resubmitting build 5, which must open and sign in on the iPhone first.
