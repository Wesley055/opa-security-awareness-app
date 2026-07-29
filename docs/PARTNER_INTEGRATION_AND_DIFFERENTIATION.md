# Partner Integration and Differentiation

**Date:** 29 July 2026
**Status:** Design proposal and market assessment. NOT a decision record.
Decisions it calls for are listed in section 13 and belong in the decision log
when taken. One of them is a founder-level fork that should be taken
deliberately rather than by drift.

Companion to PANIC_SYSTEM_CAPABILITY_ASSESSMENT.md, which assessed what OPA
does and does not do. This document asks a different question: given a crowded
market, what should OPA be, who pays for it, and what should partners plug into.

## 1. The market as it actually is

Competitors named in existing strategy documents: a funded, government-
partnered response operator with a live 24/7 command centre, thousands of
managed emergencies and corporate clients; a second startup with near-identical
positioning; and dedicated hardware vendors selling pendants, badges and
under-desk buttons into fixed facilities.

**There is a competitor absent from every strategy document in this project:
the phone itself.**

Apple ships Emergency SOS, crash detection and satellite emergency messaging.
Android ships a Personal Safety app with emergency sharing. Both are free,
pre-installed, have deeper OS access than any third-party app can obtain, and
the satellite path is better on the device-dark problem than OPA will ever be.

**Any consumer-facing phone safety app competes with a free built-in feature
that has better hardware access.** That is the real crowding, and it is a
losing fight on those terms.

Consumer safety apps also compete with established location-sharing products
that already do continuous tracking well and have large installed bases.

## 2. What is and is not a differentiator

Ranked by how hard each is to copy. This ordering matters more than the list.

### Genuinely defensible

**1. Independence of the record.** An incident record is weaker evidence when
the responder produces it. An insurer assessing whether response was timely, a
court examining a duty-of-care claim, an employer demonstrating compliance -
each is on weaker ground when the record comes from the party being assessed.

A response operator cannot produce a neutral record *about their own response*,
no matter what technology they build. This is structural, not technical. **It is
the only thing on this list that a well-funded competitor cannot simply build.**

**2. Nigerian channel and regulatory fit.** WhatsApp as a primary alerting
channel rather than an afterthought. A USSD fallback already designed for
no-data conditions. A local registered entity, and NDPA registration in
process. Copyable in principle, but it takes years and local presence.

### Real but weakly defensible

**3. Zero hardware, zero site installation, instant deployment.** Copyable by
any software competitor. Not copyable by a hardware vendor, which is why it is
a partnership advantage rather than a moat.

### NOT a differentiator, despite feeling like one

**4. The hash chain.** A competent team builds a canonical payload and a hash
chain in about a month. The engineering here is good and the reasoning in
ADR-009 is worth preserving, but **the mechanism is not the advantage.** What
is defensible is who holds the record, not how it is hashed.

This distinction should be stated in any investor or partner conversation
before someone builds a strategy on the wrong half of it.

**Also not differentiators:** continuous location tracking, an SOS button,
multi-channel notification. All are available free or commodity.

## 3. Who actually pays for a record

This follows directly from section 2 and it is the load-bearing commercial
conclusion of this document.

**Consumers want rescue. Institutions want proof.**

OPA cannot provide rescue. It has no vehicles, no responders, no dispatch, and
the staff guide correctly tells users to call the emergency number first. OPA
can provide proof, and proof is what an institution with liability exposure is
obliged to obtain.

**Therefore the differentiator only monetises in the institutional channel.**
Selling a phone safety app to consumers puts OPA against a free pre-installed
feature. Selling an evidentiary record to an organisation with a duty of care
does not, because Apple does not sell an audit trail to a hotel chain.

Plausible buyers, in rough order of how directly a record maps to their
existing obligations:

- Employers with lone or mobile workers: field staff, drivers, engineers,
  outreach workers
- Hospitals and clinics with staff safety obligations
- Hotels, where several jurisdictions already mandate staff panic devices
- Schools and universities
- NGOs and development organisations with duty of care to field personnel
- Banks and retail with cash-handling exposure
- Insurers, who benefit from cheaper and more reliable claim assessment and
  who can mandate rather than merely buy

**The insurer channel deserves separate examination.** An insurer is the one
buyer who might require the record as a condition of cover, which converts OPA
from a purchase into a requirement. This is a hypothesis, not a plan, and it
needs validation with an actual underwriter before any roadmap depends on it.

### Packaging implication

If the record is the product, the app is distribution rather than the thing
sold. That suggests: free or low-cost app, paid attested record and report,
priced per protected person or per incident. **The marginal cost of a record is
near zero and its value is highest exactly when an incident occurred**, which
is an unusual and favourable pricing position.

This also aligns with partnership: partners supply volume and response, OPA
monetises attestation. Recorded here as a direction to test, not a decision.

## 4. The inclusion test - what fits into OPA

A reusable filter, so future feature proposals can be sorted without
re-litigating strategy each time. Apply in order.

| Question | If yes |
|---|---|
| Does it strengthen, attest or deliver the record? | **CORE.** This is the product. |
| Does it reduce how often the record is cut short? | **CORE.** See silent activation, section 11. |
| Does it require hardware or installation at a site? | **PARTNER.** Beacons, pendants, desk buttons, badges. |
| Does it require humans physically responding? | **PARTNER.** Dispatch, vehicles, medical response. |
| Does it duplicate a capability the phone already has? | **REJECT.** Voice calling, carrier selection. |
| Does it require being present at the emergency? | **PARTNER.** OPA is never present. |

Worked examples:

- Persistent offline queue: strengthens the record. **CORE.**
- Timeline hash chain: attests the record. **CORE**, and currently the largest
  gap in it.
- Attested incident report: delivers the record. **CORE**, and it is the
  sellable artifact.
- Silent activation: reduces how often the record is cut short. **CORE.**
- Background capture: same. **CORE**, and larger than it looks.
- Indoor room-level positioning: needs beacons in a building. **PARTNER**, and
  blocked on a data-model decision regardless.
- Two-way voice: the phone already does this. **REJECT** as a platform goal.
- Multi-carrier SIM: the phone and carrier own this. **REJECT.**
- Dispatch and responder assignment: requires humans responding. **PARTNER**,
  and see the fork in section 10.

## 5. The device-dark problem, stated precisely

If a phone has location disabled, is in airplane mode, is force-killed or is
powered off, no software safety app can transmit from it. This is an operating
system and physics limit, not an OPA engineering gap, and it applies equally to
every phone-based competitor and to the OS vendors own features. Call-back and
live tracking both stop for the same reason.

**Being honest about this is a commercial asset, not a weakness to hide.** An
institutional buyer comparing vendors will find the limit anyway. The vendor
who named it first is the one they trust on everything else.

### The four states behave differently, and one of them is recoverable

| State | Capture | Transmit | Trail outcome |
|---|---|---|---|
| Location permission revoked | no | yes | ends |
| **Airplane mode** | **yes - GNSS is receive-only** | no | **delayed, not lost** |
| App force-killed | no | no | ends |
| Powered off | no | no | ends |

**Airplane mode is materially different and it is the case item 9c changes.**
GNSS reception does not require a network. A phone in airplane mode continues
to produce position fixes. If the queue is durable, every fix captured during
the dark period flushes when connectivity returns.

Today the queue is in memory only and dies with the process, so this is lost.
With durable persistence the claim becomes: *here is where the phone travelled
during the two hours it appeared to be dark.* That is qualitatively stronger
than a last-known location, and it is exactly what item 10 airplane-mode test
exercises.

**It depends on background capture**, because the app must survive being
backgrounded to keep capturing. Foreground-only capture means this only works
while the screen is held, which in the relevant scenario it will not be.

### What is honestly preserved in the unrecoverable cases

- **A trail, not a snapshot.** Sprint 10B produces continuous fixes at a
  verified 10 second cadence, so the record shows a route and a time of last
  contact rather than a single activation point.
- **Origin coordinates are immutable** (ADR-005). A retrigger never overwrites
  where the incident began. Real forensic value.
- **The chain is tamper-evident**, so the trail can be attested rather than
  merely asserted.

### The gap: going dark is not currently an attested event

The SILENT state is derived at read time from the age of the newest fix. It is
**not a persisted, hash-chained event.** So "the device went dark at 14:53:50"
is presently an inference from absence rather than an attested fact in the
record.

Making it attestable means IncidentTimelineEvent, which today has no hash chain
and an unguarded sequence race. **The device-dark scenario is the strongest
single argument for fixing that**, and it is the argument an insurer or a
partner would care about most. Roughly 2 to 3 hours of work.

## 6. The partner product: a neutral evidentiary layer

Working name: **OPA Record**. Name not decided.

**Positioning:** OPA is not a panic system that partners with response
operators. It is the evidentiary layer that response operators and hardware
vendors both write into, and that neither can credibly produce about
themselves.

Three integration surfaces. They are independent and can ship separately.

### Surface A - Alert egress to a response operator

A partner operations centre receives the incident and a scoped live-tracking
credential, and works it with their own dispatch.

What it needs:
- **AUTHORIZED_RESPONDER token scope.** Already the reserved name in ADR-008.
  Anticipated, not built.
- **An outbound partner channel on the existing outbox.** The outbox pattern
  (ADR-001 to 003) already exists; this is a new channel type rather than new
  infrastructure.
- **Partner acknowledgement.** NotificationStatus.ACKNOWLEDGED exists and
  nothing sets it. **This becomes load-bearing**: without it, no service-level
  claim about partner response time is provable, which removes most of the
  value of a neutral record in the partnership case.

What it explicitly does NOT need: OPA notification of the partner end users,
OPA dispatch, or OPA vehicles. A response operator has all of that and will not
accept a substitute.

### Surface B - Device fix ingestion from a hardware vendor

A vendor pendant, badge or desk button posts activations and location fixes
into the chain. The vendor keeps the hardware relationship; OPA supplies the
record.

This is the surface that closes OPA structural gaps by partnership rather than
by engineering: indoor beacon detection, two-way audio, smart SIM roaming,
multi-year battery, tamper detection. **None of those are things OPA should
build.**

**BLOCKED - see section 9.** The wire contract rejects any source value outside
foreground, background and manual, and rejection is per request, so one
device-sourced fix fails an entire batch.

### Surface C - The attested report

The sellable artifact. On incident resolution, a report containing the fix
trail, the timeline, the chain verification result, notification and
acknowledgement history, and an explicit statement of any dark period.

This is product idea 6 in TODO.md. **Blocked on the timeline chain** for the
events half. Location alone is attestable today; events are not.

**This is what an institution buys.** Surfaces A and B are plumbing that make
C credible and give it volume.

## 7. Partner archetypes and what each actually wants

| Archetype | Has | Wants from OPA | Surface |
|---|---|---|---|
| Response operator | Dispatch, vehicles, command centre, government relationships, brand | Inbound alerts, live location, a handoff-quality audit trail, provable acknowledgement | A |
| Hardware vendor | Devices, beacons, smart SIM, two-way audio, battery life | A backend that turns a button press into an evidentiary record | B |
| Institutional buyer | A compliance or duty-of-care obligation, and a budget | The report, and coverage across both phone and device users | C |

The institutional buyer is who both partners already sell to. **They are the
one who pays, and the record is the only line item on this list that is not
already commoditised.**

One asymmetry to plan around: **a response operator has no incentive to pay for
a record and every incentive to want it free**, because a neutral record is
partly a check on them. Expect Surface A to be revenue-neutral or a cost of
distribution, monetised through C.

## 8. Current state against what this needs

| Requirement | State |
|---|---|
| Responder token scope | Reserved name only (ADR-008). Not built. |
| Outbound partner channel | Outbox exists. New channel type needed. |
| Partner acknowledgement | ACKNOWLEDGED exists, nothing sets it. |
| Device fix ingestion | **BLOCKED.** See 9.1. |
| Partner authentication | Does not exist. Auth is user-scoped JWT only. |
| Partner rate limiting and quotas | Does not exist. |
| Published, versioned API contract | Swagger exists, **ungated and unauthenticated**. |
| Attested report | Blocked on the timeline chain. |
| Indoor context on a fix | Blocked on a data-model ADR. |
| Attested dark-period event | Blocked on the timeline chain. |
| **A deployable API** | **Does not boot. See 9.2.** |

## 9. The two hard blockers

### 9.1 The source enum, and the canonical payload question behind it

JourneyFixDto constrains source to foreground, background and manual, and
global validation rejects unknown fields for the whole request. A partner
device sending anything else fails the entire batch.

Widening the enum looks like a one-line change. **It may not be.**

**Verify before designing:** whether source is one of the seven keys
canonical-fix.ts serialises. If it is, every stored fix payloadHash is computed
over the closed set, and widening it requires a payload version field and a
versioned verifier - neither of which exists. The verifier is the artifact an
insurer or a court would rely on, so it cannot change casually.

**This is the same shape of problem as the proposed indoor fields**, and it
suggests one ADR covering both: how the canonical payload evolves without
invalidating what is already stored. That ADR is a prerequisite for both indoor
positioning and hardware partnership.

Note also that the service-layer source type already includes activation and
retrigger, which the wire contract deliberately rejects. **There is precedent
for server-only source values**, and a device source might follow that pattern
rather than widening the client-facing enum.

### 9.2 There is no working production API

The provider confidence validator refuses to boot while intelligence providers
return mock data. The Azure environment has no override and must not be given
one. There is no infrastructure-as-code and no committed record of what
production is configured to run.

**You cannot sell an integration against an API that will not start.**
Everything in this document is downstream of this.

The cheapest next step is a read rather than a design: response-level omission
of the intelligence block already exists and already works, but the validator is
a boot-time gate on provider confidence rather than a response-shape gate, so it
is not obvious that omission satisfies it.

### 9.3 Swagger stops being a latent issue and becomes a design question

A partner-facing API means publishing a contract deliberately, to authenticated
partners, and versioning it. Gating Swagger and treating the gated version as
the partner contract addresses the current exposure and the website
hand-mirrored types drift at the same time.

## 10. The fork: Command Center or partnership

**These are substantially mutually exclusive and the decision is being made by
drift.**

If OPA builds dispatch and responder assignment, a response operator is a
competitor and will not integrate. If OPA is the neutral record layer, Command
Center is a product it should not build, because building it forfeits the
independence that section 2 identifies as the only defensible advantage.

The commercial roadmap makes Command Center MVP a Release 1 item, and its
engineering gates are already satisfied. **So the cheap path and the
differentiated path point in opposite directions.** That is exactly the
situation in which a decision gets made accidentally.

**A middle position exists and needs to be a stated boundary rather than a
drift:** build Command Center as a thin viewer for OPA direct customers -
incident list, live map, report retrieval - and never as dispatch, assignment,
or responder management. That keeps an internally useful tool without stepping
onto partner ground.

Without an explicit boundary, a viewer becomes a console, and a console becomes
a competitor.

**This is a founder decision. It should be recorded in the decision log either
way, including if the answer is to build Command Center fully and not pursue
response-operator partnership.**

## 11. Silent activation - status and the unasked design question

Silent activation is the one genuine software-only mitigation for the
device-dark scenario. It does not fix a physical problem; it reduces how often
the worst case is reached, because an activation that does not announce itself
is less likely to be noticed and shut down before the alert has gone out.

By the inclusion test in section 4 it is **CORE**: it reduces how often the
record is cut short.

**Precise current status, because "already a product requirement" covers a lot
of ground:**

- **Backend: ready.** Trigger types exist. A TriggerMode import is currently
  unused and is the only remaining production lint finding, which is arguably a
  hint that the mode path is under-wired rather than merely untidy.
- **App: not silent.** Five second visible countdown, full-screen state
  changes, a large button.
- **The actual silent mechanism is product idea 5**: a hardware trigger such as
  a triple power press or a held volume-down. Already ranked before voice, and
  correctly: most of the benefit of a wake word, no microphone, no app-store
  risk, and no NDPA audio question.

**The design question nobody has asked: if activation is silent, how does the
user know it worked?** Screen confirmation defeats the purpose. A single
discreet haptic is the likely answer. **Decide this before building the
feature**, because it determines whether the feature is trustworthy in the
moment it matters.

Related: silent activation makes the current activation-screen defect - a count
of zero contacts displayed while notifications are being dispatched - less
visible but more dangerous. A user who cannot look at the screen has no
confirmation channel at all, so the confirmation signal must be correct before
silence is offered.

## 12. Sequencing

Each step is either already owed or unlocks something specific. Nothing here is
speculative build-ahead.

1. **Finish Sprint 10B.** Durable queue, then the end-to-end test. The durable
   queue is what makes the airplane-mode trail real, which is the strongest
   honest answer to the device-dark objection.
2. **Make the API deployable.** Everything else is downstream.
3. **Timeline hash chain and its sequence race.** Unlocks the attested report,
   the attested dark-period event, and evidence references. This is the highest
   value small task in the project and it is the one an insurer would ask about.
4. **Helper and partner acknowledgement.** Makes any response-time claim
   provable. Also fixes the activation-screen count.
5. **The canonical payload evolution ADR.** Prerequisite for both hardware
   ingestion and indoor positioning. Cheap to decide, expensive to get wrong.
6. **Silent activation via hardware trigger**, with the confirmation-signal
   question decided first.
7. **Take the Command Center fork explicitly.**
8. **Surface A**, if the fork points at partnership. Partner auth, responder
   scope, outbound channel, gated contract.
9. **Background capture.** The real remaining gap. Needs native build work.
10. **Surface B and indoor**, as customer-funded or partner-funded work, after
    the payload ADR.

## 13. Decisions this document calls for

None are taken here.

- **Command Center or neutral record layer.** Founder decision. Section 10.
  Record it either way. Currently being decided by drift.
- **Canonical payload evolution.** Versioned payload versus separate related
  records, for both device source values and indoor context. Section 9.1.
  Prerequisite for two roadmap items.
- **Whether the app is free and the record is paid.** Section 3.
- **Whether the insurer channel is pursued**, which needs validation with an
  underwriter before anything depends on it.
- **The silent-activation confirmation signal.** Section 11. Small, and
  blocking for a CORE feature.
- **Whether partner authentication is built or bought.**
- **Whether Swagger becomes the versioned partner contract.** Section 9.3.

## 14. Summary

OPA cannot win a consumer phone-safety market that already contains free
pre-installed OS features with better hardware access. It can win an
institutional market for independent evidence, because the parties who respond
to emergencies cannot credibly produce that evidence about themselves, and the
OS vendors are not selling audit trails to organisations with duty-of-care
obligations.

That points at a partnership product rather than a competing one: response
operators and hardware vendors write into a record OPA holds and attests, and
the institution that carries the liability pays for it.

The honest limits are unchanged and should be stated first in any conversation:
OPA does not rescue anyone, cannot transmit from a phone that has been shut
down, and does not know which room someone is in. What it can do is produce a
trail that stands up afterwards, and reduce how often that trail gets cut short.
