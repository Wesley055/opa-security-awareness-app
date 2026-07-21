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
