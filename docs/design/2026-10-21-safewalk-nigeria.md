# SafeWalk, Nigeria-first: specification (21 Oct 2026)

Owner direction: build SafeWalk properly once, with Google Maps, then move on. Draft for owner approval. **No code changes until it is approved.**

## A. Verified findings (Android, build 24, 21 Oct 06:52)

Checked on the device against the code review. "Verified" = confirmed on the phone.

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Destination needs latitude and longitude typed in | **FAIL** (verified) | Screen fields: label, latitude, longitude |
| 2 | Arrival time | **PASS** (verified, corrects the code review) | "Minutes until expected arrival" field (30); a duration, not a date |
| 3 | Starting point taken from GPS, not shown to the user | NEEDS IMPROVEMENT (code review) | No start point on screen |
| 4 | Guardians are OPA users paired with a 64-character code | **FAIL** (verified) | "Selected guardian codes, separated by commas" plus "Generate my pairing code" |
| 5 | Emergency contacts not used for SafeWalk | FAIL (code review) | Not offered on screen |
| 6 | SafeWalk notices sent by email only | FAIL (code review) | Notification worker uses the email provider only |
| 7 | Facility operators cannot see normal journeys | **PASS, by design** (verified) | Screen: "Facility operators cannot monitor normal journeys" |
| 8 | Arrival needs a manual action | NEEDS IMPROVEMENT (code review) | |
| 9 | Missed arrival kept separate from SOS (check at +5 min, guardians at +8 min) | PASS (code review) | `safewalk-policy.ts` |
| 10 | SafeWalk switched off in production | BLOCKER (verified) | Start returns 503 (`SAFEWALK_ESCALATION_ENABLED` unset) |
| 11 | **Raw technical error shown to the user** | **FAIL** (verified, new) | "Request failed with status code 503" in orange |
| 12 | **Bottom of the screen sits behind Android's navigation bar** | **FAIL** (verified, new) | "Refresh status" partly hidden; the screen does not use the safe-area layout |
| 13 | **Long privacy paragraph in the middle of the form** | NEEDS IMPROVEMENT (verified, new) | Five-line technical text between the fields and the Start button |

## B. Design (with the owner's corrections, 21 Oct)

**Destination: Google Maps.**
- Search through Google Places, using landmarks, bus stops, markets, businesses and streets (for example "Berger Bus Stop, Lagos" or "Shoprite, Lekki"). OPA resolves and stores the coordinates; the user only sees the place name.
- Search goes through the OPA server, so the key stays restricted, results can be cached and cost is limited.
- Fallback 1: drop a pin on the map.
- Fallback 2: a free-text description, kept as a description only. It is never treated as a verified location.

**Starting point.** GPS is shown as a readable place. If accuracy is poor, the user is told and asked to confirm. An approximate location is never shown as a verified one.

**Duration.** Large buttons: 15 min · 30 min · 1 hour · 2 hours. The current minutes field stays as "Other".

**Who is alerted.**
- The user ticks people from their **emergency contacts**, who are alerted by **SMS** (Africa's Talking) with email as backup. The contact does not need the app.
- Each contact must have consented to SafeWalk alerts, and their notification preference is stored.
- Delivery is verified and recorded in the delivery ledger.
- Existing OPA guardians remain an option, using a short pairing code instead of the 64-character one.

**Arrival.**
- Being near the destination (geofence, with GPS-accuracy checks) **asks the user to confirm arrival**. It never marks them safe on its own.
- The lock-screen notification has **I'm safe** and **SOS** actions. This must be tested on real Android **and** iOS devices, because their notification actions differ.

**Moving and driving.**
- The setup screen says "Set up before you move. Don't use while driving."
- Driving-speed detection may **delay distracting prompts briefly**, but it can **never postpone an escalation** beyond the policy deadlines.

**Escalation policy (unchanged baseline).**
- Expected arrival (T): **T+5 min** safety check to the user; **T+8 min** no response, so the chosen contacts or guardians are notified.
- This stays a non-emergency alert and **never creates an SOS automatically**.
- Any other policy needs separate approval and testing.

**Privacy and the Command Center.**
- A personal SafeWalk stays private. Facility operators see nothing of a normal journey, as today.
- Institutional visibility only applies when the user explicitly authorises monitoring for that journey, or when a defined emergency escalation (an SOS during the walk) allows access.
- Showing overdue walks to estate security therefore needs the user's per-journey consent. It is not on by default.

**Phone snatched or switched off.** A missed check-in triggers the escalation as above, with the last known location sent only to the people the user chose.

**Screen quality.**
- Plain Nigerian English and large buttons.
- Errors written for people, for example "SafeWalk isn't available yet. Your journey was not started."
- Safe-area layout, so nothing sits behind the navigation bar.
- The privacy explanation moves behind a short "How SafeWalk protects your privacy" link.

**Weak internet.** The journey is preserved and location updates are queued where the phone supports it, as the SOS buffering already does.

## C. Release

1. **Server:** Places search proxy, contact-based alert recipients with consent, SMS for SafeWalk notices, short guardian code, and the optional destination description. This needs a database change.
2. **App:** version 25, with the new setup screen, map, lock-screen actions and arrival prompt. Built with EAS and sent for Play review.
3. **Switch-on:** `SAFEWALK_ESCALATION_ENABLED=true` in the same supervised release.
4. **Physical E2E on Android and iOS:** search, pin, start, location updates, arrival prompt, missed arrival at T+5 and T+8, SMS to a contact, SOS during a walk, phone off, weak signal.
