# OPA Architecture Decision Log

Decisions that shaped the system, why they were made, and what was rejected.
Newest first. Written so that six months from now the reasoning survives,
not just the outcome.

---

## ADR-008 — Incident tracking links are hashed, revocable capability tokens
**Date:** 24 July 2026
**Status:** Decided. Core buildable in Sprint 10A; OTP re-issue deferred.

### Decision
The public tracking link is a database-backed, revocable capability token —
not the incident UUID, and not a self-contained signed URL whose expiry
cannot be changed.

```
https://opasafety.com/i/<256-bit-random-token>
```

The raw token exists only in the message that was sent. Only its hash is
stored. Bearer, read-only access to the family view.

### Expiry model
```
Initial validity      6 hours
Renewal condition     incident remains OPEN
Renewal mechanism     scheduled backend job (NOT page visits)
Renewal amount        +6 hours
Absolute ceiling      7 days from issuance
On incident closure   live access revoked immediately
Terminal status page  available 24h after closure
```

The same URL keeps working through renewals, so no extra SMS is sent.

**Renewal must NOT be triggered by page visits.** Anyone holding a forwarded
or leaked link could keep it alive indefinitely simply by reopening it —
which is precisely the behaviour the expiry exists to bound. Renewal is
driven by incident state, server-side.

Seven days rather than 72 hours: a kidnapping or missing-person case can
credibly run past three days, and a ceiling that fires mid-emergency is a
worse failure than one that fires late.

### Three terminal states — not one 404
These are different situations and must not share a message.

**Incident closed** — "This incident ended on [date] at [time]. Live location
sharing has stopped. For privacy and safety, previous location information is
no longer available through this link."

**Link expired while incident still OPEN** — must NOT say the incident ended;
that could tell a family the emergency is over while their relative is still
missing. "This secure tracking link has expired. The incident may still be
active. Verify as a registered emergency contact to regain access."

**Link revoked** — "This tracking link is no longer valid." Reveals nothing
about the incident to an unauthorised viewer.

### Two access tiers
**Tier 1 — family bearer link.** First name or chosen display name, current
location on a map, last update time, accuracy, battery, network status,
device online state, incident status, acknowledgement state, call/share
actions.

Excluded from bearer access: full movement history, audio/photo/video,
medical information, internal notes, the full contact list, device
identifiers, evidence downloads, administrative actions.

**Tier 2 — verified access.** After OTP verification as a registered contact,
or authentication as an authorised responder: movement trail, detailed
timeline, responder acknowledgements, verified nearby facilities and routing,
extended location history.

Evidence and medical information require stronger role-based authorisation
and must never be reachable merely by possessing a forwarded link. Medical
data under NDPA is a different regulatory category entirely.

### Scope reserved in the model, not built
```ts
type TrackingAccessScope =
  | 'FAMILY_BEARER'
  | 'VERIFIED_CONTACT'
  | 'AUTHORIZED_RESPONDER';
```
Sprint 10A builds the FAMILY view only. OPA has no responders — no dispatch
to hospitals or police exists — so a responder interface would be guessing at
requirements that cannot be validated.

### *** SCOPE SPLIT — read before planning Sprint 10A ***
**Build now (the core):** token generation and hashing, the `/i/<token>`
route, scheduled server-side renewal while OPEN, immediate revocation on
closure, and the three terminal states.

**Deferred (follow-up):** OTP re-issue when the 7-day ceiling is reached on a
still-open incident. This needs verification infrastructure that does not
exist — send a code to a registered contact's phone, verify it, issue a
replacement token, audit the issuance. That is a subsystem, and it serves the
case where an incident is *still open after seven days*. Most emergencies
resolve in hours, so building it before the basic family view puts the rare
case ahead of the common one.

**Accepted consequence until then:** an incident open past seven days means
family access lapses with no self-service recovery. Documented and accepted,
not an oversight.

**Two Tier-1 fields also assume unbuilt work:**
- *Acknowledgement state* — `NotificationStatus.ACKNOWLEDGED` and
  `acknowledgedAt` exist on the row, but nothing sets them yet.
- *Verified nearby facilities* (Tier 2) — blocked on replacing the mock
  hospital/police/routing providers.

### Rejected
- **Self-contained signed URL** — expiry cannot be changed or revoked after
  issuance.
- **Extend-on-access** — lets a leaked link be kept alive by viewing it.
- **Public while OPEN, no ceiling** — a kidnapping can stay open for days; a
  widely forwarded link then streams live location with no way to claw it
  back.
- **Authentication required to view** — breaks the neighbour who is
  physically closest, and adds account creation to an emergency.
- **Incident UUID as the public link** — conflates identity with
  authorisation; a leaked id becomes permanent access.
- **Generic 404 on expiry** — cannot distinguish "ended" from "still active,
  link expired", and the difference matters during a live emergency.

---

## ADR-007 — Refuse to boot with mock intelligence providers
**Date:** 24 July 2026 · **Status:** Implemented (`1a9c242`)

Every intelligence provider declares `dataConfidence: MOCK | VERIFIED |
PRODUCTION` via an `IntelligenceProvider` interface. The app refuses to start
if any provider is MOCK unless `OPA_ALLOW_MOCK_PROVIDERS=true` is explicitly
set.

Gated by an explicit opt-IN flag rather than `NODE_ENV`, because staging, UAT
and demo environments are shown to real pilot partners and must meet the same
standard. Forgetting the flag fails CLOSED.

Rejected: relying on provider naming conventions (easy to overlook, easy to
break) and on `NODE_ENV` (misses staging/UAT).

---

## ADR-006 — SOS deduplication via per-user advisory lock
**Date:** 24 July 2026 · **Status:** Implemented (`325d309`)

A panicking user taps SOS repeatedly. Before this, that created several
incidents and several full sets of alerts for ONE emergency — verified live:
two concurrent requests produced two incidents and eight messages.

`pg_advisory_xact_lock(hashtext(userId))` inside the transaction serialises
activations per user, so two simultaneous taps cannot both pass the "is there
a recent incident" check. A retrigger within `SOS_DEDUPE_WINDOW_SECONDS`
(default 60) updates the existing incident and records `SOS_RETRIGGERED`.

Rejected: a plain lookup-then-create (races), and silently swallowing the
second tap (repeated taps may signal rising distress and are worth recording).

---

## ADR-005 — Incident origin coordinates are immutable
**Date:** 24 July 2026 · **Status:** Implemented (`325d309`)

A retrigger does NOT overwrite the incident's latitude/longitude. Those are
where the emergency *began* — for an abduction, where the person was taken
from, which has forensic value. New positions are recorded on the timeline,
and continuous movement becomes a proper location stream in Sprint 10B.

A single lat/lng column cannot represent a trail. Overwriting it would
destroy the origin without producing the movement path responders actually
need.

---

## ADR-004 — Never persist mock geocoder output
**Date:** 23 July 2026 · **Status:** Implemented (`2d7eaee`)

`MockGeocodingProvider` returns the same fabricated street address for every
coordinate on earth. That address was being written to `Incident.address`,
meaning every incident carried a plausible but wrong location that the portal
or a responder could later trust.

GPS coordinates are authoritative until a production geocoder exists. The
notification message uses a coordinate-based maps link rather than an
address.

---

## ADR-003 — The worker owns dispatch
**Date:** 23 July 2026 · **Status:** Implemented (`6269661`)

The orchestrator queues; `NotificationDispatchWorker` claims and delivers.
Exactly one consumer of the queue — running both synchronous sends and a
worker against the same QUEUED rows would double-send.

Cost: notifications now go out on the worker's ~2s poll rather than in the
request. Phase 3 (Redis wake-up) closes that gap.

---

## ADR-002 — Versioned, self-contained notification payloads
**Date:** 23 July 2026 · **Status:** Implemented (`cb1387f`)

Each QUEUED notification row carries a versioned JSON payload with everything
needed to deliver it. The worker never re-queries incident or user data at
dispatch time.

An outbox job must be self-contained. Re-querying mutable tables at delivery
time means the message can change between queueing and sending.

---

## ADR-001 — Outbox pattern for notification delivery
**Date:** 22–23 July 2026 · **Status:** Implemented (Phase 1, `19bf1f0`)

Incident creation and notification rows commit in one transaction. If the
transaction commits, the intent to notify is durable and survives a crash.

Before this, notifications were fire-and-forget inside the HTTP request: a
crash mid-send lost them silently, with no record they were ever intended.
For an emergency product that is the worst possible failure.
