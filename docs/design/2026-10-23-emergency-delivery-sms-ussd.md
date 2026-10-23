# Emergency delivery: offline SOS, network failover, SMS fallback and USSD (23 Oct 2026)

**Status: design for founder approval. No code, migration, deployment or production setting until it is approved.**

Owner direction (23 Oct): build SMS offline fallback, network failover and USSD. USSD SOS has **no PIN**. Location matters most, and USSD with Hausa is a major opportunity in the northern market. Codex review (23 Oct): no PIN agreed, but a registered phone number is **not** strong proof of identity, so channel verification must be explicit. All three channels share **one reconciliation and duplicate-prevention design**.

It closes register findings **B1** (on-screen SOS has no offline queue), **B5** (no shared ID across channels) and **B6** (no press time), and supports **B1b** (lock-screen SOS offline).

---

## 1. Principles

1. **The press is the emergency.** The phone creates the emergency record the moment it is pressed, before any network is involved, and never forgets it until the server confirms.
2. **One emergency, many routes.** App internet, SMS and USSD are routes for the *same* activation. The server merges them, and one person in danger is one incident.
3. **Send first, ask after.** On SMS and USSD, the incident is created with the first message. Every later question (where, can we call) only adds to it, so a dropped session never loses the SOS.
4. **Never overstate.** Every alert shows how it arrived, how sure OPA is that it came from that person, and where its location came from and how old it is.
5. **No unknown sender creates an incident.** SMS or USSD from a number not registered to an active OPA user is logged (rate-limited, number hashed) and answered neutrally, never turned into an alert.
6. **Existing rules stay:** one OPEN incident per user (later activations are retriggers); ending an emergency needs the owner's unlock; a missed SafeWalk never auto-creates an SOS; personal SafeWalk stays private; the phone-number ownership check is never bypassed.

## 2. Shared core: the emergency delivery coordinator

### On the phone

- At the press, the app creates an **activation record** in the local database (expo-sqlite):
  - `activationId` (random UUID);
  - `pressedAt` (phone time and monotonic offset);
  - trigger and mode (standard or silent);
  - best location fix at the press (latitude, longitude, accuracy, fix time);
  - delivery state.
- **States:** `PENDING_ON_PHONE` → `ACKNOWLEDGED` (server confirmed by internet or SMS reply) → `RECONCILED` (every route accounted for). `DELIVERY_UNCERTAIN` is shown if nothing confirmed it within the timeout (section 3).
- The record survives the app being closed, the phone restarting and network loss. It is retried until acknowledged.
- The Android lock-screen native queue (already up to 8 triggers, retried until acknowledged) feeds the same coordinator, carrying its own trigger ID.
- **The person sees the truth:** "Sending…", "Alert received by OPA at 14:02", "No internet. Send by SMS", or "We couldn't confirm your alert. If you can, call…".

### On the server

- `/incident-orchestrator/activate` accepts two new **optional** fields: `activationId` and `pressedAt`. Old app versions keep working unchanged.
- A new table **`EmergencyActivation`** holds:
  - `activationId` (unique), user, `incidentId`;
  - `pressedAt` and `receivedAt`;
  - `firstChannel` and the list of channels seen;
  - verification level.
- **Idempotent:** the same `activationId` again, by any route, returns the same result. Nothing is duplicated, and contacts are not notified twice.
- **Reconciled:** a later arrival on another route is recorded on the incident timeline ("also received by SMS, 14:03").
- **Press time:**
  - the incident keeps `pressedAt` (when it happened) as well as `receivedAt` (when OPA learned of it);
  - limits: no more than 2 minutes in the future and no more than 24 hours in the past, otherwise the receive time is used and the reason recorded;
  - a late delivery is shown as late.
- An activation with no `activationId` (old apps, USSD) behaves exactly as today.

### Verification level (shown to operators)

| Level | Meaning |
|---|---|
| `APP_SIGNED_IN` | Arrived through the signed-in app (today's level) |
| `SMS_SIGNED` | SMS from the registered number **and** a valid code from that phone's OPA key |
| `SMS_NUMBER_ONLY` | SMS from the registered number without a valid code (for example typed by hand) |
| `USSD_NUMBER` | USSD from the number reported by the mobile network, matching a registered user |

The Command Center treats all of these as real emergencies. The level only tells the duty officer how much to verify, for example by calling back if the person allowed it.

## 3. Network failover (phone)

1. **Internet first.** Send at once, with an 8-second timeout. Retry after 2, 5 and 10 seconds, and again whenever the phone's connection changes.
2. **Offer SMS early.** If the phone reports no connection, or nothing has been acknowledged after **15 seconds**, show **Send by SMS** (section 4). Internet retries carry on in the background.
3. **Keep trying.** Internet retries continue until the server acknowledges, even if the SMS was sent (the internet delivery adds the full location trail).
4. **Location keeps buffering** during the active alert (existing SQLite queue), and is replayed with its original times when the connection returns.
5. **Uncertain delivery.** After 2 minutes with no acknowledgement by any route, show `DELIVERY_UNCERTAIN` with clear next steps.

Server-side failover (a second SMS provider for contact notifications, a second hosting region) is noted for later and is not part of this release.

## 4. SMS fallback

### Africa's Talking setup (owner)

- A **two-way shared short code with a keyword** (for example "OPA") on the live account (not the sandbox).
- An incoming-message callback URL, which Claude will supply once built.
- Ask Africa's Talking for its callback source IP addresses and whether it signs callbacks.
- **Indicative pricing** from its site: about NGN 10,000 a month plus VAT, NGN 6 per message received and NGN 5.40 per message sent. Owner to confirm the current rate card.

### The message

The message is one SMS that fits 160 characters and is readable only by OPA:

```
OPA S1 <id> <lat>,<lng> <acc> <pressedAt> <mode> <code>
```

- `id` is a short form of the activation ID, the same one the internet route uses.
- `code` is a short signature: an HMAC over the other fields, using a **per-device key**.
  - The key is issued to the phone after sign-in and kept in the phone's secure storage.
  - The server re-derives it from a server secret and the key ID, so no device key is stored on the server.
  - The key is revoked on sign-out-everywhere or a password change.
- GPS works without internet, so an offline smartphone sends its **exact position**.

### On the phone

- The app opens the phone's own SMS composer with the message already filled in, using `expo-sms` on Android and iPhone. The person taps **Send**.
- **Fully automatic background sending is not promised.** Google Play restricts the SMS-sending permission to default SMS apps and a short list of exceptions, and iPhone always requires the tap. Automatic sending would need a separate policy review.
- **Lock screen (Android):** an offline lock-screen trigger shows a notification with **Send by SMS**. Opening the composer may need an unlock. This is to be confirmed on a device during E2E.

### On the server (new public endpoint, no JWT)

1. Accept only from Africa's Talking source addresses, on a secret callback path, within a size limit. Each provider message ID is processed once.
2. Normalise the sender's number. **Unknown number → nothing is created.** It is logged as a hash, rate-limited, and gets no reply, or a neutral one, to be decided.
3. Known number:
   - parse the message and check the code → `SMS_SIGNED`;
   - code missing or invalid but the number matches → `SMS_NUMBER_ONLY`;
   - an activation ID already seen → reconcile only, and never notify contacts twice;
   - an old `pressedAt` (over 24 hours) → refused as a replay.
4. Create or retrigger the incident through the **same orchestrator** as the app, so contacts, the facility, the timeline and audit all behave the same.
5. **Reply SMS:** *"OPA: alert received 14:02. Help is being notified."* The phone shows the alert as acknowledged even with no internet (costs about NGN 5.40; recommended).

## 5. USSD

### Africa's Talking setup (owner)

- A **shared USSD code** on the live account.
  - **Documents:** certificate of incorporation, a request letter and a valid photo ID of the signatory, sent to info@africastalking.com.
  - **Timing:** about one working day.
  - **Indicative cost:** free setup, about NGN 53,750 a month plus VAT. Owner to confirm.
- A **dedicated code** (NCC process, per-network connection fees, minimum sessions) only after the pilot proves demand.
- The callback URL comes from Claude once built. Ask for the source IP addresses, and whether **network location** (cell tower) is available, at what accuracy, cost and consent terms. Nothing in this design depends on it.

### Identity

- The caller's number is the one the **mobile network** reports to Africa's Talking, so it can't be typed in by the caller. A SIM can still be stolen, borrowed or swapped, so the level is `USSD_NUMBER` (section 2), not proof of identity.
- **No PIN** (owner decision).
- Protections:
  - a confirmation step;
  - one OPEN incident per user (later sessions are retriggers);
  - a per-number limit (for example 3 USSD SOS sessions an hour beyond the open incident);
  - suspicious-pattern flags for the duty officer, such as many sessions or many quick cancels;
  - a full timeline of each session.

### Menu (English shown; Hausa first in the north; text reviewed by a native speaker before launch)

```
OPA
1 Send SOS
2 Language

> 1
Send SOS now?
1 Yes, send
2 Cancel

> 1        <- incident is created here
SOS sent. Where are you?
1 Home
2 Work
3 Farm            <- the person's saved places, up to 4
4 Somewhere else
0 Skip

> 4
Type a landmark, e.g. near Kofar Mata mosque (0 to skip)

> (text)
Can security call you?
1 Yes
2 No, I can't talk

> 2
Help is being alerted. Stay safe.   <- END
```

- **Ending an emergency is not offered on USSD.** It still needs the owner's unlock in the app, or an operator closing it under the existing rules.
- A number not registered with OPA gets *"This number is not registered with OPA. Ask your estate or community administrator to register you."* No incident is created.
- **Sessions time out** after roughly 2–3 minutes, depending on the network. Because the incident already exists after "Yes, send", a timeout only loses the extra answers.

### Location for USSD alerts (best first)

1. **Saved place:** label, description and an optional map pin, set in the app or by the facility admin.
2. **The last app position,** if the person also uses the app, shown with its age.
3. **A typed landmark,** up to 80 characters, marked "not verified".
4. **Network location:** only if Africa's Talking or the networks can provide it under agreement and consent. Not in this release.

**Feature-phone people:** today residents enrol through the app. USSD-only people need the **facility admin to register them** (name, phone, language, saved places), with a **confirmation code sent by SMS** and entered through USSD to prove they own the number. This keeps the ownership rule.

## 6. Command Center changes

- **Channel badge** on every alert: App · SMS · USSD, plus the verification level.
- **Location line** with its source and age: "Exact GPS (via SMS), 14:02", "Saved place: Home", "Last app position, 25 min old", or "Typed landmark, not verified: near Kofar Mata mosque".
- A prominent **"Can't talk: do not call"** flag when the person chose it. The duty officer sends an SMS instead.
- On the timeline: pressed at, received at, each route that delivered it, and any late location replay.

## 7. Data changes (release 48, additive only)

| Change | Purpose |
|---|---|
| `EmergencyActivation` table | One record per press, reconciling every route |
| `Incident.pressedAt` and `Incident.channel` (APP, SMS, USSD), verification level | Shown to operators, used in reports and Insight |
| `DeviceSmsKey` (key ID, device, created, revoked) | The SMS signature key reference; no secret stored |
| `SavedPlace` (user, label, description, optional pin, order) | USSD location menu, also used by the app |
| `User.preferredLanguage` (en, ha, pcm, yo, ig) | USSD and SMS language |
| `InboundMessage` (provider message ID unique, number hash, outcome, times) | SMS idempotency and audit; kept 90 days unless linked to an incident |
| `UssdSession` (session ID unique, number hash, steps, outcome) | USSD idempotency, rate limits and audit; same retention |

Phone numbers in the logs are stored as `PII_LOOKUP_KEY` hashes. The incident keeps its link to the registered user as today.

## 8. Switches and release

- New switches, **off by default**: `SMS_FALLBACK_ENABLED` and `USSD_ENABLED`. Production is switched on only after physical E2E passes.
- **API release 48:** migration plus endpoints, using the existing supervised release process with zero downtime. Old apps keep working.
- **App:** Android version 25 and iPhone build 11+, carrying the coordinator, the offline queue, the SMS composer, saved places and language.
- **Facility Admin:** register a feature-phone resident, and manage saved places.

## 9. Tests

**Automated:**
- SMS message parsing and signature;
- replay and duplicate handling;
- an unknown number creates nothing;
- every USSD menu step, and a timeout after "send";
- rate limits;
- reconciliation when the internet copy arrives after the SMS copy, and the reverse;
- press-time limits.

**Sandbox:** the Africa's Talking simulator for SMS and USSD before any spend.

**Physical E2E:**
1. Airplane mode, on-screen SOS → queued → SMS composer → SMS sent → incident in the Command Center with exact GPS → reply SMS received → internet back → a single incident with the full location trail.
2. Lock-screen SOS offline (B1b).
3. SMS from an unregistered phone → nothing created.
4. The same SMS sent twice → one incident.
5. USSD on a feature phone on MTN, Airtel, Glo and 9mobile → incident created at "Yes, send".
6. Dropping the USSD session right after "Yes, send" → incident still exists.
7. Saved place, landmark and "can't talk" shown correctly to the duty officer.
8. Hausa menu read and approved by a native speaker.
9. Old app version → still works.

## 10. Decisions for the founder

1. **Approve this design.**
2. **Launch languages:** English and Hausa first. Pidgin, Yoruba and Igbo next. A native speaker must review the text.
3. **USSD confirmation step** ("1 Yes, send"). Recommended: yes, to prevent pocket-dials.
4. **Reply SMS** confirming receipt (about NGN 5.40 each). Recommended: yes.
5. **Feature-phone registration** by the facility admin, with an SMS code confirmed over USSD. Recommended: yes.
6. **Reply to unknown numbers:** a neutral reply or none. Recommended: none for SMS (it costs money and confirms the number works), the registration message for USSD.
