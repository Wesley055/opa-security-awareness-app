# OPA - Working To-Do List

**Last updated:** this session. Read this before assuming anything is
done - verify against real files/tests, same as everything else in
this project. **See docs/SPRINT_ROADMAP.md for the authoritative
sprint-by-sprint status - this file is for granular, individual items.**

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

## Dispatch-hardening â€” Phase 1 design (analysis DONE, implementation NOT started)

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
