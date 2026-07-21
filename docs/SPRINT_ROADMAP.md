# OPA - Sprint Roadmap

**This is the authoritative source of truth for sprint status.**
Every status below was checked against real code, a real test run, or
a real live confirmation - not assumed. Cross-reference with
docs/TODO.md for granular open items.

> **See "MASTER EXECUTION ROADMAP"** near the end of this document.
> It contains the primary phased execution plan (Phase A-K),
> including entry criteria, exit criteria, launch gates, and
> execution order. Use it as the authoritative guide for daily work.

Status key: DONE = Complete and verified - PARTIAL = Partial -
PLANNED = Planned, not started - NOT STARTED - VERIFY = Needs re-verification

---

## A lesson from this session

This file was silently truncated at some point tonight, and multiple
"confirmed complete" checks on it were based on unreliable document
attachments, not genuine verification. From now on: verify long file
content via plain-text paste in chat, not attachments. Use a guarded
PowerShell replace that checks find-text exists before writing. Write
and paste large content in small chunks, not one giant block.

---

## Production deployment session (recorded) - Phase A largely COMPLETE

A dedicated deployment session took the backend from "crashing on every
restart" to a live, migrated, secured production API on Azure. Verified
at each step against real logs, not assumed:

- NestJS API deployed to Azure App Service via GitHub Actions - DONE.
  Corrected the monorepo build: install at workspace root, generate
  Prisma client, build apps/api, assemble a self-contained deploy
  folder with bundled node_modules (--include=dev, prisma generate,
  npm prune --omit=dev, include-hidden-files). Artifact went from a
  broken 234 KB to a healthy 112 MB, confirming dependencies bundled.
- Startup path corrected - DONE. Build outputs to dist/src/main.js
  (not dist/main.js); Azure startup command set to node dist/src/main.js.
- PORT binding fixed - DONE. main.ts now listens on process.env.PORT.
- DATABASE_URL configured - DONE. Password contained a $ that had to be
  URL-encoded (%24). Later rotated (see below), new password chosen
  alphanumeric to avoid encoding issues.
- All production environment variables configured - DONE. Every
  getOrThrow key mapped and set: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
  (real production values generated, no longer "change-later"),
  JWT_ACCESS_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, BCRYPT_ROUNDS,
  AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER (opa-evidence),
  ALLOWED_ORIGINS, NODE_ENV=production. REDIS_URL currently a valid-format
  placeholder (redis://placeholder:6379) - nothing connects to Redis yet.
- prisma migrate deploy run against the real production DB - DONE. All
  six migrations applied. Because PostgreSQL is VNet-private (Private
  DNS, no public access), the migration was run from INSIDE the VNet via
  the App Service SSH console using an isolated Prisma CLI installed at
  /home/prisma-tools (pinned to the exact deployed version 6.19.3). VNet
  isolation was preserved throughout - public access was never enabled.
- Database connectivity verified - DONE. App connects, Prisma module
  initializes, "Nest application successfully started" confirmed in logs.
- Database password rotated - DONE. The original DB password was exposed
  in plaintext in terminal/chat output during the migration; it was
  rotated on the flexible server, DATABASE_URL and AZURE_POSTGRESQL_PASSWORD
  updated, app restarted and re-verified booting cleanly with the new
  credentials. New password saved in Bitwarden. (Same discipline applied
  earlier to the Azure Storage key.)

Still open in Phase A (only one item remains):
- Health endpoint NOT yet implemented (/health liveness, /health/ready
  readiness). This is the single remaining Phase A exit-criteria item.
- Not yet done (Phase A / Deployment Phase B scope): api.opasafety.com
  custom domain + SSL, ALLOWED_ORIGINS confirmed actually wired in
  main.ts (currently in schema only - CORS wiring UNVERIFIED), mobile
  app API_BASE_URL pointed at the deployed backend and full
  login -> contacts -> SOS flow re-tested live in production.

Notes / cleanup flagged during this session (see docs/TODO.md):
- AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER are read
  via getOrThrow but are NOT in the Zod env schema - they fail late
  (on module init) instead of fast (on validation). Add them to the schema.
- Leftover files in apps/api/prisma: schema.backup.prisma, schema.prisma.txt
  - remove from repo.
- The six AZURE_POSTGRESQL_* app settings are unused by the app (it reads
  DATABASE_URL). Harmless; optional cleanup.
- Node 20 deprecation warnings in the workflow (setup-node bumped to v4;
  other actions still warn) - cosmetic.
- SMS provider config is NOT read via getOrThrow, so it will not crash
  startup - meaning production SMS may be silently unconfigured. Verify
  separately before relying on it in production.

---

## Verified during earlier session

Confirmed through live testing, on a real device, against the real backend:
- Device GPS capture and accuracy - DONE
- Incident creation - DONE
- SMS delivery through Africa's Talking Sandbox - DONE, a real message arrived on a real phone
- Google Maps navigation using real coordinates - DONE

Identified during the same session:
- GeocodingProvider - confirmed mock, was leaking fabricated location text into real SMS; fixed
- PlacesProvider - confirmed mock
- RoutingProvider - confirmed mock, called with zero arguments
- Push and Email - fired in parallel with the verified SMS, not individually confirmed
- Incident portal - does not exist; trackingUrl points at nothing

---

## Phase 1 - Foundation

**Sprint 1 - Project Foundation** - DONE
**Sprint 2 - Authentication** - DONE (register screen still has no show/hide toggle)
**Sprint 3 - Emergency Contacts** - DONE (no edit screen; phone normalization defaults unrecognized numbers to +234)
**Sprint 4 - Notification Engine** - PARTIAL, see Feature Readiness Matrix for per-channel status
**Sprint 5 - Survival Timeline** - DONE
**Sprint 6 - Evidence Engine** - DONE backend / NOT STARTED mobile
**Sprint 7 - Incident Orchestrator** - DONE
**Sprint 8 - Website** - DONE v1

---

## Phase 2 - Mobile MVP

**Sprint 9 - Emergency Activation** - PARTIAL

- Pass 1 (SOS Button) - DONE - real countdown, real GPS, real API
  call, real incident created, real SMS delivered and confirmed
  received. Error paths now DONE and device-tested (committed 6196f8d):
  Cancel path, permission-denied (incl. Android permanent-denial ->
  Open Settings), network-failure, repeated activations, GPS timeout,
  stale-fix refresh. Reusable acquireLocation fixed the retry bug.
- Pass 2 (Voice - "Help Help") - NOT STARTED
- Pass 3 (Custom trigger phrase) - NOT STARTED

Sprint 9.5 (Voice Feasibility Study) - DONE. On-device keyword spotting
(Picovoice Porcupine) confirmed feasible for React Native / on-device /
offline. Strategic direction: Android-led voice; two-tier model (Standard
voice iOS+Android at Levels 1-2; Advanced always-on Android-first at Level
3). iOS background listening is fragile (call interruptions, App Store
review risk). Performance numbers (accuracy, battery, latency) are
ESTIMATES pending a device-tested measurement prototype - not verified,
not for marketing yet. Full detail: docs/VOICE_ACTIVATION_FEASIBILITY_STUDY.md

Deliberately not in Pass 1, by design: address/cross-street/landmark
(Sprint 10C), movement/compass direction (Sprint 10B), live incident
page (Sprint 10A).

---

### Sprint 10A - Incident Portal - PLANNED

Build a public page at https://opasafety.com/incidents/{id} showing
only verified information - incident status, activation time, trigger
type, latitude/longitude, GPS accuracy, last-update timestamp,
incident ID, and an "Open in Google Maps" button. No placeholders, no
estimated address, no fake movement. Reliability requirement:
critical incident information must be server-rendered, not dependent
on client-side JavaScript loading successfully.

### Sprint 10B - Live Tracking - PLANNED

Continuous GPS updates, last known location, automatic refresh, GPS
history, movement detection, bearing calculation, compass conversion,
route visualization, offline buffering synchronization.

### Sprint 10C - Location Intelligence - PLANNED

Only after PlacesProvider, GeocodingProvider, and RoutingProvider are
replaced with real, validated production integrations.

---

**Sprint 11 - Evidence Capture** - NOT STARTED
**Sprint 12 - User Profile** - NOT STARTED, medical fields need a schema migration first, confirmed absent from the database.

---

## Phase 3 - Command Center
**Sprint 13 - Dashboard Foundation** - NOT STARTED
**Sprint 14 - Incident Management UI** - NOT STARTED
Backend Facility model and access guards are real and tested; no
dashboard UI is currently connected to them.

## Phase 5 - Security Hardening
**Sprint 17** - NOT STARTED (basic rate limiting already real, ThrottlerModule confirmed in app.module.ts)

## Phase 6 - Pilot
**Sprint 18 - Pilot Execution** - NOT STARTED
**Sprint 19 - Pilot Operations** - NOT STARTED

## Phase 7 - Business Operations
**Sprint 20 - Legal** - PARTIAL, CAC registration in progress. A working
Africa's Talking API key does not require CAC completion - only a
custom branded Sender ID does.
**Sprint 21 - Sales Operations** - NOT STARTED
**Sprint 22 - Marketing Assets** - PARTIAL

## Phase 8 - App Store
**Sprint 23** - NOT STARTED

## Phase 9 - Market-Ready Documentation
**Sprint 24** - PARTIAL, Enterprise Kit built.

---

## Phase 4 - Deployment

**Sprint 15 - Production Infrastructure** - PARTIAL, in progress
(backend now deployed and migrated this session - see "Production
deployment session" near the top; remaining: custom domain + SSL,
CORS wiring verification, mobile app pointed at production)

### Deployment Phase A - Website Infrastructure (Immediate, before hospital outreach)

Goal: make opasafety.com publicly accessible and professional.
Backend deployment is not a dependency for this phase.

Website hosting:
- [x] Deploy Next.js website to Vercel (Azure Static Web Apps ruled
      out - App Router support confirmed still in preview, with
      documented production failures)
- [x] Verify all six pages load publicly
- [x] Verify HTTPS certificate
- [x] Verify mobile responsiveness
- [x] Verify page titles and metadata
- [x] Verify all navigation links
- [x] Verify the mailto info@opasafety.com button opens correctly

Domain:
- [x] Connect opasafety.com to Vercel
- [x] Preserve all Microsoft 365 DNS records (MX/SPF/DKIM/DMARC)
- [x] Verify DNS propagation
- [x] Verify www.opasafety.com redirects correctly

Production verification:
- [x] Test from an external network
- [x] Test on desktop
- [x] Test on mobile
- [x] Confirm no localhost references remain
- [x] Confirm no placeholder content remains

Milestone: public website ready for hospital outreach - ACHIEVED.
opasafety.com is live on Vercel, DNS connected via one clean CNAME
record (Microsoft 365 email records confirmed untouched), verified
working on mobile data, all six pages confirmed, mailto button
confirmed working. Achieved this session.

### Deployment Phase B - Production API (before the first real pilot)

Goal: deploy the backend for real pilot usage. Not required to send
outreach - only required once a hospital says yes.

- [x] Azure App Service provisioned for the backend API
- [x] Azure Database for PostgreSQL provisioned
- [x] Existing Azure Storage account confirmed live; production
      application integration configured (connection string + container
      set as env vars; access controls/networking review still advisable)
- [x] Real production JWT_ACCESS_SECRET / JWT_REFRESH_SECRET generated
      - previous values were named "change-later"; now real
- [x] All development secrets removed from production config
- [x] prisma migrate deploy run against the real production database
- [x] Database connectivity verified
- [x] NestJS API deployed
- [ ] Health endpoint verified (NOT DONE - only remaining core item)
- [ ] Authentication verified end-to-end in production (register/login
      not yet exercised against live API)
- [ ] api.opasafety.com created and pointed at Azure App Service
- [ ] SSL verified on api.opasafety.com
- [ ] CORS / ALLOWED_ORIGINS updated for the real API URL (value set;
      wiring in main.ts UNVERIFIED)
- [ ] Mobile app's API_BASE_URL pointed at the deployed backend, full
      login -> contacts -> SOS flow re-tested live against it

Milestone: production API available for pilot customers. (Backend is
deployed, migrated, and running; a few verification/wiring items remain
before it's fully pilot-ready.)

**Sprint 16 - Production Hardening** - NOT STARTED
Full penetration testing, security headers, dependency audit,
disaster recovery, backup strategy - deferred until Phase A/B are live.

---

## Deliberately deferred - not near-term

Journey Monitoring (traffic and incident awareness) - design agreed,
see docs/TODO.md "Journey Intelligence (Future)" section for full
detail. Do not start before Sprint 10B exists. Also deferred: Safe
Walk/Trip mode, Family Dashboard, enterprise analytics, international
expansion, government/FRSC integration, USSD fallback, wearables,
drone/CCTV, insurance partnerships, Guardian (undefined placeholder),
Enterprise fleet monitoring (concept only).

---

## Feature Readiness Matrix

| Capability | Status |
|---|---|
| Device GPS + accuracy | DONE - live tested |
| Incident creation | DONE - live tested |
| SMS delivery | DONE - live tested, real message received |
| Google Maps navigation | DONE - live tested |
| Push notifications | VERIFY - fired in parallel, not individually confirmed |
| Email delivery | VERIFY - fired in parallel, not individually confirmed |
| WhatsApp delivery | PARTIAL - real test message sent and confirmed received via Meta app dashboard; still needs real business phone number registration, business verification, and the opa_emergency_alert template approved before it works through the actual product code |
| Voice delivery | PLANNED - blocked on a public webhook |
| Diaspora SMS (non-Nigerian numbers) | NOT STARTED - Africa's Talking Sandbox confirmed rejecting a US number; Twilio identified as the real fix, see Phase 4 |
| Incident portal | PLANNED - Sprint 10A |
| Live tracking | PLANNED - Sprint 10B |
| Command Center | NOT STARTED - Sprint 13/14 |
| Production backend (Azure) | DONE - deployed, migrated, running, DB-connected, secured (this session) |

---

## Critical path to a real pilot, in order

1. Phase A - deploy website to Vercel, connect opasafety.com - DONE
2. Send real hospital outreach (Lagoon Hospitals, Reddington, Eko, St. Nicholas - all confirmed in Lagos) - NOT YET SENT
3. Verify Push and Email delivery individually
4. Test SOS Cancel and error-handling paths
5. Sprint 10A - Incident Portal
6. Twilio integration for diaspora SMS
7. Sprint 9 Pass 2 - Voice trigger
8. Sprint 10B - Live tracking
9. Phase B - Production API deployment - DONE (deployed & migrated;
   verification/wiring items remain)
10. Sprint 13/14 - Command Center reconnected




---

# MASTER EXECUTION ROADMAP

**Status:** Primary execution roadmap

This roadmap defines the order of execution for OPA development.

The sprint details above remain the implementation backlog. This
section is the authoritative source for:

- Phase sequencing
- Entry criteria
- Exit criteria
- Launch gates
- Daily execution order

Unless a task directly blocks the active phase, new work should be
captured here and scheduled into the appropriate future phase rather
than interrupting the current one.

### Phase A - Production Foundation (Current - nearly complete)

Objective: get OPA running in Azure with a working production backend.

Infrastructure:
- [x] Azure App Service provisioned
- [x] Azure PostgreSQL provisioned
- [x] Virtual Network configured
- [x] Public website deployed
- [x] Configure DATABASE_URL
- [x] Configure production environment variables
- [x] Deploy NestJS API
- [x] Run prisma migrate deploy
- [ ] Verify health endpoint (only remaining item - implement /health
      + /health/ready, then set Azure Health check path)
- [x] Verify database connectivity

Exit criteria: backend reachable, database connected, health checks
passing, production deployment repeatable. STATUS: all met except the
health endpoint. Implementing it closes Phase A.

### Phase B - Sprint 9 Completion

Objective: complete the MVP emergency workflow.

Pass 1:
- [ ] Cancel flow
- [ ] Permission denied
- [ ] Network failure
- [ ] GPS verification
- [ ] Error handling

Pass 2:
- [ ] Voice trigger
- [ ] End-to-end verification
- [ ] Production testing

Exit criteria: SOS workflow verified, voice activation verified,
production-ready emergency flow.

### Phase C - Pilot Readiness

Objective: prepare OPA for real users.

Product:
- [ ] End-to-end incident testing
- [ ] Notification verification
- [ ] Production logging
- [ ] Security review

Documentation:
- [ ] Terms of Service (real legal review, currently draft)
- [ ] Privacy Policy (real legal review, currently draft)
- [ ] Safety Claims and Communications Standard (new, small, doable now)
- [ ] Emergency Response Disclaimer

Business:
- [ ] Hospital outreach sent
- [ ] Pilot agreements
- [ ] Support email

Launch gates: production deployment complete, notification provider
verified for launch market (SMS via Africa's Talking already verified
for Nigeria), core workflows validated, required legal documents
complete.

> NOTE (open decision): A dedicated production-hardening / real Redis
> dispatch architecture effort (outbox pattern, background worker,
> idempotency, retry/backoff, dead-letter, failure-mode testing) has
> been designed but not yet slotted into a phase. Decide whether it
> expands Phase C or becomes its own phase, and whether it precedes or
> follows Phase B (Sprint 9 completion). See docs/TODO.md and the
> separate Launch & Registration roadmap. Not yet scheduled here to
> avoid silently reordering the plan.

### Phase D - Nigeria Launch (Primary Commercial Launch)

Focus: hospitals, universities, employers, security organizations,
trusted contacts.

Goals: active users, pilot customers, revenue, product validation.

### Phase E - US Validation Launch

Status: limited validation, not a nationwide consumer launch.

Prerequisites:
- [ ] Nigeria launch operational
- [ ] Notification provider verified for US users (Twilio or
      equivalent - Africa's Talking confirmed rejecting a US number
      in live testing)
- [ ] Country-specific phone handling implemented (contacts.tsx
      currently defaults unrecognized numbers to +234 - known bug)
- [ ] Country configuration work started

Goals: early adopters, enterprise pilots, product feedback,
reliability validation.

### Phase F - Sprint 10A (Incident Portal)

- Timeline
- Evidence
- Portal UI
- Incident management

### Phase G - Sprint 10B (Live Tracking)

- Continuous GPS
- Poll -> Compare -> Notify
- Live map
- Journey Session primitive

Exit criteria: continuous tracking working, Journey Session available
for reuse.

### Phase H - Journey Intelligence

Depends on Sprint 10B.

Capabilities: route monitoring, ETA monitoring, incident awareness,
traffic integration (future), weather integration (future).

Design principle: reuse the Journey Session. Do not build a separate
monitoring engine.

### Phase I - OPA Prevention (Future)

Status: target architecture, not yet implemented.

Prerequisites:
- [ ] Sprint 10B complete
- [ ] Journey Session available
- [ ] Production notification provider(s) for target markets
- [ ] Provider abstractions where needed

Shared Journey Session (started -> active -> ended), reused by
SafeWalk, SafeDrive, SafeRide, and Journey Intelligence.

SafeWalk: journey monitoring, missed check-ins, escalation.
SafeDrive: user-configurable speed awareness, driving behavior
reminders, fatigue reminders, phone distraction reminders.
SafeRide: ride home assistance, trusted contact assistance, ride
provider integration (future).

Design principles: advisory not enforcement, opt-in only, observable
facts only, no impairment detection claims, prevention complements
emergency response rather than replacing it.

Full detail already recorded in docs/TODO.md under "OPA Prevention (Future)".

### Phase J - Multi-Country Platform

Status: target architecture. Not representative of the current
implementation.

Goal: country-aware, not country-forked. One OPA platform, with
country configuration selecting providers - not separate apps per
country.

Provider abstractions needed: notification, maps, ride services,
payments, language.

Known prerequisites:
- [ ] Remove the +234 default phone assumption in contacts.tsx
- [ ] Provider abstraction for SMS (Twilio alongside Africa's Talking)
- [ ] Country-specific configuration system
- [ ] Regional compliance work

### Phase K - International Expansion

Priority order: Nigeria (commercial launch), US (validation launch),
Ghana, Kenya, South Africa.

---

## Guiding Principles

- Build only what the current phase requires.
- Distinguish current implementation from target architecture.
- Use launch gates before expanding scope.
- Reuse shared components instead of creating parallel systems.
- Avoid country-specific forks; prefer configuration and provider
  abstractions.
- Never overstate product capabilities in marketing or documentation.
