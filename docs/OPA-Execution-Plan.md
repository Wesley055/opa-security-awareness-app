# OPA - Execution Plan

**Written 8 August 2026, at commit `92e2398`.**

This supersedes the build order in Ultra 30 §8 and the Command Center scope in
`docs/TODO.md`. Ultra 30 remains authoritative for everything technical; this
document changes *what gets built next and why*.

---

## 0. WHAT CHANGED TODAY

Ultra 30 planned to open the next session on Command Center Phase 1. That is
now **second**, and the reasoning matters more than the reordering.

Market feedback indicated a Command Center sold to **hospitals** would not
sell in Nigeria. Hospitals are not staffed to watch a screen for incoming
alerts — a triage nurse is triaging. **A dashboard nobody watches is worse
than an SMS, because at least an SMS interrupts.**

The customer was narrowed, not the feature set:

| Segment | Command Center fit |
|---|---|
| **Private security companies** | **Primary.** Staffed control rooms, multiple clients, already watching for incidents |
| **Estates / gated communities** | **Primary.** Gatehouse has someone at a desk |
| Universities, corporate SOC | Extensible from the same model |
| Ambulance / response companies | Later, when incidents are escalated to them |
| **Hospitals** | **Destinations, not dashboard users.** Reached by message, not by account |
| Families | Already served by SMS + tracking link |

**Second change:** the consumer app does not wait for any of this. A **closed
beta of 10–20 known users** starts as soon as contact routing is trustworthy,
and Command Center is built in parallel.

**Why that ordering is better commercially**, not just faster: approaching an
estate with *"your residents already use OPA to alert their families — connect
your gatehouse and those same emergencies appear at your security desk"* is a
far easier conversation than selling an empty dashboard with fabricated
incidents.

---

## 1. PRODUCT PRINCIPLE — FROZEN

> **OPA does not monetise by withholding the minimum emergency capability
> needed to keep a person safe. OPA monetises additional protection,
> organisational response, intelligence, accountability and scale.**

Consequences, and they are binding on every pricing conversation:

- The SOS button, location capture, contact alerting and the tracking link are
  **free, forever, and must actually work**. A deliberately weakened free tier
  would make market validation meaningless and is indefensible in a safety
  product.
- What is sold is the **organisational layer**: all protected people belonging
  to a facility, centralised incoming incidents, operator acknowledgement,
  simultaneous incidents, response accountability, history, reports, SafeWalk
  policies, escalation rules, operator roles.
- An individual cannot reproduce that by having a free app that sends an SOS.

---

## 2. THE PLATFORM MODEL

**Protect → Detect → Alert → Acknowledge → Track → Coordinate → Close →
Report → Audit**

| Stage | Owner | State |
|---|---|---|
| **Protect** | SafeWalk | Journey sessions and tracking **BUILT**. Check-ins **NOT BUILT** |
| **Detect** | SOS / Voice / Journey Intelligence | SOS **BUILT**. Voice **NOT BUILT**. Journey Intelligence **NOT BUILT** |
| **Alert** | Incident orchestrator | **BUILT.** SMS live. WhatsApp/Push/Voice are stubs |
| **Acknowledge** | Command Center | **NOT BUILT** |
| **Track** | Journey + tracking link | **BUILT** |
| **Coordinate** | The customer's own radios and procedures | **Deliberately not OPA's** |
| **Close** | User, owner-only | **BUILT 7 August** |
| **Report** | Post-incident report | **NOT BUILT.** Mostly a projection over existing data |
| **Audit** | Timeline hash chain | **BUILT and verified** |

**Three detection channels converge on one incident pipeline** — manual (SOS
button), voice (on-device keyword), behavioural (Journey Intelligence). This
is the strongest architectural idea to come out of today and belongs in the
white paper as *OPA Multi-Modal Emergency Detection*.

**State it precisely.** Only SOS exists. Voice and behavioural detection are
roadmap.

### 2.1 Report vs Audit — keep these separate

- **Audit** = tamper-evident evidence of what OPA **observed**.
- **Report** = human-readable operational account **generated from** that
  evidence.

Operators may add notes. **Operator assertions must never become observed
system facts.** *"Guard Bravo dispatched at 22:17"* is an operator claim; the
chain must not absorb it. Same boundary as ADR-013 §6.2.

### 2.2 SafeWalk check-ins — the split

**SafeWalk schedules. Journey Intelligence interprets.**

    SafeWalk started
      -> 30 min -> "Are you safe?"
           -> YES -> continue
           -> no response -> grace period -> prompt again
                -> still nothing -> JOURNEY INTELLIGENCE
                     -> escalation policy -> contacts and/or incident

**A missed check-in is not an SOS.** People drive, sleep, lose signal, miss
notifications. *OPA must not manufacture emergencies from ordinary
behaviour* — that sentence is the design constraint, not a caveat.

The defensible customer claim is:

> *"During an active lone-worker SafeWalk, OPA requests a safety confirmation
> every 30 minutes. Missed confirmations follow the organisation's configured
> escalation procedure."*

Not *"OPA knows when someone is in danger."*

**Journey Intelligence signal #1 is PROLONGED SILENCE.** Not route deviation —
that needs an expected-route model that does not exist. Silence builds
directly on existing journey infrastructure.

**Dependency nobody has named: check-ins need PUSH, and push is a stub.**
"Are you safe?" has to reach the phone. That puts the push provider on the
SafeWalk critical path, not just the honesty one.

---

## 3. RELEASE PHASES

### Phase A — Closed beta (10–20 known users)

**Purpose:** does the basic emergency loop work for real people?

Measure **completed real safety journeys**, not downloads: activation success,
delivery to the *intended* recipient, tracking-link opens, correct closure,
tracking actually stopping, and *"would you rely on this outside a test?"*

**BLOCKING — must be fixed first:**

1. **Contact routing.** Alerts reach the wrong people. Non-negotiable: a
   safety product that alerts the wrong person invalidates the test itself.
2. **Stub notification providers.** WhatsApp, Push and Voice return
   `success: true` without sending. The database records deliveries that never
   happened, which corrupts the beta's own data.

**DEFERRED for this phase, deliberately:**

- **Password reset.** Participants are known and reachable; recovery is
  manual. **MANDATORY before Phase B.**
- Tracker final-flush 409 (recorded at `674b227`; no data loss).
- Home screen refresh and active-incident state.
- Truncated labels on three screens.

### Phase B — Free public release

Everything from Phase A, plus password reset, a production build, `scheme`
set, store listing, and the data-safety declaration reconciled with NDPC.

**Marketing language for this phase**, and no stronger:

> *"OPA helps you alert the people you trust and share your live location when
> you may be in danger."*

Not *guarantees rescue*. Not *connects you to police*.

### Phase C — Paid institutional

Command Center for private security and estates. Built **in parallel with
Phase A**, sold once real consumer usage exists to demonstrate against.

### Phase D — SafeWalk, Journey Intelligence, Report, Voice

Sequenced after the institutional loop closes with a paying pilot.

---

## 4. DISTRIBUTION — CAN WE USE PLAY FOR THE BETA?

**Yes, and it is probably the better option — but it is not free.** The Play
organization account is complete (ID 5791499687166482521), and **internal
testing supports up to 100 testers with no full store review.**

**What internal testing still requires**, and this is the honest cost:

| Requirement | State |
|---|---|
| App created in Play Console | Not done — one form |
| **Signed AAB from an EAS build** | **Not done.** The app has only ever run in Expo Go |
| `scheme` set in `app.json` | **Not done.** Metro warns on every launch |
| App name, descriptions, icon, screenshots | Not done |
| Privacy policy URL | opasafety.com has one — verify it covers the app |
| **Content rating questionnaire** | Not done |
| **Data safety declaration** | Not done — **must match the NDPC filing** |
| Testers added by email | Trivial |

**The data-safety form is the one with a real dependency.** It asks what data
is collected and shared. It must agree with what was declared to NDPC:
precise location as sensitive, account data as non-sensitive, **no medical
data**. Answering the two inconsistently is the kind of thing that surfaces
badly later.

### Recommendation

**Expo Go for the first days, Play internal testing as soon as the build
exists.**

- Expo Go needs nothing, works today, and everyone is reachable if it breaks.
- Play internal testing gives a **real production build** — which tests things
  Expo Go cannot: the signing path, background behaviour, notification
  permissions, and how the app behaves without a Metro server.

Those differences matter for a safety app. **Do not conclude from an Expo Go
beta that a production build behaves the same.**

---

## 5. SCOPE OF WORK

### 5.1 Immediate — unblocks the beta

**Contact routing.** One query decides the shape:

    isActive FALSE on the primary   -> data/default-value bug. Small.
    isActive TRUE, stale recipients -> the outbox payload is frozen at
                                       incident creation. Design decision.
    Fresh rows, still undelivered   -> delivery-side. Africa's Talking.

Recorded in `docs/TODO.md` with the measured evidence and the query.
**That entry is currently marked DEFERRED and must be corrected.**

**Stub providers.** WhatsApp, Push, Voice → return `success: false` with a
named error, matching the SMS provider. ~1 hour. Last outstanding ADR-015
freeze criterion, and a **prerequisite for trustworthy reporting** later.

**International phone support — BLOCKING for the beta, not after it.**
Registration appears to accept Nigerian numbers only. A diaspora user —
someone in the US paying for a parent's safety in Lagos — cannot register.
Contacts already accept international numbers (`+14694791451` appears in
logs), so the restriction is narrower than it looks.

**Measure the storage format first.** If numbers are stored inconsistently,
fixing validation at the entry point leaves the existing data mixed and
delivery, uniqueness and matching all inherit it. **Check `normalizePhone` in
`sms.provider.ts`**: if it assumes a Nigerian prefix, international *delivery*
is broken too, not just registration.

**Nigeria-first, not Nigeria-only.** E.164 throughout, `+234` as the UI
default rather than the only permitted country code.

### 5.2 Command Center — Phase C

**Frozen scope. The operator loop and nothing else:**

    SOS -> facility security desk receives it -> operator ACKNOWLEDGES
        -> watches live location and timeline
        -> coordinates through their OWN radios and procedures
        -> USER closes with I'm Safe / False Alarm

**Roles, decided:**

- The **user** owns the emergency outcome. Resolve and cancel stay
  **owner-only**.
- The **operator** owns acknowledgement and response coordination.
- OPA owns telemetry, audit, delivery, identity and software.

**Do not give the operator a Resolve button** because they happen to be
sitting at the screen. ADR-013 §6.2.

**Membership and routing — frozen 8 August:**

| Decision | |
|---|---|
| Membership | Resident joins a facility with an estate-issued **invite code** |
| Cardinality | `User.facilityId` is 0 or 1 facility. **Deliberate MVP limit** |
| Incident ownership | **Snapshot** `User.facilityId` → `Incident.facilityId` at creation. Never derive historical access from current membership |
| Routing | Facility security **AND** nominated contacts. Facility does not replace family |
| Authorization | Operators see only incidents whose `Incident.facilityId` matches theirs |
| Revocation | Revoking a code stops new enrolment; existing residents stay |
| Leaving | A separate operation. Affects future incidents, not historical ones |
| Codes | Random, revocable, optionally expiring. **Not** `PINNOCK2026` |

**Future migration, write it down before designing any API:**

    MVP    User.facilityId
    Later  UserFacilityMembership(userId, facilityId, role, status, ...)

Otherwise endpoints will assume one facility is a permanent business rule.

**Operator alerting:** **short polling every 3–5 seconds** for the pilot. Local
visual and audio alarm on a new OPEN incident. Not SSE or WebSocket — polling
is simple, observable, easy to debug, and can be replaced later without
touching the incident model.

**Unattended screen:** a **facility backup alert** to a designated security
phone number by SMS. `Facility.phoneNumber` exists in the schema, but the
orchestrator fans out only to `EmergencyContact` rows belonging to a user — a
facility recipient is a **new recipient type**, small but not free.

That keeps the sales language honest:

> *Command Center open → near-real-time alarm and live incident view.
> Command Center closed → the facility security phone still receives the
> alert. Nominated contacts are alerted independently either way.*

**BUILT ALREADY — do not rebuild:** `UserRole`, `User.facilityId`, `Facility`,
`FacilityStaffGuard` (re-reads from the database rather than trusting the
token), `IncidentAccessGuard`, `GET /facilities/:facilityId/incidents`, and
the public tracking page proving the map patterns.

**NOT BUILT:** the entire operator UI, facility/staff **provisioning**
(onboarding today means hand-editing the database), acknowledgement,
pagination (`facilities.service.ts:8-25` returns everything unbounded),
and **facility routing itself** — `Incident.facilityId` exists and nothing
sets it. That last one is the P0 nobody had listed.

**TENANT ISOLATION IS NOT NEGOTIABLE.** Estate A must never see Estate B's
residents or incidents. The guards exist; provisioning does not. Retrofitting
tenancy after customers hold real incident data is dangerous. **Verify
isolation for every customer onboarded** — log in as A, confirm B is
invisible. It is the easiest check to assume and the worst to get wrong.

### 5.3 Sales language — corrections already needed

Do not say, in any pitch:

- ❌ *"guarantees zero skipped alerts"* — software cannot guarantee a human
  response
- ❌ *"forces guards to acknowledge"* — it records whether they did
- ❌ *"tracks their response time"* — that is an Operations Platform concept
- ❌ *"vitals"* — no medical data exists anywhere
- ❌ *"ETA 7 mins"* — no routing provider is live
- ❌ *"immutable"* — tamper-evident

**The defensible version, and it is stronger in the room:**

> *"OPA gives your security team a live emergency desk. When a resident
> triggers an SOS, your control room receives the incident, can acknowledge
> it, follow the resident's live location, and maintain a timestamped record
> of what happened — while your team continues using its existing radios and
> response procedures."*

Accountability through **the record**, not through claimed metrics. That is
the thing a better-funded competitor cannot copy.

---

## 6. NEXT ACTIONS — IN ORDER

**REORDERED 8 AUGUST.** The original list opened with "run the contact-routing
query". THAT DEFECT DOES NOT EXIST — it was diagnosed twice and both diagnoses
were the environment rather than the code: two accounts confused, then a local
`.env` pointing at the Africa's Talking SANDBOX. Full record at the top of
`docs/TODO.md`.

1. **FIX SMS PROVIDER TRUTHFULNESS.** `sms.provider.ts` returns
   `success: true` whenever `sms.send()` does not THROW, without reading
   `SMSMessageData.Recipients[0].status`. A provider-side rejection is
   recorded as a delivery.

   It **must not convert provider acceptance into SENT** when the recipient
   status is `Failed`.

   **DO NOT FIX THE THREE STUBS IN THE SAME PASS.** They are the same class
   of defect, and combining four providers into one change immediately before
   a beta is unnecessary blast radius. SMS is a MEASURED defect affecting the
   beta's own data; the stubs are provider integrity work with no beta
   consequence. The stubs move to the PARALLEL track below.

   Note the limit: `Sent` means Africa's Talking accepted the message and the
   carrier has not confirmed. That final status arrives through a
   delivery-report callback OPA has no endpoint for. Reading the status at
   send time fixes `Failed`; `Sent` needs callbacks. Decide whether the beta
   needs both.

2. **VERIFY AGAINST PRODUCTION — AND THIS IS FIVE STEPS, NOT ONE.** The fix
   has to reach Azure before it can be verified, or you would be testing the
   old behaviour and concluding the fix failed. That would be the FOURTH
   environment mismatch.

       a. fix locally, all five gates green
       b. commit and push — Actions deploys on push to main
       c. CONFIRM AZURE PICKED IT UP before testing anything
       d. switch app.json to production with the switch script
       e. verify, then SWITCH BACK

   No migration is involved, so the pipeline's missing `prisma migrate
   deploy` does not matter here.

   **Record the environment in the test output before trusting any result** —
   which API, which database, which SMS mode. See the beta rule in
   `docs/TODO.md`.

3. **INTERNATIONAL PHONE SUPPORT.** Ahead of the beta, deliberately: if
   diaspora users are in the cohort, they cannot be blocked at registration by
   the very thing the beta exists to test. Five of the ten recruited
   participants are international — three US, two UK.

   **MEASURE THE STORAGE FORMAT BEFORE WRITING ANY VALIDATION.** This is
   probably not one decorator. It potentially touches registration, login
   identity, contact entry, normalisation on storage, and `normalizePhone` in
   `sms.provider.ts`. If numbers are already stored inconsistently — some
   `+234...`, some `0803...` — then delivery, uniqueness and matching all
   inherit that, and fixing the entry point would leave the data mixed.

   Support **E.164** throughout. Nigeria stays the UI default; `+234` must not
   be the only acceptable country code.

   **Africa's Talking may not deliver to +1 and +44 at all.** An email to
   Pelumi is outstanding. If they do not, a second provider is an
   architecture decision, not a config change.

4. **Real-device acceptance test, run TWICE** — once with a Nigerian number,
   once with an international one:

       register -> add intended contact -> SOS
         -> the INTENDED contact actually receives the alert
         -> open the secure tracking link
         -> observe live movement
         -> I'm Safe
         -> journey stops
         -> link reports the incident closed

5. **Start the closed beta.** 10 people recruited, five of them international.
   Tell them plainly it is a beta, that it supplements rather than replaces
   calling for help, and give them a direct line.

### In parallel — not on the critical path to the beta

6. **Replace the three stub providers.** WhatsApp, Push and Voice. Same class
   as item 1 and deliberately SEPARATED from it: one change per provider
   family keeps the pre-beta diff small. About an hour.

7. **Google Play internal testing** (§4). Expo Go first if it gets testers
   moving sooner; move them onto a real build once it is validated.

8. **Command Center.** Facility provisioning and routing first — they are
   backend, and the UI has nothing to show without them.

9. **ASK PELUMI why one Nigerian number succeeds and another fails.** From
   the 6 August production traffic, so it is real and predates the sandbox
   confusion. DND is the likely cause. Same thread as the international
   question already sent.

**Not now:** SafeWalk check-ins, Journey Intelligence, Picovoice, post-incident
reporting, dispatch, hospital dashboard.

**Picovoice specifically: do not buy the $500 trial** until integration is
about to start. A trial clock that expires unused is money gone, and nothing
in the beta or Command Center loop needs it.

---

## 7. OPEN QUESTIONS

| Question | Why it matters |
|---|---|
| Does the report's response-time metric belong in Incident Core or Operations? | A security firm buying OPA partly to measure its own guards tests the ADR-013 boundary from a new direction |
| Does `Facility.isVerified` gate anything? | It exists and nothing sets it. Vestigial, or a decision nobody has made |
| Does resolving notify the contacts? | Today it does not. They keep a link that now reports closed, but nothing is pushed. Half of *"signal that you're safe"* |
| How does a user reach an active incident after closing the app? | The close buttons exist only on the SOS screen |

---

*Written after a strategy session on 8 August 2026, following eleven commits
that closed the incident lifecycle. Every capability claim in this document is
labelled BUILT or NOT BUILT against measured code. Re-verify §2 before any
customer conversation — the fastest-moving part of this document is the list
of what does not exist yet.*
