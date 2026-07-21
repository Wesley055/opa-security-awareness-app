# OPA — Launch & Registration Roadmap

**Status as of this document:** Production backend deployed, running, migrated,
and secured on Azure. Mobile app and website exist. CAC registration still
pending. No downstream registrations started. Target: broader public/market launch.

**Core principle:** Engineering (what we control) runs in PARALLEL with
registrations (what we wait on). We do NOT block build work on CAC, and we do
NOT launch publicly until the legal/registration chain is genuinely complete.
Integrity over speed.

---

## THE REALITY: WHY PUBLIC LAUNCH IS WEEKS-TO-MONTHS OUT

Public launch is gated by a paperwork chain rooted in CAC, not by engineering.
Most of these have lead times AFTER CAC completes that cannot be compressed.

```
CAC (PENDING — root dependency)
  |
  +-- NDPC registration (data protection)
  |     -> LEGALLY REQUIRED before processing real users' personal +
  |        location + emergency data at public scale
  |
  +-- D-U-N-S number (~1-2 weeks issuance)
  |     +-- Apple Developer (org) -> iOS App Store (review cycles)
  |     +-- Google Play (org)     -> Android (review cycles)
  |
  +-- Business banking (to take revenue)
  |
  +-- Africa's Talking custom Sender ID (production SMS identity)
```

**Implication:** A genuine public launch is realistically weeks-to-months away,
mostly on paperwork. The controlled hospital pilot, however, can proceed much
sooner on the already-proven synchronous path. So the plan splits into two
tracks that run at the same time.

---

## TRACK A — ENGINEERING (we control this; starts now)

This is the two-week Founder's Validation Sprint. Availability: 8-10 hrs/day
incl. weekends. Each day has an exit gate that must genuinely pass.

### Week 1 — Production Readiness

**Day 1 — Verify the deploy (mostly DONE)**
- [x] API deployed to Azure, boots cleanly
- [x] All production config/secrets set
- [x] DATABASE_URL valid, Prisma connects
- [x] All 6 migrations applied to production DB
- [x] DB password rotated after exposure, verified working
- [ ] Register a real user against live API -> confirm row in production DB
- [ ] Add `/health` (liveness) and `/health/ready` (readiness) endpoints
- [ ] Verify CORS is actually wired in main.ts (ALLOWED_ORIGINS was in schema
      only — confirm enableCors reads and splits it correctly)
- **Exit gate:** live API answers /health, a real register->login works end-to-end

**Day 2 — Redis provisioned + connected**
- [ ] Provision Azure Cache for Redis (Basic C0, right-sized for pilot)
- [ ] Build NestJS Redis module: connect on startup, PING verify, graceful
      shutdown, reconnect w/ backoff, error logging
- [ ] Wire Redis into /health/ready
- [ ] Keep REDIS_URL strict (real URL now)
- [ ] Tests incl. failure case (Redis down -> readiness fails cleanly, no crash)
- **Exit gate:** app connects to real Redis; pulling Redis down = clean degraded state

**Day 3 — Harden synchronous SOS path + observability**
- [ ] Correlation IDs on every incident
- [ ] Structured logging that never leaks secrets or precise location
- [ ] Error handling on SMS/WhatsApp providers
- [ ] Turn on Application Insights (basic telemetry)
- [ ] Verify SMS actually works in production (no getOrThrow key = may be unconfigured)
- **Exit gate:** real SOS on production creates incident + delivers notification, fully traced

### Week 2 — Real Dispatch Architecture + Pilot Readiness

**Day 4 — Outbox + worker skeleton**
- [ ] Postgres `dispatch_outbox` table
- [ ] Incident creation + outbox row in ONE transaction
- [ ] Background worker reads outbox -> publishes to Redis -> marks published
- [ ] Idempotency keys throughout

**Day 5 — Reliability controls**
- [ ] Retry limits + exponential backoff
- [ ] Duplicate/idempotency suppression
- [ ] Dead-letter storage for failed jobs
- [ ] Delivery-status tracking back into Postgres
- [ ] Cut notifications from synchronous -> worker-driven (keep sync as fallback flag)

**Days 6-7 — Failure-mode testing (THE INTEGRITY CORE)**
Each is an automated test AND a manual chaos test:
- [ ] Redis dies mid-dispatch -> incident still saved, job recovers
- [ ] Notification provider fails -> retries, then dead-letters, never lost
- [ ] Duplicate SOS taps -> one alert, not three
- [ ] Worker crashes mid-job -> re-processed idempotently, no double-send
- [ ] DB commits but worker down -> outbox holds it, publishes on recovery
- **Exit gate:** every failure mode demonstrably behaves correctly

**Day 8 — RC1 (feature complete, internal testing) + full regression**

**Day 9 — RC2 (defects fixed) + essential pilot docs**
(Consent Form, Privacy Notice, Hospital Pilot Guide, Incident Response
Playbook, Feedback Form — the 5 essential; skip NGO/Ambassador/full-Admin
guides until a second partner exists)

**Day 10 — Hospital onboarding + RC3 (pilot candidate, release-blockers only)**

**Day 11 — End-to-end rehearsal + go/no-go against gates**

**Days 12-14 — Buffer / fixes / controlled pilot prep**

### Engineering Launch Gates (hard, no exceptions)
- [ ] Incident permanently saved before dispatch
- [ ] Duplicate jobs don't create duplicate alerts
- [ ] Failed notifications retry safely
- [ ] Delivery results recorded
- [ ] API + Postgres + Redis health checks pass
- [ ] JWT secrets production-grade (DONE)
- [ ] Logs don't expose secrets or precise location
- [ ] Manual escalation procedure documented
- [ ] Pilot participants understand service limitations

---

## TRACK B — REGISTRATIONS (mostly waiting; act the moment each unblocks)

Ordered by dependency. The whole point: have everything else queued so that
when CAC lands, the downstream chain fires immediately, not from zero.

### TIER 0 — The root (IN PROGRESS)
- [ ] **CAC registration** — PENDING. Single highest-leverage external item.
      Unblocks everything below. Chase to completion.

### TIER 1 — Fire immediately when CAC completes
- [ ] **NDPC registration** (data protection) — LEGALLY REQUIRED before public
      processing of personal/location/emergency data. Do NOT public-launch without it.
- [ ] **D-U-N-S number** — apply the day CAC is done (~1-2 wk issuance).
      Gates both app store org accounts.
- [ ] **Business banking** — open corporate account (needs CAC docs).
- [ ] **Africa's Talking custom Sender ID** — production SMS identity (needs CAC).

### TIER 2 — Fire when D-U-N-S issues
- [ ] **Apple Developer Program (organization)** — needs D-U-N-S. Then iOS submission.
- [ ] **Google Play Developer (organization)** — needs D-U-N-S. Then Android submission.

### TIER 3 — Needs the above in place
- [ ] iOS App Store submission + review
- [ ] Google Play submission + review
- [ ] Payment processing / revenue infrastructure (needs banking)

---

## WHAT "PUBLIC LAUNCH" ACTUALLY REQUIRES (readiness checklist)

Beyond the pilot bar, a broader public/market launch needs ALL of:
- [ ] CAC complete
- [ ] NDPC registered (non-negotiable for public data processing)
- [ ] Mobile app live on iOS + Android stores
- [ ] Business banking + payment processing (if monetizing)
- [ ] Production SMS Sender ID (not sandbox)
- [ ] Terms of Use + Privacy Policy legally reviewed and published
- [ ] Dispatch architecture tested against all failure modes (Track A)
- [ ] Support + incident-response processes staffed
- [ ] Honest capability messaging (no banned claims: no DUI/impairment detection,
      no "replaces emergency services," no "auto-connects to police/hospital")

---

## RECOMMENDED SEQUENCING (the honest version)

1. **Now -> 2 weeks:** Track A engineering to pilot-ready. Track B: chase CAC,
   prep all downstream applications so they're ready to submit instantly.
2. **When CAC lands:** fire Tier 1 (NDPC, D-U-N-S, banking, Sender ID) same week.
3. **Controlled hospital pilot:** runs on proven synchronous path — does NOT
   wait for public-launch registrations. Validates product + hospital relationship.
4. **When D-U-N-S issues:** app store org accounts -> app submissions.
5. **Public launch:** ONLY when the full readiness checklist above is genuinely
   green. Not before.

**Awareness/outreach can begin now** with accurate messaging: "OPA is beginning
a limited pilot with selected participants to evaluate a new personal safety
platform." Use it to recruit pilot participants, hospital contacts, advisers.
Do NOT begin broad commercial onboarding until Track B is complete.

---

## IMMEDIATE NEXT 3 ACTIONS (when you return)
1. Register a real user against the live API; confirm the row lands in production DB.
2. Add /health + /health/ready; verify CORS wiring.
3. Chase CAC status + pre-fill the NDPC and D-U-N-S applications so they're
   ready to submit the moment CAC completes.
