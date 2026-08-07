# OPA - Working To-Do List

**Last updated:** this session. Read this before assuming anything is
done - verify against real files/tests, same as everything else in
this project. **See docs/SPRINT_ROADMAP.md for the authoritative
sprint-by-sprint status - this file is for granular, individual items.**

## Immediate - defects found on-device 6 August 2026

Found while testing the production SMS path end to end. Recorded with their
MEASURED evidence and, where the cause is not certain, with the test that
would settle it. Do not fix from the symptom alone.

- [ ] **ALERTS GO TO THE WRONG EMERGENCY CONTACTS. Most serious item here.**
      Measured: `+2349066538149` (Blessing Love, NOT primary) received every
      alert. `+2347037119196` (Osa Osahun, PRIMARY) received none, including
      after being set primary. A third number, `+14694791451`, appeared in
      dispatch logs and is NOT in the contact list at all.
      **A user can update their emergency contacts and alerts still go to the
      wrong people, silently, while the app displays the correct list.**

      TWO CANDIDATE MECHANISMS. They need different fixes, so measure before
      choosing:

      1. **`isActive` filtering.** `incident-orchestrator.service.ts:104-106`
         does `contacts.filter((contact) => contact.isActive)` before building
         any notification row. A contact whose `isActive` is false - or was
         never set true on create - is excluded silently while still showing
         in the app.
      2. **A frozen outbox payload on a reused incident.** Dispatch Phase 2c-1
         stores a durable JSON payload at INCIDENT-CREATION time. During
         testing the app repeatedly reported "existing emergency alert remains
         active" and REUSED the session. A payload written when the original
         incident was created would replay its original recipients forever.

      **THE TEST THAT DISTINGUISHES THEM:** query `isActive` on Osa Osahun's
      row. If false, mechanism 1 is the whole story and mechanism 2 is a red
      herring. If true, the reuse path is the cause and the fix is a design
      decision, not a bug fix - see ADR-014 section 11 and Ultra 28 section 3.5.

      NOTE what is NOT wrong: `incident-orchestrator.service.ts:103` calls
      `emergencyContactsService.listForUser(userId)` and reads contacts FRESH
      from the database at incident creation. `listForUser` returns ALL
      contacts ordered `isPrimary: 'desc'`, not just the primary. The
      orchestrator then builds one SMS, one WhatsApp and one email row per
      contact. The fan-out is correct.

- [ ] **No password reset exists.** The sign-in screen offers Email, Password,
      Sign In and "Create one" - there is no "Forgot password?" path anywhere.
      Any user who forgets their password is locked out permanently. Blocks
      any real pilot.

- [ ] **Labels are TRUNCATED on the Emergency Contacts screen - one layout
      bug, not three typos.** "Bac" (Back), "Remov" (Remove), "Set" (probably
      "Set primary"). Three clipped labels on the same view means containers
      too narrow or a line clamp without ellipsis, not three spelling
      mistakes. Fix the layout; the strings are probably already correct.

- [ ] **FEATURE GAP, not a defect: the user cannot choose WHICH contacts are
      alerted.** The orchestrator already fans out to every active contact, so
      the capability exists at the API. What is missing is a selection surface
      in the app - a user should be able to pick more than one recipient
      deliberately rather than have it implied by `isActive`.
      **Design this alongside the `isActive` question above** - they are the
      same field seen from two ends.

- [ ] **Website needs a visual and content pass.** Also carries the three
      unverified claims recorded in Ultra 28 section 9:
      "SMS live" - NOW TRUE as of 6 August, delivery confirmed to a handset.
      "Push live" - FALSE. push.provider.ts is a stub that logs to console and
      returns success without sending.
      "hash-chained incident timeline", "tamper-evident by design" - UNVERIFIED.
      SPRINT_ROADMAP.md:247-251 says the IncidentTimelineEvent chain does not
      exist. Measure before editing either the site or that claim.
      "Encrypted evidence, hash-verified" - hashing is not encryption, and the
      encryption decision is still open.

## An incident opens and NEVER closes - found 6 August 2026

Found while diagnosing why the SOS screen still read "your existing emergency
alert remains active" hours after the emergency. It was not the dedupe window.
The incident genuinely was still open, because nothing in the system can close
one.

- [ ] **NOTHING WRITES ANY TERMINAL INCIDENT STATUS.** `IncidentStatus` has
      four values - OPEN, ACKNOWLEDGED, RESOLVED, CANCELLED. Measured across
      apps/api/src: `incident-orchestrator.service.ts:196` sets
      `IncidentStatus.OPEN` at creation, and **every other reference in the
      tree READS status. There is no endpoint, service method or transition
      that writes ACKNOWLEDGED, RESOLVED or CANCELLED.**

      **A user cannot signal that they are safe.** In a safety product that is
      arguably the second most important action after raising the alert.

      CONSEQUENCES, all of them live today:
      - The app shows "emergency activated" indefinitely. Observed for hours.
      - Tracking links stay live until their absolute lifetime expires rather
        than closing when the emergency ends.
      - **A Command Center incident list would fill with permanently open
        incidents** and an operator would have no way to tell a live emergency
        from one that ended last week.
      - Any pilot would accumulate open incidents from the first day.

      **THE READ SIDE IS ALREADY BUILT BUT IS UNREACHABLE FROM THE CURRENT
      APPLICATION LIFECYCLE.**
      `public-tracking.service.ts:114-124` handles a closed incident, and its
      comment reasons carefully that closed is checked BEFORE expiry because
      "someone opening an old link benefits far more from learning the
      emergency ended than from being told the link expired".
      `public-incident-snapshot.dto.ts:76-77` insists EXPIRED and
      INCIDENT_CLOSED must never be collapsed. `incident-access-token
      .service.ts:191` refuses to extend a token for a non-OPEN incident.
      **None of that closed-incident behavior is reachable through the current
      production write path.** The consumers exist and are tested; what is
      missing is the writer.

      NOTE: `cancellationReceived` in the detection path is a TRIGGER-TIME
      signal - "this activation was cancelled" - not a way to close an
      incident afterwards. Do not mistake one for the other.

- [ ] **DESIGN QUESTION, decide before building: who may close an incident,
      and what does each status mean?** This is ADR-shaped, not a bug fix.
      - RESOLVED vs CANCELLED - is CANCELLED "this was a false alarm" and
        RESOLVED "the emergency is over"? They will be read differently by an
        insurer.
      - Can the USER close their own incident? Almost certainly yes, and it is
        the most important case.
      - Can an OPERATOR close one? **Careful: ADR-013 and its section 6
        amendment permit ACKNOWLEDGED as an observed fact, but an operator
        RESOLVING an incident on the subject's behalf is a claim about the
        world made by a party with an interest in it.** That is exactly the
        seam the amendment identifies.
      - Should an incident auto-close after some period? A journey session has
        `TIMED_OUT`; an incident has no equivalent.
      - Does closing an incident revoke its tracking tokens, or let them expire
        naturally? `incident-access-token.service.ts` already revokes on some
        paths - check before deciding.

- [ ] **ACKNOWLEDGED is already an enum value waiting for the Command Center.**
      When acknowledgement is built, it writes this status. Build it as an
      observed fact per ADR-013 section 6.2 - that an acknowledgement occurred,
      by whom, when - not as a workflow state machine.

## Command Center - MEASURED SCOPE, 6 August 2026

Measured against real files, not estimated from the roadmap. Two documents say
the Command Center "extends Sprint 10A" and both are wrong about what that
means in practice.

### What already exists - do not rebuild it

- **Auth, roles and tenant scoping are BUILT.** `UserRole` enum, `User.role`
  carried in the JWT, `User.facilityId` with a `FacilityStaff` relation and an
  index, `Facility` model, `Incident.facilityId` indexed with status.
- **`FacilityStaffGuard` is BUILT** and re-reads role and facilityId from the
  database rather than trusting the token - so a user promoted after their
  token was issued is handled correctly.
- **`IncidentAccessGuard` is BUILT** - per-incident authorisation for the
  incident owner, facility staff assigned to that facility, or ADMIN.
- **`GET /facilities/:facilityId/incidents` is BUILT** and already scoped.
- **The public tokenized tracking page is BUILT** -
  `apps/website/src/app/i/[token]/live-tracking.tsx`, ~12KB, proving the map
  and live-position patterns work against the API.

### What does NOT exist

- [ ] **THERE IS NO OPERATOR UI AT ALL.** `apps/website` is marketing pages -
      about, careers, contact, hospitals, privacy, terms, home - plus the one
      public tracking page above. No login, no incident list, no dashboard.
      **SPRINT_ROADMAP.md:141 says Sprint 10A is "SUBSTANTIALLY BUILT". That
      is true of the API and the public tracking page. It is NOT an operator
      portal, and COMMERCIAL_ROADMAP.md's "Command Center IS the institutional
      version of Sprint 10A" implies a front end that has never existed.**
      The Command Center front end is FROM ZERO.

- [ ] **Facility and staff PROVISIONING does not exist.** The schema supports
      it; nothing writes it. There is no endpoint to create a facility, assign
      a user to one, or promote a user to HOSPITAL_STAFF. Every hit for those
      fields is a GUARD READING them. **Onboarding a hospital today means
      hand-editing the production database**, which is the first thing that
      would be needed the moment a customer says yes.
      DECIDE: an admin API, or a seeded script for the first pilot.

- [ ] **ACKNOWLEDGEMENT does not exist.** No endpoint, no status, no field.
      Every match for "acknowledg" in the API is either boot-flag prose or a
      DTO comment noting that responder acknowledgement is OMITTED.
      **It is in the Command Center MVP scope and ADR-013 permits it** -
      "acknowledgement display" is explicitly in scope for a viewer.
      **BUILD IT AS AN OBSERVED FACT, NOT A WORKFLOW.** ADR-013 section 5:
      audit events record that an acknowledgement occurred, by whom, when -
      they do not model a workflow. Section 6.2 now states the rule in full.
      A status field with transitions would cross the boundary.

- [ ] **The incident list endpoint OVER-FETCHES and has no pagination.**
      `facilities.service.ts:8-25` returns every incident for a facility with
      the full user, ALL notifications, ALL evidence and ALL timeline events,
      unbounded. Fine for a demo with five incidents; unusable at a hundred.
      Needs pagination and a lighter list projection, with detail fetched
      separately.

### The estimate, and what it does and does not cover

**TEN TO FOURTEEN DAYS for Phase 1**, focused work: the front end from zero
plus the three backend pieces above. The uncertainty sits in the UI, because
nothing comparable exists in the repo to pace against - `live-tracking.tsx` is
the only functional screen and it is a single public page.

**PHASE 1 IS:** org login, live incident list, incident map, incident detail,
evidence viewer, timeline, acknowledgement, search and filter, basic
reporting, organisation management.

**PHASE 1 IS NOT:** assignment, escalation, responder status, shift
management, SLA timers, dispatch. Those are the OPERATIONS PLATFORM, which
ADR-013 section 6 makes possible as a SEPARATE, INDEPENDENTLY DEPLOYABLE
product. **IT IS NOT INCLUDED IN THE TEN-TO-FOURTEEN DAY FIGURE** and is a
comparable body of work again - workflow state, transition rules, concurrency
between operators, its own audit stream and its own UI.

**Do not let a single number cover both.** The whole point of ADR-013 section
6 is that they are separable; an estimate that merges them would undo that
before any code is written.

### Before starting

- [ ] Decide provisioning: admin API or seeded script for the first pilot.
- [ ] Write the acknowledgement design note. Small, but it is the seam ADR-013
      section 6.2 identifies as most likely to be violated, and getting it
      wrong turns a viewer into a console by accident.

## Immediate - unblocks remaining verification

- [ ] Verify Push and Email notification delivery individually - both
      fired in parallel with the SMS confirmed working live, but
      neither was individually confirmed received.
- [ ] Test the SOS screen's Cancel path - never tested yet, only the
      full-countdown-to-activation path has been verified live.
- [ ] Test SOS error-handling paths - denied location permission,
      network failure during activation, repeated activations.
- [ ] Double-check a real RESEND_API_KEY is actually set in .env -
      never explicitly confirmed the way Azure and Africa's Talking
      credentials were tonight.

## Confirmed real this session

- [x] Real, live, end-to-end SMS delivery via Africa's Talking Sandbox
      - a genuine SOS activation produced a real message that arrived
      on a real phone with correct content and a working location link.
- [x] Parallel-notifications orchestrator refactor (SMS + WhatsApp +
      Email sent concurrently) - proven real by a live test.
- [x] Mobile SOS activation screen (Sprint 9 Pass 1) - built and run
      live successfully: real countdown, real GPS, real API call, real
      incident created, real notification triggered.
- [x] sms.provider.ts restored from a silently-reverted fake stub to
      the real Africa's Talking integration; africastalking npm
      package installed.
- [x] Fake GeocodingProvider location text removed from real
      SMS/email messages - replaced with a real Google Maps link built
      from actual GPS coordinates.
- [x] Legal entity name corrected sitewide: "OPA Technology Limited"
      (wrong) -> "OPA Technologies Limited" (CAC-approved, correct) -
      fixed in Contact, Terms, and Privacy pages.
- [x] Azure Storage key rotated (routine hygiene, pasted in chat
      multiple times across sessions).
- [x] opasafety.com email DNS fixed - was showing "Incomplete setup"
      in Microsoft 365, traced to missing DNS records at Cloudflare,
      resolved via Microsoft's automated Cloudflare integration.
- [x] Real Africa's Talking Sandbox credentials obtained and verified
      working.

## Real, known gaps - not urgent, not forgotten

### --- HIGH-VALUE, GROUNDWORK ALREADY EXISTS (28 July 2026) ---
## Ordered by impact per hour. The first three are nearly free because
## the data or the enum already exists and is simply unused.

  [ ] 1. CONTACT ACKNOWLEDGEMENT - the biggest gap in the product.
      NotificationStatus.ACKNOWLEDGED exists in the schema and NOTHING
      SETS IT. A person in danger cannot tell whether anyone saw the
      alert, and their contacts cannot tell whether anyone else is
      acting. The signal is already being captured and discarded:
      opening the tracking page calls recordAccess() on a VALID result.
      Surface it back - "3 notified, 2 opened the link".

  [ ] 2. "I AM RESPONDING" - the bystander-effect fix. Follows from 1.
      One button on the tracking page: I am on my way / I have called
      112. Contacts see each other. Diffusion of responsibility is a
      documented and lethal failure mode - five people alerted, each
      assuming another is acting. Nobody in this market solves it.
      Still AWARENESS, not coordination: it shows people each other, it
      does not direct anyone.

  [ ] 3. SURFACE BATTERY ON THE TRACKING PAGE. batteryLevel and
      isCharging are already in the DTO, already stored, already hashed
      into the chain - and never displayed. "Phone at 8% when last
      seen" changes how a family reads silence entirely: not "she is
      not answering" but "her phone died". The data is already there.

  [ ] 4. DURESS CANCEL - and note the cancel path is currently a hole.
      If an attacker takes the phone and cancels, the alert dies
      silently. Two parts: cancellation should NOTIFY contacts that the
      alert was cancelled rather than vanishing, and a DURESS PIN
      should show a convincing cancel screen while escalating. Sprint
      9's cancel path is untested anyway - design it properly rather
      than testing what happens to be there.

  [ ] 5. HARDWARE TRIGGER - 80% of wake-word for 10% of the cost.
      Triple-press power, or volume-down held. No microphone, no
      privacy conversation, no Porcupine, no EAS build, no App Store
      risk. Works in a pocket with the screen locked, which is most of
      what wake-word promises. DO THIS BEFORE VOICE - it makes the
      voice measurement prototype less urgent.

  [ ] 6. AUTOMATED INCIDENT REPORT on resolution, delivered by email.
      This is the OUTPUT of everything 10B built. The hash chain is
      currently INVISIBLE - a technical property no buyer ever sees. A
      report makes it tangible: what happened, the verification result,
      and an explicit statement of what can and cannot be attested to.
      It is the artifact an insurer, a solicitor or an HR investigation
      actually asks for, and the thing the commercial positioning
      promises but cannot currently hand anyone.
      Groundwork: ADR-001..003 outbox pattern for reliable delivery,
      an email provider, resolvedAt on the incident, and the timeline.
      TWO CATCHES:
        (a) IncidentTimelineEvent has NO hash chain (see known issues),
            so today a report can honestly say the LOCATION record is
            verified but NOT the EVENT log. Same blocker as camera
            evidence. Fix the timeline chain and both unlock.
        (b) The report contains an employee's location history. WHO
            RECEIVES IT is an NDPA question, not a formatting one.
            Proposal: subject always, employer by policy, insurer on
            request. Legal review before it ships.


  [ ] NO FORGOT-PASSWORD FLOW EXISTS. Recorded 28 July 2026.
      app/(auth)/login.tsx is login only. There is no PasswordReset
      model anywhere in schema.prisma, so this needs a migration,
      single-use tokens with expiry, a delivery path, and rate limiting
      so it cannot be used to enumerate accounts.
      Sprint 9 auth work, NOT Sprint 10B. Gates no revenue release, but
      it is a real product gap: a locked-out user of an emergency app
      cannot raise an alarm.

- [ ] **Enterprise Kit's Company Profile docx still says "OPA
      Technology Limited"** (singular "Technology") - the CAC-approved
      legal name is "OPA Technologies Limited" (plural). Website is
      already corrected. The docx needs regenerating, not patching,
      since it's a static file already downloaded.
- [ ] Idempotency protection against duplicate notification sends
- [ ] No edit screen for emergency contacts
- [ ] Register screen has no show/hide password toggle
- [ ] Phone normalization in contacts.tsx defaults any unrecognized
      number to +234 - can mis-normalize a foreign number typed
      without its country code.
- [ ] isLoading in contacts.tsx never resets to true on
      re-focus/refresh.
- [ ] Nigeria-only account registration - deliberately left as-is
- [ ] Family Dashboard / parent-monitoring - not written up yet
- [ ] Direction-of-travel / movement intelligence - PlacesProvider
      is an explicit self-labeled mock; see
      docs/architecture/emergency-intelligence-engine.md. Never add to
      the website, even as "Planned," until genuinely built.
- [ ] Mobile evidence capture (audio/video/photo) - backend real, no mobile client
- [ ] No medical information fields anywhere in the schema
- [ ] Logo/brand mark - shelved

## Journey Intelligence (Future)

Status: Planned, after Sprint 10B

Prerequisite:
- Continuous tracking infrastructure (Sprint 10B)
- Live traffic/incident provider integration

### Planned capabilities

- [ ] Monitor an active journey using live traffic providers.
- [ ] Detect traffic congestion ahead on the current route.
- [ ] Detect reported accidents on the current route.
- [ ] Detect road closures and construction affecting the route.
- [ ] Detect significant weather events affecting the journey (provider dependent).
- [ ] Notify the user only when meaningful changes occur (Poll -> Compare -> Notify).
- [ ] Notify when traffic conditions improve or delays decrease.
- [ ] Suggest alternate routes using the selected routing provider.
- [ ] Display source-backed travel information only.
- [ ] Clearly identify externally sourced traffic/incident information.

### Design principles

- OPA is not a navigation application.
- OPA complements Google Maps, HERE, TomTom, or similar providers.
- OPA focuses on safety-relevant travel information and emergency coordination.
- Present observable facts rather than synthesized safety scores.

### Explicitly out of scope

- Composite "Journey Risk" scores.
- AI-generated safety ratings.
- Behavioral profiling based on historical travel habits.
- Automatic inference of a user's routine without explicit feature design and consent.

See OPA-Journey-Intelligence-Strategy.docx, "Deferred or Declined
Concepts," for the reasoning behind each exclusion above - not just
what is excluded, but why, so these are not silently re-proposed
without the reasoning being visible.

### Implementation note

Reuse the existing Poll -> Compare -> Notify pattern introduced for
Sprint 10B continuous tracking. Do not build a separate monitoring
loop specifically for Journey Intelligence.

## Legal & compliance - real, not yet started

- [ ] **NDPC (Nigeria Data Protection Commission) registration** -
      required once processing personal data of 200+ people within any
      rolling 6-month window, a threshold a real pilot would likely
      cross quickly. Requires a completed CAC certificate number and a
      Nigerian-resident/citizen Data Protection Officer. Fee tiers by
      business size (~N25,000 for small business). Connected to CAC
      completion, not separate.
- [ ] Legal review of Privacy Policy and Terms of Service - both
      explicitly marked as drafts pending this.
- [ ] Business liability insurance - flagged early in the project,
      never actioned.
- [ ] Trademark registration (OPA, OPA Technologies Limited, logo) -
      see docs/REGISTRATIONS.md for full detail. Start once CAC completes.

## Backend - still open

- [ ] WhatsApp Business (Meta) registration - template submission and
      business verification pending.
- [ ] Voice webhook endpoint - blocked on deployment.

## Deployment - separate future session

- [ ] Provision Azure App Service (or Container Apps) for the API
- [ ] Provision Azure Database for PostgreSQL (managed)
- [ ] Generate real production JWT secrets
- [ ] Run prisma migrate deploy against production
- [ ] Update CORS for the real API URL
- [ ] Point mobile app's API base URL at the deployed URL
- [ ] Website: deploy to Azure Static Web Apps, DNS, HTTPS, analytics, CI/CD

## App store / launch - not started

- [ ] Apple Developer Program enrollment - blocked on CAC + D-U-N-S, see docs/REGISTRATIONS.md
- [ ] Google Play Console enrollment - blocked on CAC + D-U-N-S, see docs/REGISTRATIONS.md
- [ ] Payment gateway (Paystack/Flutterwave) - only once paid tiers exist

## Documentation status

- [x] docs/architecture/system-overview.md
- [x] docs/architecture/incident-lifecycle.md
- [x] docs/architecture/emergency-intelligence-engine.md
- [x] docs/SPRINT_ROADMAP.md - authoritative sprint status
- [x] docs/REGISTRATIONS.md - external registrations, owner/next-action tracked
- [ ] docs/architecture/notification-engine.md - never saved
- [ ] docs/architecture/survival-timeline.md - never saved
- [ ] docs/architecture/evidence-engine.md - never saved
- [ ] docs/architecture/journey-risk-intelligence.md - never re-confirmed
- [x] docs/future/ussd-fallback.md
- [ ] ADRs - not started

## A technique worth remembering

When a specific line or file repeatedly refuses to save correctly via
Notepad, use PowerShell directly:
(Get-Content <path> -Raw).Replace('<exact text>', '<replacement>') | Set-Content <path>
Verify with Select-String -Path <path> -Pattern "<exact text>".

Never assume a previously-verified file is still correct - files can
silently revert between sessions with no build/test catching it if the
reverted version still compiles.

When reading back any file with special characters (em-dashes, checkmark
symbols), use Get-Content <path> -Encoding utf8 explicitly - plain
Get-Content can garble the display even when the file itself is fine.

When a full-file paste via Notepad drops content on a long file, use a
PowerShell here-string (@'...'@) piped to Set-Content instead - proven
more reliable twice this session for full recoveries.

## Where we stopped this session

The mobile SOS activation screen is built and was proven live,
successfully, end to end - the first real proof of OPA's core promise.
That test surfaced and led to fixing two genuine production bugs. Real
Africa's Talking Sandbox credentials are in place and confirmed
working. Infrastructure hygiene (Azure key rotation, email DNS, legal
entity name) is caught up. Journey Intelligence's design is agreed and
pinned (observable-only, sequenced after Sprint 10B, explicit
out-of-scope list recorded with reasoning). Next real work: verify
Push/Email delivery individually, test SOS's Cancel/error paths, then
Sprint 10A (the incident portal) or Sprint 9 Pass 2 (voice trigger).

**New lesson from tonight's SPRINT_ROADMAP.md recovery:** a large
single here-string paste into PowerShell can silently choke or
truncate without any error - the terminal just stops receiving input
mid-paste. Write and verify long files in small chunks (Set-Content
for the first piece, Add-Content for each piece after), checking line
count after every single chunk. Also: do not trust a "file looks
complete" confirmation based on a document attachment - attachments
were unreliable multiple times tonight (some came through completely
empty). Always verify long file content via plain-text paste directly
in the chat.

## OPA Prevention (Future)

Status: Concept, not started. Depends on Sprint 10B, same as Journey
Intelligence - both are siblings, not sequential to each other.

### Architecture

Journey Session (started -> active -> ended) is the shared base.
Used directly by: SafeWalk, SafeDrive, SafeRide.
Journey Intelligence builds on the same Journey Session, adding
traffic and incident awareness on top.

Build the shared session concept once (started -> active -> ended
state), not four times.

- SafeDrive speed checks reuse the existing location and speed
  telemetry captured during an active Journey Session, compared
  against a user-configurable threshold - a simple rule evaluator,
  explicitly not AI, matching the observable-facts-only discipline
  already established for Journey Intelligence.
- SafeRide's "notify a trusted contact" reuses EmergencyContactsService
  and NotificationService - both real, tested, proven with a live SMS.
- Live-location sharing reuses whatever Sprint 10B builds for live
  tracking - built once, not per feature.
- Road-type-aware, jurisdiction-aware speed limit comparison needs
  Sprint 10C's real geocoding/places data (currently confirmed mock).
  A flat, user-set threshold is realistic launch scope; legal-limit
  awareness is a later refinement once 10C is real.

### Possible capabilities

- SafeDrive speed awareness (user-configurable threshold, not hardcoded)
- Driving behavior reminders (harsh braking, rapid acceleration, phone
  use, fatigue on long trips)
- SafeRide assistance - "Would you like OPA to help you get home
  safely?" leading with the offer, not a question about drinking
- Trusted contact assistance (call, share location, send an "I'm
  heading home" message)
- Ride service integration (future) through a provider abstraction that
  supports Uber, Lyft, Bolt, inDrive, local taxi providers, and future
  regional partners
- Long-trip wellness reminders

### Design principles

- Advisory, not enforcement - OPA is a coach, not an enforcer
- User consent required, opt-in only
- Configurable thresholds where appropriate, never hardcoded
- Prevention complements emergency response; it does not replace it
- No unsupported claims about impairment detection

### Explicit rule - never claim

- "OPA detects drunk drivers."
- "OPA prevents DUIs."
- "OPA knows if you're intoxicated."

These would overstate the product's capabilities without validated
technology to support them. Correct messaging: "OPA encourages safer
decisions," "OPA offers support when users choose to use it," "OPA
can help connect you with trusted contacts or transportation."

## SOS screen (sos.tsx) - deferred hardening (post Pass 1, committed 6196f8d)
- [ ] Block hardware Back button while screenState === 'activating' (UX decision - currently only blocked during countdown)
- [ ] Clear the GPS timeout when the location request succeeds (minor resource cleanup - orphaned timeout rejects into nothing)
- [ ] Consider Location.getLastKnownPositionAsync() before the high-accuracy fix to reduce activation latency on devices with a recent location

## Redis â€” production + follow-ups (foundation committed 44ff065)

### Production deployment (when dispatch features need Redis)
- [ ] Provision Azure Cache for Redis (NOTE: has a monthly cost â€” smallest
      Basic tier ~$16/mo, verify current pricing). Defer until a feature
      actually uses Redis; local Docker Redis is fine for dev until then.
- [ ] Set the PRODUCTION REDIS_URL (Azure App Service config) to point at
      the Azure Cache instance. Keep it in Bitwarden / app settings, not code.
- [ ] Code deploys as-is â€” NO code changes needed. Same RedisService,
      RedisModule, health check. Only the REDIS_URL env value changes.
- [ ] After pointing prod at Azure Redis, verify /health/ready on the
      production URL shows redis: up.

### Redis polish (trivial, non-blocking)
- [ ] The "Redis error:" log message text is empty (ioredis error .message
      is blank for ECONNREFUSED). Log the error .code or a fallback string
      instead, so the log line is informative. Cosmetic only.

### The dispatch pass (the work that USES Redis â€” separate, larger effort)
- [ ] Outbox pattern, background worker, idempotency, retry/backoff,
      dead-letter handling, move notification fanout from synchronous to
      worker-driven. This is the real "why we added Redis" work. The
      incidents.service.ts metadata flag `redisDispatchPrepared: true` is
      a placeholder for this â€” nothing dispatches via Redis yet.

### Dependency audit (whole tree, not Redis-specific)
- [ ] `npm audit` shows 32 vulnerabilities (3 low, 15 moderate, 13 high,
      1 critical) across the full dependency tree â€” pre-existing, not from
      ioredis. Do a proper review as its own task. Do NOT run
      `npm audit fix --force` casually â€” it can introduce breaking changes.

## Website â€” copy & design-system migration (in progress)

### Hero copy â€” refine wording (design-system + honesty pass done)
- [ ] Current hero is honest + forward-looking (alerting now, "building toward
      coordinated response next"). REFINE the exact wording to reflect OPA's
      direction: US launch for validation (real, near-term) + both audiences
      (consumer + B2B/institutional). Needs founder input on the precise
      framing. GUARDRAIL: present tense = only what the app does today
      (alert trusted contacts with live location). Coordination / hospitals /
      responders / operational picture = VISION, must be marked as future,
      never stated as current fact. Same standard as the killed DUI claim.

### Design-system migration across remaining components
- [ ] Apply semantic tokens (protection=teal brand, emergency=orange,
      success=green-only-for-safe-states) + focus-visible a11y rings to:
      HowItWorks, HospitalSection, SecuritySection, CTA, Footer, and the
      about/contact/hospitals/privacy/terms pages.
- [ ] Audit each of those for the SAME two issues found in Hero:
      (1) coordination/hospital/responder overclaims stated as present fact,
      (2) green (signal) used as brand color where it should be teal.
- [ ] Footer specifically: "Building trusted emergency coordination
      technology" -> honest present-tense (alerting/personal safety), with
      coordination as stated direction only.

### Done this pass (committed separately)
- globals.css: added semantic tokens (emergency/protection/success),
  kept signal/flare aliases for non-breaking migration.
- Navbar.tsx: teal brand dot, teal hovers, emergency CTA, focus-visible rings.
- Hero.tsx: honest copy + design-system colors + focus states.

### Logo (still to do)
- [ ] Decide on and add the OPA badge logo to Navbar (currently a teal dot +
      "OPA" wordmark). Badge at nav size may be muddy - consider a clean
      small mark or keep refined wordmark. Also favicon + footer logo.

## Dispatch-hardening - STATUS CORRECTED 25 July 2026, verified against real code

Phase 1 (transactional outbox + SOS dedup via advisory lock): DONE, confirmed
in incident-orchestrator.service.ts - incident + QUEUED IncidentNotification
rows created atomically, network calls correctly kept out of the tx.
Phase 2a/2b (scheduler + atomic claimNextQueued): DONE, confirmed in
notification-dispatch.worker.ts, with real unit tests.
Phase 2c-1 (durable JSON payload on the outbox row): DONE, confirmed -
orchestrator builds and stores payload via buildNotificationPayload() at
incident-creation time.
Phase 2c-2 (dispatchNotification() - the claimed-row dispatcher): DONE,
confirmed in notification.service.ts:235, with an extensive real test file
(notification.service.dispatch.spec.ts) covering missing notification,
wrong status, missing payload, and success/failure paths.

REMAINING - NONE. Phase 2c-3 confirmed FULLY DONE, 25 July 2026 (verified,
not assumed): grep for sendEmergencyAlert/Promise.all across the entire
apps/api/src tree found zero occurrences in the orchestrator itself. The
orchestrator's own spec file asserts sendEmergencyAlert is NOT called
(.not.toHaveBeenCalled(), twice). sendEmergencyAlert still exists on
NotificationService as a named legacy method (not called from the
orchestrator) - candidate for a later cleanup pass, not a blocker.

DISPATCH HARDENING IS COMPLETE END TO END: Phase 1 through 2c-3, every
piece verified against real code and real, passing tests. Both Revenue
Release 1 engineering gates (Sprint 10A + dispatch hardening) are fully
satisfied, not partially. Sprint 10C (real location-intelligence
providers) remains the one confirmed hard blocker to production
deployment - see SPRINT_ROADMAP.md.
      - drop contactsNotified/notifications-as-sent, since sends are async.
  [ ] Update incident-orchestrator.service.spec.ts: assert createMany with N
      rows and that sendEmergencyAlert is NOT called from the orchestrator,
      instead of asserting synchronous send counts.
  [ ] Build + run full test suite + commit as its own change.

CONSEQUENCE FOR REVENUE RELEASE 1 (Command Center MVP): both engineering
gates (dispatch hardening, Sprint 10A) are now substantially satisfied.
Sprint 10C (real location-intelligence providers) remains the genuine
blocker to any production deployment - see SPRINT_ROADMAP.md.

CONTEXT: Making OPA's emergency notifications durable (crash-safe) via an
outbox pattern. The Redis foundation (committed 44ff065) is the future
wake-up signal. This is the roadmap's "open decision" dispatch pass.

### KEY FINDINGS (all verified against real code, not assumed)
- USE THE EXISTING `IncidentNotification` MODEL as the durable outbox.
  Do NOT create a new NotificationOutbox table. IncidentNotification already
  has: status, attemptCount, lastError, provider, providerMessageId,
  queuedAt/sentAt/deliveredAt/failedAt/cancelledAt, and index
  [status, queuedAt]. It was designed for this.
- NO SCHEMA MIGRATION NEEDED. Enum NotificationStatus already has the full
  lifecycle: QUEUED, SENDING, SENT, DELIVERED, ACKNOWLEDGED, FAILED, CANCELLED.
  QUEUED = pending job; SENDING = claimed/lock (prevents double-send).
- The orchestrator (incident-orchestrator.service.ts) does NOT create the
  incident directly and has NO $transaction. It DELEGATES to
  `this.incidentsService.create(userId, {...})`.
- THEREFORE: the transaction boundary must live in incidents.service.ts
  (or incidentsService must expose a tx-accepting method the orchestrator
  composes with). *** NEXT STEP: inspect incidents.service.ts create() to
  see how the incident is created and whether it uses $transaction. ***
- Current flow is synchronous/in-request: orchestrator builds sendOne()
  tasks per contact/channel, fires Promise.all(...) to
  notificationService.sendEmergencyAlert(), collects results. Fragile:
  crash mid-send = lost notifications, no retry, no durable intent.

### PHASE 1 PLAN (when implementing)
1. Inspect incidents.service.ts create() â€” transaction or not?
2. Wrap incident-creation + IncidentNotification row creation (status=QUEUED,
   one per contact/channel) in ONE prisma.$transaction so they commit
   atomically. Likely needs incidentsService.create() to accept an optional
   tx handle, OR move the notification-row writes to where the incident tx is.
3. KEEP the current synchronous sends running (safety net) â€” do NOT switch
   them off until the worker (Phase 2) exists. No delivery gap.
4. Keep the existing incident-orchestrator.service.spec.ts GREEN.

### LATER PHASES
- Phase 2: dispatch worker â€” SELECT status=QUEUED ORDER BY queuedAt (uses
  existing index) -> UPDATE SENDING -> send via existing providers ->
  UPDATE SENT/FAILED. Then REMOVE the synchronous in-request send.
- Phase 3: Redis pub/sub wake-up (publish outbox:new after commit; worker
  subscribes for near-instant dispatch; periodic reconciliation loop as
  backstop if Redis down â€” Postgres stays source of truth).
- Phase 4: retry/backoff, dead-letter, idempotency (providerMessageId),
  metrics, rate limiting.

### DISCIPLINE NOTE
This is surgery on the MOST safety-critical path (SOS activation). Do it
with full focus + careful testing, not rushed. Analysis was done at the end
of a long session; implementation deliberately deferred to start fresh.

### INSPECTION COMPLETE â€” incidents.service.ts create() (design now 100% ready)
- create() is SIMPLE: a single `this.prisma.incident.create({data:{...}})`.
  No transaction, no related-record writes, no timeline/notification here.
  (Has the redisDispatchPrepared metadata placeholder flag.)
- Contacts are NOT available in incidentsService â€” the ORCHESTRATOR resolves
  activeContacts. So notification rows MUST be written at the orchestrator
  layer, not inside incidentsService.create().

### RESOLVED ARCHITECTURE (the fork is decided)
Compose the transaction at the ORCHESTRATOR level, with a tx-aware create:
1. Refactor `incidentsService.create(userId, dto, tx?)` to accept an optional
   Prisma.TransactionClient. Use `const db = tx ?? this.prisma;` then
   `db.incident.create(...)`. Existing callers + the spec keep working
   (tx is optional) â€” backward compatible.
2. In incident-orchestrator.service.ts, wrap in one transaction:
     const incident = await this.prisma.$transaction(async (tx) => {
       const inc = await this.incidentsService.create(userId, dto, tx);
       await tx.incidentNotification.createMany({
         data: activeContacts.flatMap(c => [
           // one row per channel (SMS/WhatsApp/Email as today), each:
           { incidentId: inc.id, contactId: c.id, contactName, contactType,
             recipient, channel, status: NotificationStatus.QUEUED,
             attemptCount: 0 }
         ]),
       });
       return inc;
     });
3. AFTER the transaction commits, keep the CURRENT synchronous sendOne()/
   Promise.all sends running as the safety net (Phase 2 worker replaces them).
   Optionally update the matching rows QUEUED->SENDING->SENT/FAILED as they
   send, so the records reflect reality even pre-worker (nice-to-have, not
   required for Phase 1).
4. Orchestrator needs PrismaService injected (check it isn't already).
5. Keep incident-orchestrator.service.spec.ts GREEN â€” run it after.

### IMPLEMENTATION ORDER NEXT SESSION
a. Add optional tx param to incidentsService.create() (+ keep spec green).
b. Inject PrismaService into orchestrator if not present.
c. Wrap incident+notification createMany in $transaction (status QUEUED).
d. Keep synchronous sends as-is (safety net).
e. Build (npm run build --workspace apps/api) + run orchestrator spec.
f. Local test: fire an SOS, confirm incident + QUEUED IncidentNotification
   rows exist in DB, and notifications still actually send (safety net).
g. Commit Phase 1 separately.

### TWO FINAL REFINEMENTS (important â€” adopted)
1. KEEP NETWORK CALLS OUT OF THE TRANSACTION. The $transaction must wrap
   ONLY database work (incident create + IncidentNotification createMany).
   Do the synchronous provider sends AFTER commit, never inside the tx.
   Correct order:
     Validate -> Load active contacts -> Build notification rows in memory
     -> BEGIN TX { create incident; createMany QUEUED rows } COMMIT
     -> (after commit) current synchronous send -> update rows SENT/FAILED
   Holding a DB tx open during SMS/WhatsApp network calls = anti-pattern
   (long locks, pool exhaustion). Keep the tx short.
2. incidentsService.create() signature: prefer passing the prisma/tx client
   as a param so it works with either this.prisma or tx without dup code,
   e.g. create(db: Prisma.TransactionClient | PrismaService, userId, dto).
   (Equivalent to the optional-tx approach; pick whichever keeps the spec
   green with least churn â€” check how create() is currently called elsewhere
   before changing the signature, so all callers are updated.)
3. LATER cleanup (NOT Phase 1): the incident.metadata flags
   redisDispatchPrepared / notificationFanoutPrepared become redundant once
   real dispatch state lives in IncidentNotification. Remove them in a later
   pass. Do NOT touch working code for this now.

### CAUTION when changing create() signature
create() is called by the orchestrator today as
`this.incidentsService.create(userId, dto)`. If we change the signature to
put the db client first, EVERY caller must be updated in the same change,
and the spec (incidents.service.spec.ts if it exists) updated too. Grep for
`incidentsService.create(` and `.create(userId` before editing. An OPTIONAL
trailing tx param (create(userId, dto, tx?)) may cause less churn than a
leading db param â€” decide based on the actual call sites.

### FINAL refinement â€” pre-generate notification IDs (adopt in Phase 1)
- createMany does NOT return inserted IDs. To let the post-commit synchronous
  sends update the EXACT rows race-safely, generate each notification row's
  UUID in app code BEFORE createMany (randomUUID()), and carry that id into
  sendOne(). Then updates are `where: { id: notificationId }` â€” exact, no
  fragile multi-field matching.
- Row lifecycle in sendOne after commit: set SENDING + attemptCount increment,
  then SENT (sentAt) or FAILED (lastError, failedAt).
- Contacts (activeContacts) MUST be loaded BEFORE the transaction (orchestrator
  resolves them; incidentsService doesn't know contacts).
- Chosen signature: create(userId, dto, tx?) with `const db = tx ?? this.prisma`
  â€” least-disruptive (trailing optional param).

### PRE-IMPLEMENTATION CHECKS (first commands next session, before editing)
- Call sites:  Get-ChildItem apps\api\src -Recurse -Filter *.ts |
    Select-String -Pattern "incidentsService\.create\("
- Orchestrator DI:  Get-Content <orchestrator>.ts |
    Select-String -Pattern "constructor|PrismaService|IncidentsService" -Context 0,12
  (Confirm PrismaService is injected into the orchestrator; add if missing.)

*** DESIGN IS COMPLETE. Next session = implement, starting with the two
checks above, then code. Do NOT redesign further. ***

## SEQUENCING DECISION (locked)
Founder's choice: OPTION A â€” complete ALL dispatch phases (1->2->3->4)
before starting Sprint 10A. Preference: finish the dispatch-hardening pass
completely rather than interleaving with feature work.

Order:
1. Dispatch Phase 1 â€” transactional QUEUED writes (design done, see above)
2. Dispatch Phase 2 â€” worker: QUEUED -> SENDING -> SENT/FAILED via existing
   providers; then REMOVE the synchronous in-request send.
3. Dispatch Phase 3 â€” Redis pub/sub wake-up (publish after commit; worker
   subscribes; periodic reconciliation loop backstop; Postgres = source of
   truth).
4. Dispatch Phase 4 â€” retry/backoff, dead-letter, idempotency
   (providerMessageId), metrics, rate limiting.
5. THEN Sprint 10A â€” Incident Portal (first user-visible feature after).

Each phase is committed + verified independently (not one mega-change).
Note: this is the longest path before anything user-visible ships â€” all
backend until Phase 4 done. Accepted deliberately. If momentum flags,
a visible feature (Sprint 10A) is the natural break point, but plan is
to push through dispatch first.

## TOMORROW'S PLAN (founder set â€” 10-12 hrs dedicated)
Sequence (dependency-honest, revenue-aligned):
1. DISPATCH HARDENING â€” Phases 1-4 (design complete, see dispatch notes above).
   Start: grep `incidentsService.create(` call sites + check orchestrator
   PrismaService DI, then code Phase 1 (tx-aware create + QUEUED writes,
   keep synchronous sends as safety net), then Phases 2-4.
2. SPRINT 10 â€” COMPLETELY (10A Incident Portal, 10B Live Tracking + Journey
   Session primitive). This is the REVENUE FOUNDATION â€” Command Center needs
   10A, SafeWalk needs 10B. Not a detour from revenue; it IS the path to it.
3. THEN revenue priority: Command Center MVP (Release 1), SafeWalk MVP
   (Release 2). See docs/COMMERCIAL_ROADMAP.md.

Keep tonight's dispatch design + sequencing decision intact â€” no re-designing.

## DISPATCH PHASE 2c â€” DESIGN (captured, implementation NOT started)

STATUS: Phase 2a (scheduler + idle worker) and 2b (atomic claimNextQueued +
tests) are DONE, committed, pushed (HEAD 1a58b84). Worker tick() is still
READ-ONLY (counts QUEUED, sends nothing). Orchestrator still does the
synchronous send (the safety net from Phase 1). Phase 2c is the cutover.

### KEY DESIGN DECISION: durable JSON payload on the outbox row (Path 1)
The worker only has the IncidentNotification row, but sending needs
personName/location/trackingUrl/message â€” which today live only in the
orchestrator's scope. So STORE them on the row at creation time.
Chosen shape: add `payload Json?` to IncidentNotification (NOT a bare
`message` column â€” JSON absorbs channel-specific fields + future templates/
localization without more migrations). Payload holds at least:
  { personName, location, trackingUrl, message }
Rationale: an outbox job must be SELF-CONTAINED â€” no re-querying mutable
tables (incident/user) at dispatch time. Content frozen at incident-time.

### STAGED SEQUENCE (do NOT do as one big commit)
Phase 2c-1 â€” Durable payload
  - Add `payload Json?` to IncidentNotification in schema.prisma.
  - Generate + apply Prisma migration (nullable = safe for existing rows).
  - Orchestrator: when building notificationRows (Phase 1b block), render the
    message + build the payload object, store it in the createMany data.
    (The message string is already built in sendEmergencyAlert today:
     `OPA ALERT: ${personName} may be in danger. Location: ${location}.
      Track live: ${trackingUrl}` â€” replicate/extract that.)
  - Keep synchronous send + worker read-only UNCHANGED. Build + test.
Phase 2c-2 â€” Claimed-row dispatcher
  - Add NotificationService.dispatchNotification(notificationId):
    1. Load notification by id.
    2. Require status === SENDING (it was claimed).
    3. Validate payload exists + has required shape.
    4. Map stored Prisma channel -> provider channel (toPrismaChannel inverse
       or store the app-channel in payload).
    5. Call existing provider dispatch (this.send({channel, recipient,
       subject, message})).
    6. Update SAME row -> SENT (sentAt, provider, providerMessageId) or
       FAILED (failedAt, lastError).
    7. NEVER create another row. NEVER increment attemptCount (claim already
       did +1).
  - Keep worker tick() read-only until this is unit-tested. Build + test.
Phase 2c-3 â€” Atomic cutover (ONE commit)
  - Worker tick(): claim + dispatch in a bounded loop.
    *** MAX_PER_TICK = 25 *** â€” do NOT loop-until-empty unbounded (would
    monopolize the event loop / run indefinitely under load).
    Pattern: for up to MAX_PER_TICK: row = claimNextQueued(); if !row break;
    await dispatchNotification(row.id).
  - Move delivery-result timeline writes (CONTACT_NOTIFIED) into the worker/
    dispatcher (they fire when the worker actually sends now).
  - REMOVE the synchronous sendOne/Promise.all block from the orchestrator.
  - Orchestrator response -> queue semantics, e.g.
    { incidentId, status: 'INCIDENT_ACTIVATED', notificationsQueued: N }
    (drop contactsNotified/notifications-as-sent â€” sends are async now).
  - Update incident-orchestrator.service.spec.ts: sends no longer happen in
    the orchestrator, so "sendEmergencyAlert called 3 times" becomes
    "createMany called with 3 rows; sendEmergencyAlert NOT called from
    orchestrator". contactsNotified assertion -> notificationsQueued.
  - Build + ALL tests + commit.

### MOBILE SAFETY (verified this session)
Greps of apps/mobile-app/src for contactsNotified / INCIDENT_ACTIVATED /
notifications / activate / orchestrator / coordinated returned NOTHING.
Only api.ts + authStore.ts matched incident|sos|emergency|api, and api.ts's
only hit was notifyForceLogout (auth). So the mobile app does NOT consume the
orchestrator's notification-result fields -> the response contract change is
safe backend-only. (A broader search / integration test is the best final
safeguard before shipping, but current evidence is strong.)

### CORRECTNESS NOTES (do not lose)
- dispatchNotification must NOT increment attemptCount (claim did it).
- Bounded batch per tick (MAX_PER_TICK=25).
- Nullable payload keeps the migration safe for existing rows.
- The claim (2b) already transitions QUEUED->SENDING conditionally; the
  dispatcher assumes the row is already SENDING (claimed), so it does NOT
  re-transition from QUEUED. sendEmergencyAlert's old unconditional
  QUEUED->SENDING-by-id path is the LEGACY/synchronous path; dispatchNotification
  is the new worker path. After cutover, reconcile: the synchronous path is
  removed, so sendEmergencyAlert (create-or-update) is only used by any
  remaining legacy caller â€” check incidents.controller isn't calling it.

### DB CAVEAT
Local runs need the dev terminal env (reachable DB); running from the wrong
terminal hits the VNet-private Azure DB and fails P1001. Worker/claim logic
is verified via UNIT TESTS (mocked Prisma), not live DB, which is fine.

### REFINEMENTS (adopt in implementation)
1. VERSION the payload: include `version: 1` so it can evolve safely.
2. Payload is the CANONICAL dispatch request â€” store channel + recipient +
   subject + message + trackingUrl + personName + location, e.g.:
     { version:1, channel:"SMS", recipient:"...", subject:null,
       message:"...", trackingUrl:"...", personName:"...", location:"..." }
   Goal: dispatchNotification becomes a near-pure dispatcher, no DTO rebuild.
3. EXTRACT ONE message formatter (REQUIRED, not optional): a single function
   that produces the payload/message, used by BOTH the legacy synchronous
   path (until it's removed in 2c-3) AND the worker path. Prevents the two
   paths drifting while they coexist across 2c-1..2c-3.
4. Batch limit CONFIGURABLE from the start:
     const MAX_PER_TICK = Number(process.env.DISPATCH_BATCH_SIZE ?? 25);
5. Timeline events: record NOTIFICATION_QUEUED when the tx commits, and
   NOTIFICATION_DELIVERED (or CONTACT_NOTIFIED) when the provider succeeds in
   the worker. Accurate audit trail of queue-vs-deliver.
6. API response shape (future-proof):
     { incidentId, status:'INCIDENT_ACTIVATED',
       notifications: { queued: N, dispatched: false } }
7. FUTURE (Phase 4, NOT 2c) â€” reclaim abandoned SENDING rows: a row stuck in
   SENDING (worker crashed mid-dispatch) needs reclaim logic, e.g. requeue if
   SENDING AND lastHeartbeat/updatedAt older than timeout AND
   attemptCount < maxAttempts. Document now so it isn't forgotten; do NOT
   build in 2c. (2b currently assumes SENDING = owned forever.)

## ============================================================
## GAP & TECHNICAL DEBT REGISTER (swept 23 July 2026)
## ============================================================
## Written after Dispatch Phase 2c completed and was verified live
## end-to-end. Purpose: know what blocks Sprint 10 vs what can wait.
## Codebase sweep found: ZERO stray TODO/FIXME markers, all modules
## have specs, 25 tests green, build clean.

### --- BLOCKS SPRINT 10A (must fix before the portal shows anything) ---

[ ] MOCK INTELLIGENCE PROVIDERS - six providers return fabricated data:
      emergency-intelligence/providers/geocoding.provider.ts
      emergency-intelligence/providers/hospital.provider.ts
      emergency-intelligence/providers/places.provider.ts
      emergency-intelligence/providers/police.provider.ts
      emergency-intelligence/providers/routing.provider.ts
      emergency-intelligence/providers/safe-place.provider.ts
    They return the SAME invented address/hospital/route for every
    coordinate on earth. Currently harmless because nothing displays
    them - but Sprint 10A (Incident Portal) is exactly the thing that
    would. A responder shown "nearest hospital 2.8km north" that is
    fabricated is a safety failure, not a cosmetic one.
    Fix options: (a) integrate real providers, or (b) gate them so the
    portal renders nothing rather than something false.
    Already done 23 Jul: mock address is no longer PERSISTED on
    Incident (commit 2d7eaee) - but it is still RETURNED in the API
    response under intelligence.location.

[ ] PROVIDER CONFIDENCE MARKER - tag every intelligence provider
    response as MOCK | VERIFIED | PRODUCTION so any UI can refuse to
    display non-production data. The provider name is already in the
    response ("MockGeocodingProvider"), but an explicit status field is
    far harder to ignore than a naming convention.

[ ] FAIL-FAST CONFIG VALIDATION - refuse to boot when NODE_ENV is
    production and any mock provider is wired. This is the systemic fix:
    it makes the whole class of "mock data reached a real user" bug
    impossible rather than merely documented.

### --- BLOCKS PILOT / LAUNCH (not Sprint 10) ---

[ ] Africa's Talking OPAALERT sender ID - TRANSACTIONAL bind. Awaiting
    their Contact Persons Form + AT Letter draft template (the Drive
    link 403s). ~2 week telco clock starts only on submission.
    Without it, alerts do NOT reach DND-registered numbers, which is a
    large share of Nigerian phones.
[ ] Production SMS configuration unverified - the roadmap Day-3 flag
    ("no getOrThrow key = may be unconfigured"). Confirm before pilot.
[ ] NDPC registration - requirements received. DPO qualification still
    unresolved (Asibor has no data-protection credentials; options are
    certification or engaging a licensed DPCO).
[ ] Data retention policy - define retention for location history,
    incident evidence, and audio BEFORE building more storage. NDPC will
    ask, and retrofitting retention is far more expensive than
    designing it in.
[ ] Redis is LOCAL ONLY - Azure Cache for Redis not provisioned. One
    env-var change when needed.

### --- DISPATCH: DEFERRED HARDENING (system works without these) ---

[ ] Phase 3 - Redis pub/sub wake-up. Currently a 2s poll; this makes
    dispatch near-instant. Postgres stays the source of truth, with the
    poll as reconciliation backstop.
[ ] Phase 4 - retry/backoff, dead-letter storage, idempotency.
[ ] Phase 4 - RECLAIM STUCK SENDING ROWS. Today SENDING = owned
    forever. If a worker crashes mid-dispatch, that row is stranded and
    never retried. Needs: requeue if SENDING AND updatedAt older than
    timeout AND attemptCount < max.
[ ] Phase 2c-4 - worker-side delivery timeline events. CONTACT_NOTIFIED
    was removed from the orchestrator during the cutover and has not
    been re-added in the worker. Delivery state IS still fully recorded
    on IncidentNotification (status/sentAt/failedAt/provider/
    providerMessageId) - only the human-readable timeline lost it.

### --- CODE CLEANUP (small, safe, no rush) ---

[ ] Orchestrator still injects NotificationService but no longer uses
    it post-cutover - dead dependency.
[ ] NotificationTaskResult interface is likely now unused.
[ ] sendEmergencyAlert legacy create-path has no callers after the
    cutover. Decide: keep as fallback, or delete and make
    notificationId required.
[ ] incident.metadata still carries redisDispatchPrepared /
    notificationFanoutPrepared - stale placeholder flags from before
    real dispatch state existed on IncidentNotification.
[ ] Prisma 6.19.3 -> 7.9.0 major upgrade available.
[ ] 32 npm vulnerabilities outstanding. Do NOT run `npm audit fix
    --force`.

### --- ALREADY HALF-BUILT (cheap wins, schema is ready) ---

[ ] RESPONDER ACKNOWLEDGEMENT - NotificationStatus already has
    ACKNOWLEDGED and IncidentNotification already has acknowledgedAt.
    Nothing sets them yet. Wiring this up enables escalation-when-
    nobody-responds later, and the schema work is already done.

### --- EXTERNAL / WAITING (no action available) ---

[ ] D-U-N-S number (D&B) - submitted, tracking 10631953.
[ ] Meta business verification - resubmitted after fixing address.
[ ] Picovoice - awaiting PRODUCTION pricing + minimum purchase
    commitment. Do NOT buy the $500 prototyping week until the feature
    is about to be built AND production pricing is known.

### --- IDEAS, NOT COMMITMENTS (explicitly unbuilt) ---
## Kept deliberately separate so they never read as a plan. NONE of
## these exist. Do not put any of them on the website, in a pitch, or
## in a pilot agreement until built and tested.
##   AI incident severity scoring; incident continuity engine;
##   multi-language distress detection; offline recovery; dynamic
##   responder prioritisation; community safety intelligence; live
##   responder coordination; verified safe-place scoring; evidence
##   vault; AI incident summaries; escalation when contacts do not
##   respond; cross-border support; family coordination dashboard.
##
## Of these, the ones with a real near-term basis are:
##   - escalation when contacts do not respond (ACKNOWLEDGED exists)
##   - offline recovery (ussd-fallback.md exists)
##   - multi-language triggers (language profiles exist)

### --- SPRINT NUMBERING (authoritative - do not drift) ---
##   Sprint 10A = Incident Portal
##   Sprint 10B = Live Tracking (produces the Journey Session primitive)
##   Sprint 13/14 = Command Center (revenue product)
##   Phase I = OPA Prevention (matches SPRINT_ROADMAP Phase I).
##   SafeWalk = COMMERCIAL_ROADMAP Revenue Release 2. Gated on Sprint
##   10B PLUS silence detection, which decision 4 of 10B DEFERS -
##   missed check-in escalation IS silence detection. 10B alone does
##   not unlock it. Corrected 28 July 2026.

## ============================================================
## MESSAGING CHANNEL ARCHITECTURE (decided 24 July 2026)
## ============================================================
## Where location intelligence belongs, by channel. Decided while
## reviewing whether to enrich alerts with address / cross street /
## landmark / nearest hospital once a real geocoder exists.

### THE PRINCIPLE
The rich context is not a message, it is a page. The SMS is the
doorbell; the portal is the room.

### SMS - optimise for one thing: getting someone to tap
  - 160 characters per segment. The CURRENT message is ~174 chars, so
    it already bills as TWO segments per contact per emergency.
  - Keep to: name, one location link, one tracking link. Nothing else.
  - Adding a verified street address must NOT simply be appended - it
    would push toward a third segment.
  - Target shape once short links exist:
      OPA ALERT: [Name] may be in danger.
      Location: https://maps.google.com/?q=<lat>,<lng>
      Track: https://opasafety.com/i/<shortid>

### WHATSAPP - richer, but still restrained
  - No 160-char limit, formatting supported.
  - Emoji/section formatting is fine here.
  - STILL do not embed hospitals, landmarks, cross streets: those go
    stale the moment the person moves. A message is a snapshot; an
    emergency is not.

### INCIDENT PORTAL - the authoritative, live source of truth
  This is where ALL intelligence belongs, because it can update as the
  incident evolves:
    verified street address (real geocoder), GPS coordinates, live map,
    movement trail, nearest landmark, cross streets, nearest hospital,
    battery level, network status, event timeline, retriggers,
    responder acknowledgements.

### WHY THIS SCALES
Adding more intelligence later enriches the PORTAL and requires no
redesign of the messaging layer. Messages stay cheap and fast; context
grows in one place.

### ACTION ITEMS THIS CREATES
[ ] SHORT INCIDENT LINKS (before Sprint 10A ships public links)
    Current: https://opasafety.com/incidents/<36-char-uuid>  (~79 chars)
    Target:  https://opasafety.com/i/<short-id>              (~30 chars)
    Solves THREE problems at once:
      1. Cost - likely brings SMS back to ONE segment, halving spend
      2. Security - a UUID in a URL with no auth model is guessable-
         adjacent; a short public id forces the auth question to be
         answered deliberately (see portal auth, below)
      3. Usability - a panicking family member can read it aloud
[ ] SMS CHARACTER-COUNT VALIDATION - fail a build/test if the rendered
    template exceeds one segment, so cost regressions are caught early.
[ ] PORTAL AUTHENTICATION MODEL (Sprint 10A blocker)
    /incidents/<id> currently has NO stated auth model. Decide before
    the portal exists: public-but-unguessable, signed URL with expiry,
    or authenticated. This governs whether a tracking link forwarded to
    a WhatsApp group exposes someone's live location indefinitely.
[ ] DECISION LOG - start docs/architecture/decision-log.md. Decisions
    already made that are worth recording: worker owns dispatch; GPS is
    authoritative until a production geocoder exists; mock providers
    must never persist authoritative data; versioned notification
    payloads; outbox pattern; incident origin coordinates are immutable
    (abduction point) while movement belongs in a location stream.

### DOCUMENTATION HYGIENE
Do NOT use "12 Allen Avenue, Ikeja, Lagos" / "Allen Junction" in
examples. Those are the MOCK geocoder's fabricated outputs, returned
for every coordinate on earth. Using them as illustrations of future
production behaviour blurs exactly the line this project has been
careful to hold. Use obviously-fictional placeholders instead.

## ============================================================
## PRE-SPRINT 10 INTEGRITY WORK - COMPLETE (24 July 2026)
## ============================================================

### DONE: SOS deduplication (commit 325d309)
  - Incident gains lastTriggeredAt + retriggerCount, plus an index on
    (userId, status, lastTriggeredAt).
  - Per-user pg_advisory_xact_lock inside the transaction serialises
    concurrent activations, so two simultaneous taps cannot both pass
    the "is there a recent incident" check.
  - Configurable window: SOS_DEDUPE_WINDOW_SECONDS (default 60).
  - A retrigger updates the existing incident, records SOS_RETRIGGERED
    with the NEW coordinates, and queues ZERO extra notifications.
  - Incident origin coordinates are deliberately NOT overwritten: they
    are where the emergency began (e.g. an abduction point). Movement
    belongs in a location stream (Sprint 10B), not smeared over origin.
  - Response distinguishes INCIDENT_RETRIGGERED from INCIDENT_ACTIVATED.
  - 10 unit tests + LIVE verification against real Postgres: two
    concurrent HTTP requests produced ONE incident, queued 4 then 0,
    and dispatched 4 notifications total (was 2 incidents / 8 before).

### DONE: Mock provider gating (commit 1a9c242)
  - DataConfidence type (MOCK | VERIFIED | PRODUCTION) and an
    IntelligenceProvider interface all providers implement, so a new
    provider cannot silently omit its confidence level.
  - All 7 providers declare it: 6 MOCK, DeviceTelemetryProvider
    PRODUCTION.
  - ProviderConfidenceValidator refuses to boot if any provider is MOCK
    unless OPA_ALLOW_MOCK_PROVIDERS=true is explicitly set.
  - Gated by an explicit opt-IN flag rather than NODE_ENV, because
    staging / UAT / demo environments are shown to real pilot partners
    and must be held to the same standard. Forgetting the flag fails
    CLOSED.
  - Verified both ways: warns and boots with the flag; refuses to start
    and names all six offenders without it.

### *** DEPLOYMENT CONSEQUENCE - READ BEFORE NEXT AZURE DEPLOY ***
  .env is not tracked, so Azure has no OPA_ALLOW_MOCK_PROVIDERS.
  THE NEXT PRODUCTION DEPLOY WILL REFUSE TO START. That is the guard
  working as designed - six providers still return fabricated data.
  This is deliberate and should NOT be "fixed" by setting the flag in
  Azure. The correct fix is to replace the mock providers, or gate the
  intelligence block out of the API response entirely, before the next
  deploy. A deploy that fails loudly is far better than one that
  quietly serves invented hospital locations to a pilot partner.

### REMAINING BEFORE SPRINT 10A
  [ ] Replace mock geocoder with a real provider (or gate intelligence
      out of the response) - now enforced by the validator.
  [x] Portal authentication model - RESOLVED 28 July 2026, and the
      question was obsolete rather than open. There is no
      /incidents/<uuid> route and there never was; the website has
      exactly eight pages and the tracking one is /i/[token]. ADR-008
      IS the decision: a 128-bit capability token, SHA-256 at rest,
      6-hour initial validity, revocable, never logged. That is the
      "public-but-unguessable" option this checkbox itself listed.
  [ ] Short incident links - fixes SMS cost (currently 2 segments),
      readability, and forces the auth decision.

## ============================================================
## SPRINT 10A - TRACKING ENDPOINT: ARCHITECTURE + GAPS
## Recorded 24 July 2026
## ============================================================

### DECIDED: transport architecture (extends ADR-008)
NestJS owns the tracking JSON API. Next.js owns /i/[token] and calls NestJS
SERVER-SIDE. The browser never calls Azure directly.

    Family opens  https://opasafety.com/i/<token>
        -> Next.js page (server-side fetch)
            -> Azure NestJS  GET /public/tracking/<token>

    Live polling  GET https://opasafety.com/api/tracking/<token>
        -> Next.js Route Handler (server-side)
            -> Azure NestJS

Why not the alternatives:
  - NestJS rendering HTML: mixes API and presentation, complicates
    deployment, makes the tracking UI harder to build.
  - Browser calling Azure directly: puts CORS configuration on the critical
    emergency path, couples the API hostname to frontend code, requires
    extra allowed origins for every preview deployment, and exposes
    infrastructure detail through client-side polling.

Server-to-server calls need no browser CORS at all.

### DECIDED: response contract
    GET /public/tracking/:token

    VALID           -> incident payload
    EXPIRED         -> incident: null
    REVOKED         -> incident: null
    INCIDENT_CLOSED -> closed incident summary
    NOT_FOUND       -> 404, generic body, no detail

State precedence, deliberately in this order:
  1. not found
  2. revoked      (an explicit access-control decision outranks everything)
  3. incident closed  (a family opening an old link benefits more from
                       learning the emergency ended than from "link expired")
  4. expired
  5. valid

recordAccess() is called ONLY after a VALID result. Expired, revoked, closed
and unknown links must not pollute access telemetry.

Never expose: token records, token hashes, user ids, notification ids,
internal notes, or raw database objects.

### *** BLOCKER: raw tokens will be written to application logs ***
The existing HTTP logging middleware logs the request path:
    {"event":"http_request","path":"/incident-orchestrator/activate",...}

Once /public/tracking/<token> exists, every request writes a WORKING
capability token into the logs. Anyone with log access - Azure diagnostics,
a support tool, a shipped log aggregator - would hold live tracking links to
real emergencies.

MUST be fixed BEFORE the endpoint ships:
  [x] Redact the token segment in the HTTP logger - DONE.
      redactSensitivePath in request-logging.middleware.ts, plus
      redactSensitiveTrackingUrls for free text (message bodies and
      stack traces) added in 7b152cd. Four redaction sites in total.
      NOTE: the trigger was NOT the tracking controller, which never
      throws - it is Nest's own unmatched-route 404, whose message
      contains the full URL and therefore so does Error.stack.
  [ ] After resolution, log the token RECORD ID or incident id - never the
      raw :token parameter.
  [ ] Audit any other place request paths are captured (error handlers,
      correlation-id middleware, Application Insights when enabled).
      STILL OPEN as of 28 July 2026 and MUST NOT be ticked from the
      repo. This is Azure-side: a clean codebase does not clear it.
      Correlation-id middleware is confirmed to log paths.

### REQUIRED HTTP HEADERS on the tracking API and page
  [ ] Cache-Control: no-store, private
  [ ] Referrer-Policy: no-referrer
        Without this, following any outbound link from the tracking page
        leaks the token in the Referer header to a third party.
  [ ] X-Robots-Tag: noindex, nofollow, noarchive
        A tracking link pasted into a public forum must not be indexed.

### BUILD ORDER
  1. GET /public/tracking/:token in NestJS, with tests
  2. Lock the public DTO and state behaviour
  3. opasafety.com/i/[token] in Next.js
  4. Same-origin Next.js Route Handler for browser polling
  5. Azure API base URL as a SERVER-ONLY env var (not NEXT_PUBLIC_)

### SMALLER GAPS FOUND THIS SESSION
  [ ] Jest teardown warning: "A worker process has failed to exit
      gracefully." Almost certainly NotificationDispatchWorker's
      @Interval(2000) timer outliving the test run. Harmless now; fix with
      .unref() or by stopping the scheduler in teardown.
  [ ] SMS character-count guard. The alert message is currently 154 chars
      with the name "Charles Haynes" - under the 160 single-segment limit,
      but only just. A longer name pushes it to two segments and doubles the
      cost silently. Add a test that fails if the rendered template exceeds
      one segment for a realistic long name.
  [ ] buildTrackingUrl doc comment still describes the old incident-id
      behaviour; the CRLF replace missed it. Cosmetic.
  [ ] Retrigger responses return trackingUrl: null by design - only the
      token hash is stored, so the original link cannot be reconstructed.
      If the tracking page ever needs a link on retrigger, the answer is to
      look up the live token RECORD and issue a fresh token, not to store
      the raw value.

## ============================================================
## SPRINT 10B - STEP-LEVEL PROGRESS (opened 28 July 2026)
## ============================================================
## Standing practice: code commit first, gated on tests. Docs commit
## second, adding the step here with its SHA and its MEASURED gate.
## Two commits per milestone. A step is not done until it appears below.

### DECISIONS TAKEN 29 July 2026 - item 9b and the sentinel family

  Recorded in ADR-010 (docs/architecture/decision-log.md) BEFORE any code
  was written, so the reasoning survives the session that produced it.

  [x] Decision A - negative sentinels fixed at BOTH boundaries.
      Client sanitiser (accuracy, speed, heading) lands in 9b.
      create-incident-request.dto.ts fixed in a SEPARATE commit, because
      the panic path has a LIVE exposure at app/sos.tsx:181 and a client
      sanitiser protects one client only. Open question 14 (tighten the
      SOS timestamp to @IsISO8601) rides along in that commit.
  [x] Sentinel rule, deliberately ASYMMETRIC - do NOT make it consistent.
      heading  : exactly -1 maps to null  (documented single sentinel)
      speed    : any negative maps to null (documented by SIGN)
      accuracy : any negative maps to null (documented by SIGN)
      One negative field 400s an ENTIRE batch of up to 200 fixes, and the
      ordinary cause is a phone sitting still.
  [x] Decision B - the tracker starts ONLY after a successful SOS
      activation, not on login. Closes open question 25 as a side effect:
      a cancelled SOS cannot strand a session holding fixes with no
      incident. REOPENS when SafeWalk can start a session independently.
  [x] Open question 24 - no expo-battery in 9b. Deferred to 9c, where a
      dependency decision is being taken anyway.

  STATUS 29 July 2026 (evening) - what of the above has actually landed:
    Client sanitiser  DONE    fa087a6, tracker + sos.tsx:181.
    API DTO fix       OPEN    create-incident-request.dto.ts is UNCHANGED.
                              The boundary that outlives any one client is
                              still unprotected, and open question 14 rides
                              along with it. Tier 2.
    Tracker lifecycle PARTIAL Decision B specified when the tracker STARTS
                              and never when it STOPS other than logout.
                              Nothing stops it on leaving the SOS screen, so
                              a second activation no-ops. Observed live.
    Sentinel rule     UNPROVEN on the platform that motivated it. Every
                              device run so far has been Android; the
                              negative-sentinel family is iOS CLLocation.

  NEXT: the receivedAt tie-break, then 9c. The 9b sender is built,
  corrected and device-verified. Nothing is blocked.

### DONE

  [x] Step 2 - schema, migrations, partial index
  [x] Step 3a - integration harness (6b77d6c) + fixtures (e6daa01)
  [x] Canonical payload serialisation (83acf02) - 22 unit tests
  [x] Canonical chain envelope (f3d2d41) - 27 unit tests
  [x] JourneySessionService (878520c, fixed 36e5d55, widened e99cdb9)
  [x] Service integration tests (04a4562) - both locks mutation-tested
  [x] Step 4 commit 1 of 2 - widen wrappers (e99cdb9)
  [x] Step 4 commit 2 of 2 - orchestrator wiring (4d544a9)
      Gate: tsc=0, 13 suites/147 tests, 5 suites/21 int tests.
      Discharged the trap where a green suite proves nothing about a file
      nothing imports: journey-session.service.ts entered the unit test
      graph here and compiled for the first time.
  [x] Item 6 - authenticated ingestion endpoint (861a843)
      POST /journey/fixes. Gate: tsc=0, 15 suites/167 tests, 5/21 int.
      Made the in-batch dedupe reachable for the first time (D5).
  [x] Item 7 - tracking DTO: fix origin, session state, serverTime (edec8c4)
      Gate: tsc=0, 16 suites/180 tests, 5/21 int.
      CLOSED the heading -1 GPS sentinel defect. On iOS CLLocation.course
      is -1 whenever course is invalid, INCLUDING a stationary device, so
      a sender forwarding it raw would have shipped a panic button that
      400s for someone standing still.
  [x] Item 8a - website tracking types (ea1abb4). Gate: npm run build.
  [x] Item 8b - live tracking page, same-origin polling (58cf35b)
      15s poll against the pre-existing /api/tracking/[token] bridge.
      The presentational block was MOVED with a SHA-256 match, not
      retyped. apps/website has no tests - the build IS the gate.
  [x] Item 11 - ADR-009 (f8d4b3e), 339 lines in decision-log.md
  [x] Item 9a - mobile API base URL now resolves (b68b0f5)
      Was hardcoded to one LAN IP with a comment admitting it would break
      on another network. Now: expo.extra.apiBaseUrl, else the Metro host,
      else THROW. Proven on a real device via Expo Go.
  [x] Session start endpoint (8b919be) - POST /journey/sessions
      Not in the original eleven items. The ingestion endpoint needs a
      sessionId and there was no client-facing way to get one. Idempotent:
      reuses an open session, and returns reused:true when it did.
  [x] Item 9b - mobile journey fix sender (fa087a6)
      src/services/journey-tracker.ts, 358 lines, plus guarded edits to
      sos.tsx and _layout.tsx. Client-side sentinel sanitising at both
      capture points. Gate: tsc --noEmit=0 (apps/mobile-app has no test
      framework), and a real Android device: POST /journey/fixes -> 201.
      The client asked for MANUAL and joined the incident own INCIDENT
      session, so the activation fix and the first tracked fix landed on
      ONE chain at sequences 0 and 1.
  [x] Item 9b corrections - cached replay and stationary silence (d5aca8b)
      DISTANCE_INTERVAL_M 25 -> 0, and a pre-start guard in enqueue().
      GATE: THE DEVICE, NOT tsc. tsc --noEmit returned 0 on the defective
      code AND on the fix; only the device and the database could tell the
      two apart. Measured on a stationary Android phone: 11 consecutive
      flushes, every one 201, 50 fixes at a 10s cadence, recordedAt
      monotonic against sequence, and activation sequence 4 (18:57:59.806)
      correctly preceding foreground sequence 5 (18:58:09.505).
      Two defects closed: recordedAt ran backwards against sequence
      because watchPositionAsync replays a cached position on subscribe;
      and distanceInterval maps to setSmallestDisplacement on Android,
      which silences a stationary phone entirely - the case a panic button
      exists for.
      CORRECTION TO THE RECORD: these two fixes were previously believed
      to have REGRESSED the sender to zero fixes. They had not. They were
      never executed - a fast refresh preserves module state, so
      startTracking() early-returned on if (running) and the phone kept
      running the pre-fix bundle. The discriminator is one line in the API
      log: acquireSession() sits below that early return, so a full start
      always POSTs /journey/sessions and a no-op start never does.
      When new code appears to have made things worse, prove it RAN.
      SIDE EFFECT, first time in project history: the 15s flush beating
      against the 10s capture produced multi-fix batches - roughly 20 of
      them. insertFixes in-batch CHAINING therefore executed on real data
      for the first time, with fix 2 previousHash coming from fix 1 hash
      computed inside the same call rather than read from the tail.
      In-batch DEDUPE still has not fired: it ran and correctly found
      nothing. That needs genuine duplicates, which is item 10.

### REMAINING

  [ ] Item 9c - offline buffer + retry queue (4-6h)
      No AsyncStorage or SQLite dependency exists yet. Needs that decision
      and open question 2 answered before it ships: the endpoint currently
      409s ANY fix for an ENDED session, and a batch buffered across a
      supersession is exactly that case.
      NOTE: in-batch CHAINING is now proven (see d5aca8b above). It is the
      in-batch DEDUPE that is still unexercised, and item 10 airplane-mode
      step is what will exercise it, not 9c on its own.
  [ ] Item 10 - end-to-end test (2-3h)
      SOS -> activation fix -> tracked fixes -> page shows RECEIVING ->
      airplane mode -> SILENT -> reconnect -> buffered fixes flush ->
      RECEIVING again. That last transition is the real proof.

  [ ] receivedAt tie-break in the public envelope - DO BEFORE 9c (0.25h)
      insertFixes captures date_trunc(milliseconds, now()) ONCE per call,
      so every fix in a batch shares one receivedAt. The envelope picks the
      newest fix by receivedAt desc with NO tie-break, so with a multi-fix
      batch either row may be returned. Harmless at 2 fixes. Under 9c a
      200-fix buffered batch shares one receivedAt, so an arbitrary
      tie-break could surface the fix from the START of an outage as
      latest - the same backwards last-seen defect at a much larger scale.
      Fix: ORDER BY receivedAt DESC, sequence DESC. sequence is strictly
      monotonic within a session, so it is the correct tie-break.
  [ ] Tracker lifecycle - nothing stops the tracker off the SOS screen
      stopTracking() is called from exactly one place: _layout.tsx, on
      isAuthenticated going false. So running stays true, a second SOS
      no-ops in startTracking(), and the first session id is kept even
      though a new incident exists. Observed twice: it caused the false
      regression above, and after a clean run the tracker was still
      flushing nine minutes past the end of the test. A hole in Decision B.
      Until it is fixed, force-close Expo Go after every device test.
  [ ] contactsNotified displays 0 while notifications dispatch
      Activate returns 201 before the outbox worker runs, so the count is
      computed before any notification exists. Measured: activate 201 at
      18:57:59.978, worker dispatched 4 notifications at 18:58:02, and the
      SOS screen read 0 contacts throughout. Not stale - structurally
      unavailable at response time. On a panic screen this is the worst
      direction for the error to run. The honest fix is the same work as
      the contact-acknowledgement idea: a state that updates, not a count.

### RIDES ALONG WITH ITEM 9

  [ ] Sprint 9 - SOS cancel path (untested since Pass 1)
  [ ] Sprint 9 - permission / network error handling (untested)
      Both are in app/sos.tsx and both became testable the moment the
      base URL fix landed. Doing them in the same device session is
      strictly cheaper than a separate one. Voice trigger is NOT in this
      block - unstarted, gates no revenue release, properly deferred.

### MEASURED BASELINES (28 July 2026)

  npx jest              16 suites, 188 tests
  npx tsc --noEmit      exit 0
  npm run test:int      5 suites, 21 tests
  npm run lint          15 errors + 1 warning (was 16+1)
  npm run build (web)   exit 0, TypeScript clean

  Only ONE production-code lint finding remains:
  incident-orchestrator.service.ts:6, TriggerMode imported and never used.

### STILL OPEN, RECORDED SO IT IS NOT LOST

  [ ] The unit suite leaks a worker handle. REOPENED 28 July after being
      closed prematurely. It is INTERMITTENT and tracks wall time, not
      suite count - four runs: 24s clean, 32s warning, 28s warning, one
      earlier clean. Almost certainly NotificationDispatchWorker's
      @Interval(2000) outliving teardown. Fix the mechanism with .unref()
      or teardown; do NOT close it by counting clean runs again.


## ============================================================
## STRATEGIC PRINCIPLES (24 July 2026)
## Principles and ideas. NOT roadmap commitments.
## ============================================================

### PRINCIPLE: OPA is an emergency EVENT platform, not a mobile app
OPA's value begins AFTER the trigger. The orchestrator should not care
whether an event came from an Android phone, an iPhone, a smartwatch, a BLE
keyfob, a vehicle sensor, an estate panel or a hospital duress button.

    Sensor event -> Incident -> Orchestrator -> Notifications
                             -> Tracking -> Evidence

ACTION: design Sprint 11's ingestion around "a sensor reported an event",
not "the phone sent video". This costs nothing now and keeps every future
hardware integration a matter of configuration rather than a rewrite. If
Sprint 11 is built phone-first, every later integration is a rewrite.

### PRINCIPLE: partner APIs come AFTER product-market fit, never before
Correct sequence: pilot -> users -> reliability -> partners ask -> API.
Building an SDK or public API now solves a problem nobody has asked to have
solved. OPA currently has no pilot, no revenue, no public API, no third-party
auth model, no docs and no operational history.

### WHO WOULD ACTUALLY INTEGRATE
Not competing safety apps - at least not until OPA owns something genuinely
hard to rebuild. The realistic first integrations are things that HAVE A
TRIGGER BUT NO BACKEND:
  bluetooth panic buttons, smartwatches, elder-care pendants, vehicle crash
  sensors, fleet telematics, estate panic buttons, school alarms, hotel and
  hospital duress buttons.
They have the trigger. OPA has everything after it.

Note the Stripe/Twilio/Okta counterexample: competitors DO integrate with a
provider that owns a difficult capability. So "never" is wrong; "not until
OPA owns something difficult" is right. Orchestration - who to contact, in
what order, on which channel, with what information, in which country, given
what already failed - might become that. It is not that yet.

### DO NOT RESELL SMS CAPACITY
The transactional Sender ID reaching DND numbers is a real advantage, but
routing another company's traffic through it is almost certainly a breach of
Africa's Talking's terms and the telcos', and acting as a messaging
intermediary in Nigeria carries its own NCC licensing exposure. Get legal
advice before going anywhere near this. "We have a Sender ID" is also not a
defensible moat.

### IDEA: AI incident companion - RECORDED WITH ITS BLOCKERS
Voice conversation during an incident: "are you safe", "have you reached
somewhere safe", multi-source location validation, safe-arrival confirmation.
Appealing, and NOT to be built before the core platform is proven. Two
failure modes must be designed around from the start:

  1. SPEAKING ALOUD CAN KILL SOMEONE. If a person is hiding and their phone
     says "Charles, are you safe?", the attacker now knows where they are.
     Designs that assume earbuds assume something most people will not have
     in at the moment it matters.
  2. VOICE IS NOT AUTHENTICATION. An attacker can say "yes, I'm fine". A
     coerced person can say it with a knife at their throat. Any mechanism
     that DE-ESCALATES based on a spoken answer has the same asymmetry as the
     false-alarm detection already flagged: a false positive costs an
     unnecessary alert, a false negative costs a life. Voice input may ADD
     urgency. It must never reduce it.

Also beware invented precision. "94% confidence, inside Shoprite" implies
indoor positioning and a business-location database at a quality that does
not exist for Nigeria. A confident wrong answer sent to responders is worse
than "GPS says roughly here".

SALVAGEABLE NOW, no AI required:
  - Multi-source location (GPS + cell tower + wifi). Standard, real, improves
    accuracy.
  - Safe-arrival confirmation and route deviation - these are SafeWalk
    (Phase I). Prevention is a different context from an active emergency:
    "you've stopped, are you okay?" before anything has happened is safe.
    Mid-abduction it is not.
  - Silent distress input. The real need is signalling danger without
    speaking or touching the screen. More a hardware and UX problem than an
    AI one.

### POSITIONING DISCIPLINE
Recurring pressure to restore "OPA doesn't send an SOS. It coordinates your
emergency." That line was removed for cause and must stay removed until it is
true. There is no police integration, no hospital dispatch, no responder
network. The orchestrator notifies trusted contacts.

The ambition is legitimate and can be stated honestly:
  "Today, one tap tells everyone who matters where you are. We're building
   toward coordinated emergency response."
Direction, clearly labelled as direction, costs nothing in honesty. A
capability claim to someone in danger costs everything.



## Camera/Surveillance Integration (Future, Enterprise-tier only)

ARCHITECTURAL DIRECTION recorded 28 July 2026. Not scheduled. Captured
because the reasoning is expensive to rediscover.

THE INVERSION. Not "camera sees something -> OPA raises an alert".
Instead: "an OPA incident is active -> authorised cameras contribute to
that incident's record."

Why the first version is wrong:
  - It inverts what triggers an OPA alert. OPA is PERSON-initiated,
    which is exactly why the signal is trustworthy. A camera is
    PLACE-initiated - that is premises security, a different product
    with a different buyer and mature incumbents.
  - It poisons the alert channel. Cameras fire on cats, headlights and
    wind. Mixing a high-precision signal (a person pressed SOS) with a
    low-precision one teaches people to ignore both.
  - Ring and Nest are not integrable anyway. Amazon closed third-party
    Ring API access and Google killed Works with Nest in 2019. Target
    enterprise VMS platforms (Milestone, Genetec, Verkada) instead.

THE RULE: OPA IS AN EVIDENCE COORDINATOR, NOT AN EVIDENCE REPOSITORY.
OPA never holds the footage. It holds a REFERENCE and a HASH, and it
issues a PRESERVATION INSTRUCTION. The video stays in the customer's
system. Same discipline as ADR-008: store the hash, never the artifact.
Consequence: OPA does not become a video processor, does not inherit
the retention liability, and cannot leak footage it never had.

THE WINDOW IS THE PRODUCT, not the button press. Preservation must
start BEFORE activation - the approach, the argument, the moment
someone was followed. By the time a security manager thinks to look,
that footage has usually rotated out. Target: press minus 10 minutes
through incident close plus 5.

EVIDENCE REFERENCE CONTRACT - what an evidence record must carry, so
that "never hold footage" is concrete in the data model:
  - incident id
  - facility id
  - camera identifier (or camera group)
  - REQUESTED preservation window
  - ACTUAL preserved window, as returned by the VMS
  - the CLOCK SOURCE the requested window was computed against
  - VMS reference / URI
  - content hash, if the VMS supplies one
  - preservation status
  - audit timestamps

CLOCK AUTHORITY. OPA computes the window; the VMS timestamps the
footage; they will not agree. This is the same problem as recordedAt
versus receivedAt, and it takes the same answer: name the authoritative
clock, record which one was used, and pad the window. A preserved
window that misses by ninety seconds because a DVR drifted is a failure
that only surfaces when somebody needs the footage.

SCOPE FOR v1: FACILITY-SCOPED. Incident raised at Facility X preserves
every camera at Facility X. Per-camera geospatial selection is better
and much harder - do not start there. A webhook a security team acts on
manually is a legitimate v1 integration.

LEGAL POSITION IS BETTER THIS WAY. OPA is not creating surveillance; it
is PREVENTING THE DELETION of footage the customer already recorded
under signage they already posted. Preserving a twenty-minute window
tied to one declared emergency is MORE data-minimising than blanket
30-day retention, not less. Purpose limitation is clean. The NDPA
consent question flagged in 4b6a66b still needs legal review, but it is
a far easier question in this direction than in the other.

HARD PREREQUISITE - do not build this first. IncidentTimelineEvent has
NO hash chain and an unguarded sequence race (see the known-issues
register). An evidence reference IS a timeline event, so until that is
fixed camera evidence cannot be part of a verifiable record - which is
the entire point. insertFixes in the journey module is the worked
solution to that exact race. Fix the timeline chain first.

CHECK BEFORE PLANNING: schema.prisma already has Evidence (line 226),
EvidenceType (59) and EvidenceStatus (67), and the API already maps
POST /incidents/{id}/evidence and GET .../download-url. But
SPRINT_ROADMAP says "Sprint 11 - Evidence Capture - NOT STARTED".
Both cannot be true. Verify against real code before scheduling Sprint
11 - it may be substantially further along than the roadmap claims.
Camera preservation would be an EvidenceType, not a new subsystem.

VERIFIED 29 July 2026. The note above was right to doubt the roadmap.
SPRINT_ROADMAP has been corrected. The verification turned up four things
that were not recorded anywhere, two of which are corrections to claims
this project has been making.

  [x] Sprint 11 is server-side substantially BUILT, not not-started.
      Model, enums, module, controller, service, Azure Blob storage,
      sha256-before-upload, idempotent dedupe on (incidentId, sha256),
      5-minute SAS download URLs, EVIDENCE_ADDED timeline event.
      AUDIO, VIDEO and IMAGE are already EvidenceType values, so phone
      capture needs NO migration.

  [ ] CORRECTION - EVIDENCE ENCRYPTION IS NOT IMPLEMENTED.
      Evidence.encryptionKeyId exists in the schema (line 237) and
      NOTHING SETS IT. There is no encrypt anywhere in evidence.service.ts.
      Azure Blob provides server-side encryption at rest by default, which
      is real, but that is AZURE holding the keys - not OPA-managed
      encryption. Those are materially different claims to an
      institutional buyer and only one of them is currently true.
      DO NOT claim encrypted evidence capture until this is built or the
      claim is narrowed to "encrypted at rest by the storage provider".
      This is the SECOND schema field found reading as a capability - see
      the background-source correction below. A field is not a feature.

  [ ] CORRECTION - source: background IS NOT A CAPABILITY.
      JourneyFixDto accepts foreground | background | manual, but a
      measured sweep of all 10 .ts/.tsx files under apps/mobile-app
      found ZERO hits for TaskManager, startLocationUpdatesAsync,
      defineTask, or even the string background. The client cannot send
      it. The enum value is a server-side placeholder for a capability
      never built on the client.
      HONEST STATEMENT: OPA records continuously WHILE THE APP IS OPEN,
      at a verified 10-second cadence, on a tamper-evident chain.
      Anything claiming background recording - staff guide, briefing,
      pitch, pilot agreement - must be corrected.
      The nearby claim that IS true and worth using: airplane mode is
      RECOVERABLE, because GNSS is receive-only. A phone in airplane mode
      keeps producing fixes, so with 9c persistence they all flush on
      reconnect - "here is where the phone travelled during the two hours
      it appeared dark". Location-off, force-kill and power-off are not
      recoverable, and no software fixes that.

  [ ] NEW - A SECOND BOOT DEPENDENCY, NOT PREVIOUSLY RECORDED.
      evidence.service.ts calls config.getOrThrow for
      AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER in its
      CONSTRUCTOR, and EvidenceModule is registered in app.module.ts:54.
      If either variable is absent the service cannot construct and the
      app does not boot - BEFORE ProviderConfidenceValidator is reached.
      It boots locally, so .env has both. AZURE IS UNVERIFIED.
      So the production-boot problem may have TWO causes, not one. Check
      Azure app settings for both variables before assuming the boot fix
      is a single decision about mock providers.

  [ ] TO VERIFY - is Evidence.capturedAt ever populated?
      It is nullable (line 239). If the upload path does not receive a
      capture time from the client, evidence carries only an UPLOAD time.
      "When was this recorded" is the first question anyone asks of a
      photo, and the same defect shape as the tracker cached-replay bug:
      a timestamp that looks authoritative and is not.

SEQUENCING, unchanged and now confirmed by code: fix the timeline chain
FIRST. evidence.service.ts:95 already writes an EVIDENCE_ADDED event into
a timeline with no hash chain and an unguarded sequence race, so the code
that needs the fix exists today. Until it lands, evidence cannot be part
of a verifiable record - which is the entire point.

ON A WHITE PAPER, if one is written: the subject should be the verifiable
record - how it is constructed, what it proves, and what it does not.
That is the differentiator and it is what institutional buyers and
insurers read. But WAIT UNTIL THE TIMELINE CHAIN LANDS. Location fixes
are chained; timeline events are not. A paper describing an audit-grade
record while half of it is unchained gets falsified by the first
technical reader, under our own name. The honest-limits section is what
would make it credible rather than marketing.

SEQUENCING: Enterprise tier. After the pilot, after Command Center, and
after the timeline chain fix. It is a reason for an institution to pay
MORE - not a reason for anyone to buy.


Status: Concept, not started. Sits behind Command Center MVP shipping.

OPA should NOT build cameras, computer vision, or CCTV hardware - that
is a different business entirely. OPA should be the RECEIVING end: a
camera vendor's own detection system calls into OPA via API, reusing
the existing IncidentTrigger enum (add CAMERA_DETECTION) and the same
incident-creation pipeline SOS_BUTTON already uses.

API-push from the camera system, never OPA polling in - camera
systems sit on private/firewalled networks; push is the only
realistic integration direction.

Every incoming camera event must carry confidenceScore, sourceSystem,
and rawEventId - detection is a scored claim, not a fact, same
guardrail as OPA Prevention's ban on claiming impairment detection.
A misfire has real social cost cameras alone do not: a false
"assault detected" claim could send security to the wrong person.

Confidence threshold (e.g. below 0.7 = advisory only, no auto-created
incident) is a PLACEHOLDER, not validated - needs real data from an
actual camera vendor's scoring behavior before treating as settled.

Separate open question, not yet solved: NDPA consent/lawful-basis
implications of a camera detecting and creating an incident about a
person who did not themselves activate anything - different privacy
posture than a self-triggered SOS. Flag for legal review whenever a
real building/campus integration is negotiated, not solved now.
