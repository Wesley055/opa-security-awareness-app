# OPA — Voice Activation Feasibility Study (Sprint 9.5)

**Purpose:** Determine what is genuinely achievable for OPA's flagship
hands-free voice activation BEFORE committing engineering time to a build.
For the feature that defines OPA, reliability matters more than speed.

**Status:** Desk research complete (OS policy + SDK). Device testing still
required (marked below). This document is the go/no-go basis for the build.

**A caution on these findings:** the OS-policy and SDK conclusions below are
from developer documentation and current platform sources, not from OPA
running on real hardware. The items marked "REQUIRES DEVICE TESTING" cannot
be answered from documents — they must be measured on real iPhones and
Android phones before the flagship claim is trusted.

---

## THE PRODUCT VISION (why this matters)

Every other panic app requires: unlock -> open app -> press button. OPA's
differentiator is hands-free activation: "if you cannot reach your phone,
your voice can still save you." The differentiator is not just the trigger
phrase — it is the whole chain that follows (GPS -> incident -> evidence ->
notify contacts -> live tracking -> command center).

The value scales by "level" — how much of the vision actually works:

- Level 1: app open, voice works
- Level 2: screen locked, voice works
- Level 3: phone in pocket, background service, voice works  <- the real differentiator
- Level 4: offline, voice still works
- Level 5: low battery, still reliable

---

## FINDING 1 — OS POLICY (the make-or-break constraint)

Source: Apple developer forums + AVAudioSession documentation.

**iOS — background microphone recording by third-party apps:**
- IS possible: requires the `audio` background mode (UIBackgroundModes =
  audio) and AVAudioSession category `.playAndRecord`. Apps like Signal,
  Shazam, SoundHound do record in the background.
- BUT is FRAGILE in the background:
  - Phone calls interrupt the audio session; reactivating it while
    backgrounded frequently FAILS (documented: setActive(true) fails after
    a call ends in background).
  - A persistent orange microphone indicator shows the entire time.
  - Continuous recording is a significant battery draw; iOS aggressively
    suspends background apps under battery/memory pressure.
  - APP STORE REVIEW RISK: Apple scrutinizes always-on microphone use
    heavily. An app holding the mic open continuously may be rejected or
    require strong justification. This is a policy risk, not a code problem.

**Android — friendlier:**
- Foreground service with `microphone` service type allows sustained
  background mic access, with a persistent notification.
- Since Android 11, constraints on wake locks / background mic exist but
  are less restrictive than iOS.
- Net: OPA's Level 3 differentiator is likely MORE achievable on Android
  than iOS. This is itself a strategic finding.

**Both platforms:** explicit runtime mic permission required; visible
indicator during use (orange dot iOS / green Android); no truly hidden
listening. Fine for OPA (transparency is desirable for a safety app), but
means "silent always-listening" is not possible and should not be implied.

---

## FINDING 2 — SDK EVALUATION (on-device keyword spotting)

Source: Picovoice Porcupine docs, npm, GitHub (2026).

**Picovoice Porcupine fits OPA well:**
- On-device keyword spotting — runs OFFLINE, no audio leaves the device
  (solves Level 4; strong for privacy/compliance).
- Official React Native SDK (@picovoice/porcupine-react-native) — matches
  OPA's stack; described as the only ready-to-use RN wake-word option.
- Supports custom wake words via a trained .ppn model file.
- Production-proven (Fortune 500 + startups); lightweight by design
  (small always-on model, not full transcription) — helps battery.

**Important constraint on CUSTOM phrases (Pass 3):**
- Porcupine custom wake words are trained in Picovoice's CONSOLE (cloud)
  and downloaded as a .ppn file. They are NOT trained live on-device from
  a user's voice samples.
- So the imagined "user records their phrase 3x, app builds a profile"
  flow is NOT how Porcupine works out of the box.
- Options for true per-user custom phrases: (a) offer a curated SET of
  pre-built phrases users choose from, or (b) build a pipeline that
  generates .ppn files on demand via Picovoice's API. (b) is real work.
- Fixed phrase (Pass 2) has no such constraint — clearly the right start.

**Alternatives noted:** Sensory TrulyHandsfree, SoundHound Houndify
(enterprise, sales-gated, no public RN SDK confirmed). Porcupine is the
pragmatic first choice.

---

## GO / NO-GO BY LEVEL

| Level | Verdict | Basis |
|---|---|---|
| L1 app foreground | GO | Porcupine + foreground, straightforward |
| L2 screen locked | GO | audio background mode; standard for audio apps |
| L3 pocket/background always-on | CONDITIONAL | Possible; iOS fragile + App Store risk; Android friendlier. THE differentiator AND the risk. |
| L4 offline | GO | On-device detection is inherently offline |
| L5 low battery | MEASURE | Efficient engine, but OS suspension + drain need real testing |

**Pass 2 (fixed "Help Help"):** GO to build/prototype.
**Pass 3 (custom phrase):** CONDITIONAL — curated set easy; arbitrary
per-user phrases need a .ppn pipeline. Do after Pass 2.

---

## WHAT STILL REQUIRES DEVICE TESTING (cannot be answered from docs)

These are the flagship-critical unknowns. Do NOT trust the differentiator
until these are measured on real hardware:

1. [ ] Accuracy of "Help Help" detection in real conditions: quiet room,
       street noise, inside a bag/pocket, muffled, stressed/shouted voice.
2. [ ] Accuracy across Nigerian-accented English and target languages.
3. [ ] False-positive rate (how often it triggers when it shouldn't) —
       critical: a panic app that self-triggers erodes trust fast.
4. [ ] Battery drain over 1h / 4h / 8h of continuous background listening,
       iOS and Android separately.
5. [ ] Locked-screen behavior on a real iPhone (does it keep detecting?).
6. [ ] Background survival: does iOS suspend it? Does it survive a phone
       call and resume? Does Android's foreground service hold?
7. [ ] App Store / Play review reality: will Apple accept an always-on
       mic app? (May require a TestFlight/review probe before betting on L3.)
8. [ ] Privacy/compliance: confirm no audio leaves device (Porcupine =
       on-device, so expected yes), define retention (none), write the
       user-facing disclosure. NDPC implications for mic data.

---

## RECOMMENDED PATH

1. **Pass 1 (now):** Harden the SOS BUTTON error paths (mostly already
   built; verify + fix retry-reacquire-location bug, add repeated-activation
   guard, GPS timeout). Unblocked, high-value, protects the proven core.

2. **Pass 2 prototype:** Integrate Porcupine with fixed "Help Help",
   FOREGROUND first (Level 1). Get end-to-end: phrase -> existing SOS
   activation chain. Prove the wiring works before chasing background.

3. **Device-test Level 2 -> 3:** Add the audio background mode; measure the
   "REQUIRES DEVICE TESTING" list above on real iPhone + Android. Let the
   measurements decide how high up the level ladder OPA can honestly go.

4. **App Store probe for L3:** Before betting the brand on "works in your
   pocket," submit a TestFlight/review build to learn Apple's actual stance.

5. **Pass 3 (custom phrase):** Only after Pass 2 is solid. Start with a
   curated phrase set (easy); evaluate a .ppn-generation pipeline for true
   custom phrases separately.

## HONESTY GUARDRAIL (OPA standard)

Market ONLY the levels that actually work at ship time.
- L1/L2 proven -> "voice-activated emergency protection" is honest.
- "Works even in your pocket / when you can't reach your phone" -> only
  once L3 is proven on BOTH platforms and passes store review.
- Never imply silent/hidden listening (OS shows an indicator; say so).
Same discipline as the banned DUI/impairment claims.

## STRATEGIC NOTE

Because iOS resists background mic and Android does not, OPA's flagship
differentiator may be demonstrably stronger on Android first. Consider an
Android-led voice story while the iOS L3 path (and its App Store risk) is
worked out. This is a positioning decision, not just a technical one.

---

# STRATEGIC CONCLUSIONS (folded in from strategy synthesis)

**Read this first:** everything below is STRATEGY built on the feasibility
findings above. The strategy is sound. The specific performance NUMBERS in it
are ESTIMATES PENDING DEVICE MEASUREMENT — not verified facts. They are marked
[ESTIMATE] wherever they appear. Do not put them in a pitch, deck, or hospital
conversation until a measurement prototype (see below) converts them to
[VERIFIED]. This is the same honesty standard as the banned DUI/impairment
claims: claim only what is proven.

## STATUS OF THE FEATURE — stated honestly

- Feasibility: CONFIRMED. It can be built; Porcupine is the engine; the
  OS constraints are understood.
- Reliability: UNPROVEN. Accuracy, false-positive rate, battery cost,
  locked-screen survival, phone-call recovery, and App Store acceptance
  are NOT yet measured.
- Therefore the correct first build is NOT "the voice feature." It is a
  MEASUREMENT PROTOTYPE whose job is to convert the estimates below into
  verified facts (or expose problems while they are cheap to fix).

## STRATEGIC DIRECTION (endorsed)

1. **Android-led voice.** iOS resists background mic (fragile, App Store
   risk); Android supports sustained background listening via a
   foreground service. Lead the "pocket / hands-free" differentiator on
   Android.

2. **Two-tier product model** (turns the platform constraint into honest tiers):
   - **Standard voice (iOS + Android):** activation while app is open /
     screen locked with an active session (Levels 1-2). Confirmed feasible.
   - **Advanced always-on (Android first):** background listening, phone
     in pocket (Level 3). Feasible on Android; iOS conditional and gated
     on an App Store review probe.

3. **Per-platform honest marketing matrix** (claim only what the platform delivers):
   - iPhone: "Voice activation when the app is open." (do NOT claim pocket
     detection until iOS L3 is proven AND passes review)
   - Android: "Hands-free emergency activation — even in your pocket."
     (only after L3 measured on real devices)
   - Both: on-device, works offline, no audio leaves your phone, visible
     mic indicator when active. Never imply hidden/silent listening.

4. **Privacy framing (compliance-friendly):** on-device keyword spotting,
   no cloud audio, user-initiated, OS mic indicator visible. Define
   retention as none. Confirm NDPC implications for mic data before launch.

## PERFORMANCE TARGETS — ESTIMATES, NOT VERIFIED

These are plausible targets to MEASURE the prototype against — not claims.

- Detection accuracy, clear speech: target ~95%  [ESTIMATE — measure]
- Accuracy in noise / pocket / stressed voice: UNKNOWN  [measure]
- Accuracy, Nigerian-accented English + target languages: UNKNOWN [measure]
- False-positive rate: UNKNOWN — critical for a panic app  [measure]
- Battery drain, continuous background listening: target 3-5%/hr [ESTIMATE — measure iOS + Android separately]
- Detection latency: target < 500ms  [ESTIMATE — measure]
- Locked-screen detection (iOS): UNKNOWN  [measure on real iPhone]
- Background survival + phone-call recovery: UNKNOWN  [measure]
- App Store acceptance of always-on mic: UNKNOWN  [probe via TestFlight/review]

## THE MEASUREMENT PROTOTYPE (correct first build)

Goal: convert the [ESTIMATE] rows above into [VERIFIED] or [FAILED].

Build: Porcupine + fixed phrase "Help Help", wired to the existing SOS
activation chain, INSTRUMENTED to log detections, misses, false positives,
latency, and battery. Foreground first, then add the audio background mode.

Test on REAL hardware (iPhone + Android), in REAL conditions:
- quiet room / busy street / inside a bag / inside a pocket
- normal / muffled / shouted-stressed voice
- multiple accents incl. Nigerian-accented English
- 1h / 4h / 8h battery runs, each platform
- locked screen; during and after an incoming phone call

Only after these are measured does the marketing matrix become HONEST to use.

## APP STORE REVIEW PROBE (explicit gate)

Before betting ANY iOS voice messaging on background listening, submit a
TestFlight/review build to learn Apple's actual stance. A rejection
reshapes the entire iOS voice story, so learn it EARLY and cheaply.

## GO / NO-GO — corrected

- Build a MEASUREMENT PROTOTYPE: GO now (Pass 2, fixed phrase, Android-first).
- Ship voice as a product feature: NOT YET — gated on prototype measurements.
- Publish per-platform marketing claims: NOT YET — gated on [VERIFIED] data
  and (for iOS) the App Store probe.
- Confidence: feasibility HIGH; reliability UNPROVEN. Honest status =
  "prove it on hardware, then claim it."
