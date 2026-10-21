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

## Proposed resilience package (owner plan, 21 Oct): design before building

1. **Offline SOS queue** (B1, B2, B5): every SOS is saved on the phone with the true press time and location, then sent automatically when any connection returns. One emergency ID across every channel.
2. **SMS fallback** (B3): when there is no data but there is signal, OPA opens a pre-written SOS text with the location. Play does not allow apps to send SMS silently, so it takes one tap. Option: an inbound OPA number on Africa's Talking, so the text creates the incident on the server.
3. **USSD SOS:** dial `*code#` from any phone, including feature phones, to raise an SOS for a registered number. This needs a USSD service code from Africa's Talking (a shared code is quick; a dedicated code takes weeks), plus pricing.
4. **Network failover:** retry across Wi-Fi, mobile data, SMS and USSD, with honest status shown to the user.
5. **Operator without a computer:** the on-duty operator receives each incident by SMS and replies with short codes (for example `ACK 4821`, `DISP 4821`) to acknowledge and dispatch. This needs two-way SMS (an inbound number or short code). Later, a mobile Command Center.
