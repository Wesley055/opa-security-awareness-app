# Panic System Capability Assessment

**Date:** 29 July 2026
**Status:** Assessment. Not a decision record. Decisions it calls for are
listed at the end and belong in the decision log when taken.

This document assesses OPA against a market checklist of dedicated
panic-button system capabilities, and against an internal proposal for how OPA
might grow into them. It exists because both documents contain good material
and specific claims that conflict with decisions already taken here.

## 1. Provenance, and why it matters

The source checklist is vendor-authored. Its own title is a must-have list
paired with a claim that the vendor leads the industry. A vendor must-have
list is a description of that vendor product with the serial numbers filed
off. It is useful market intelligence. It is not a neutral standard.

It is also written for a different product category: dedicated hardware in
fixed facilities, with under-desk buttons, pendants, years-long battery life
and smart SIMs. Roughly half of it is not a gap OPA has. It is a gap OPA does
not share.

Read it as competitive positioning input, not as a requirements document.

## 2. Verified current state

Corrected against the codebase and the 29 July 2026 device run. Several rows
in the internal proposal were optimistic and one was pessimistic.

| Capability | Status |
|---|---|
| SOS activation, one touch | DONE. Device-verified, 201 from a real phone. |
| Accidental-press protection | DONE. 5 second countdown with cancel. |
| Continuous location after activation | DONE. Device-verified 29 July: 50 fixes, 10s cadence, stationary phone, recordedAt monotonic against sequence. |
| Tamper-evident location record | DONE. Hash-chained fixes, ADR-009. Multi-fix in-batch chaining proven on real data. |
| Shareable live status for helpers | DONE server-side. Tokenised link, 15s poll, SILENT after 120s. THE PAGE HAS NEVER BEEN RENDERED. |
| WhatsApp and SMS dispatch | DONE, live-confirmed repeatedly. |
| Email and push dispatch | UNCONFIRMED. Fired in parallel, never individually verified. |
| Incident timeline | HALF. IncidentTimelineEvent has NO hash chain and an unguarded sequence race. The audit-grade claim is half true and the unverified half is the half an insurer would ask about. |
| Offline queue | IN-MEMORY ONLY. Capped at 600 fixes, dies with the process. Not durable in any sense. Item 9c. |
| Battery and network status | SCHEMA ONLY. batteryLevel and isCharging are stored and hashed and never captured by the app. |
| Family alerts | DONE for FAMILY_BEARER. |
| Responder alerts | NOT BUILT. VERIFIED_CONTACT and AUTHORIZED_RESPONDER are reserved names in ADR-008, not implementations. |
| Helper acknowledgement | NOT BUILT. NotificationStatus.ACKNOWLEDGED exists and nothing sets it. |
| Voice trigger | DESK RESEARCH ONLY. A backend enum exists. Device testing outstanding, blocked on a custom dev build, and there is no eas.json. |
| Central dashboard / dispatch console | NOT BUILT. Command Center is a future release. |
| Two-way audio | NOT BUILT. |
| Indoor room-level location | NOT BUILT. |
| Multi-carrier smart-SIM roaming | NOT BUILT and not applicable to a phone app. See section 4. |
| Dedicated hardware | NOT BUILT. |
| Mass notification / facility lockdown | NOT BUILT. |
| Compliance to sector mandates | NOT ADDRESSED. |

### Corrections to the internal proposal

- Voice trigger is NOT "partially implemented". An enum is not an
  implementation. Claiming otherwise is how a marketing document ends up
  ahead of the product.
- The timeline is not "implemented at backend level" in the sense that
  matters. Location fixes are chained; events are not.
- The retry queue is not an offline queue. It survives a failed request. It
  does not survive the process.
- Continuous journey fixes are no longer "under runtime validation". They are
  verified. That row was too cautious.

## 3. The gap the checklist did not name, and it is the biggest one

**OPA is foreground-only.** Location capture runs while the app is open and on
screen. The background source value is unreachable in the current build, and
the queue dies with the process.

For the scenario the product exists for - a phone in a pocket, someone held
somewhere - this is a more serious limitation than any of the three the
checklist names. It is also the one a dedicated pendant genuinely beats us on,
and the checklist omits it because a pendant has no concept of foreground.

Item 9c gives persistence across process death. Background capture is separate
and larger: it needs native configuration in app.json and a custom dev build.

**This belongs at the top of any capability roadmap, above indoor positioning.**

## 4. The three named gaps, assessed

### 4.1 Two-way voice - mostly a category mismatch, with one good idea inside it

OPA runs on a phone. The phone is already a two-way voice device with priority
emergency routing on any carrier. The staff guide already tells users to call
112 first, and that is the correct answer rather than a missing feature.
Building a voice network into OPA means competing with the dialler.

**REJECTED: in-app VoIP between user and responder as a platform goal.**

**ACCEPTED IN PRINCIPLE: responder call-back with number masking.** A helper
or dispatcher sees the incident and presses Call User; a relay connects them
without exposing personal numbers. This is cheap, uses the phone network
rather than replacing it, and does not require a media server. It is the
right first step and the only one worth scoping now.

**REJECTED OUTRIGHT: any "silent listening mode".** The voice study settled
this: on-device keyword spotting, no cloud audio, OS microphone indicator
visible, and never imply hidden or silent listening. NDPA registration is in
process and awaiting completion, so the constraint here is timing rather than
permission - but a covert-audio capability is exactly the feature that would
complicate a review we are currently waiting on. It also contradicts the
privacy framing the product is being positioned with.

Call recording, if ever built, requires explicit consent capture and a
retention policy that does not yet exist. See open question 5.

### 4.2 Multi-carrier roaming - not applicable

A smart SIM matters when shipping a dedicated device on one network. OPA rides
the user existing phone and their existing Wi-Fi. Not better, not worse:
inapplicable. An app cannot force carrier selection, and should not pretend to.

The real analogue already exists in this repo as docs/future/ussd-fallback.md,
which addresses no-data conditions. That is the correct shape for this concern.

**DEFERRED, NOT REJECTED: a transport abstraction.** The proposal suggests an
EmergencyTransport interface with internet, SMS, WhatsApp, SIM and satellite
implementations. This is premature. There is one transport and one client, and
an SMS transport cannot carry a 200-fix batch or a canonical payload at all.
Build the interface when the second transport exists, not before.

### 4.3 Indoor location - real, and it CANNOT be added additively

This is the one genuine capability gap of the three.

A partial win already exists: the Android fused provider blends Wi-Fi and cell
positioning, so OPA is not "basic GPS". But room-level accuracy needs beacons
or Wi-Fi fingerprinting, which means infrastructure inside the customer
building. That is a per-site deployment, not an app feature.

**THE BLOCKING TECHNICAL FACT.** The internal proposal adds locationType,
buildingId, buildingName, floor, zone, room, nearestExit and positioningSources
to the location fix object.

canonical-fix.ts canonicalises exactly seven keys, all passed explicitly, with
delimiter assertions. Every stored fix has a payloadHash computed over that
shape, and the chain hash depends on it. Adding a field to the canonical
payload either breaks verification for every fix already stored, or requires a
payload version field and a versioned verifier that does not exist.

The verifier is the thing an insurer or a court would rely on. It cannot be
changed casually.

**Therefore indoor positioning requires an ADR before any code**, and the
likely answer is a separate related record rather than new fields on the
existing fix - so that indoor context can be attached to a fix without
entering the canonical payload, or enters it under an explicit version.

**Sequencing:** indoor positioning is an Enterprise-tier, customer-funded
pilot. It should not be built speculatively. One controlled facility, beacons
paid for by that facility, floor plans supplied by them.

## 5. Positioning guardrail

The internal proposal describes OPA as a "smartphone-based emergency
coordination platform".

**That phrase is rejected, and was rejected in three separate documents.** It
moves onto the ground of an incumbent that is already funded, already
government-partnered across several states, already has corporate clients, and
already runs a 24/7 command centre with thousands of managed emergencies. We
do not win a coordination comparison with them today.

The adopted language stands:

- Definition: emergency alerting with a verifiable location record
- Category: live incident awareness
- Differentiator: incident awareness and record
- One line: OPA is a live incident awareness platform that produces a
  verifiable record

**Note what the vendor checklist does NOT contain: any requirement for a
verifiable record of where someone was.** Every item on it concerns alerting
and dispatch. That absence is the argument for the current positioning, and it
is evidence the category leaders are not standing on this ground.

A roadmap whose next three moves are command centre, dispatch and two-way
voice is a roadmap that abandons the one differentiator we have.

## 6. Product decomposition - accepted with two corrections

The proposal splits capability across Core, SafeWalk, Guardian, Enterprise,
Command Center and a hardware line. The split is sound and the placement of
indoor positioning under Enterprise and dispatch under Command Center is
correct.

Two corrections:

**Guardian must not be given a product specification yet.** Guardian was never
defined anywhere in this project. That is precisely why the Guardian journey
purpose is excluded from the client-facing purpose list and annotated as such
in ADR-009. Writing a feature list for it now creates the appearance of a
defined product where none exists.

**Journey Intelligence must not be dropped.** The proposal omits it entirely
while giving Guardian a full spec. That is exactly backwards: Journey
Intelligence has a 2592-line architecture document, and Guardian has nothing.
One of those is a product with a design. Note also that the architecture
document has never been opened in any working session, so our knowledge of it
is second-hand.

**A hardware line is plausible but must be partnership-first.** Manufacturing,
certification, inventory, telecom contracts and replacement logistics are each
larger than the current engineering effort. The proposal says this and is
right to.

## 7. Sequencing - where this disagrees with the proposal

The proposal places an Enterprise indoor pilot third and Command Center
fourth. Two facts change that order.

**Command Center gates are already satisfied.** Dispatch hardening is complete
and the incident portal is built. SafeWalk, by contrast, needs 10B plus
missed-check-in escalation, which is silence detection, which is deferred.

**Every path here runs through a production API that does not currently boot.**
The provider confidence validator refuses to start while intelligence
providers return mock data, the Azure environment has no override, and the next
production deploy will fail closed. There is no infrastructure-as-code and no
committed record of what production is configured to run.

An enterprise pilot roadmap that does not mention this is planning on sand.

**Recommended order:**

1. Finish Sprint 10B. Persistent queue, then the end-to-end test.
2. Make the API deployable. This is the single highest-leverage unknown in the
   project and its next step is a read, not a design: response-level omission
   of the intelligence block already exists and already works, but the
   validator is a boot-time gate on provider confidence rather than a
   response-shape gate, so it is not obvious that omission satisfies it.
3. Close the two integrity gaps that block the record claim: the timeline hash
   chain and its sequence race, and helper acknowledgement.
4. Responder call-back with number masking. Cheap, and it is the honest
   version of "two-way".
5. Command Center, whose gates are already met.
6. Background capture. This is the real gap, and it needs native build work.
7. Indoor positioning, as a customer-funded pilot, after its ADR.
8. Hardware, via partnership, if at all.

## 8. Two things to fix before any of this is shown to a buyer

**The activation screen reports "0 contacts" while notifications are being
dispatched.** Activation returns before the outbox worker runs, so the count is
computed before any notification exists. On 29 July it displayed zero while
four WhatsApp messages went out two seconds later. The vendor checklist leads
with instant notification; we would be demonstrating the thing we already do
well while the interface denies it.

**Swagger is published unauthenticated on every deployed instance.** Full API
surface, no environment gate, no auth. For a confidentiality-first
institutional reviewer this is plausibly the first thing found.

## 9. Decisions this assessment calls for

None of these are taken here. Each belongs in the decision log when taken.

- **Indoor location data model.** Separate record versus versioned canonical
  payload. Blocking for any indoor work. Highest priority of this list.
- **Whether responder call-back is in scope before Command Center**, and
  whether number masking is built or bought.
- **Retention and consent policy**, which the recording question depends on and
  which NDPA completion will constrain.
- **Whether a transport abstraction is wanted at all**, revisited when a second
  transport actually exists.
- **Command Center or SafeWalk first.** Engineering reality favours Command
  Center; this remains a founder decision.

## 10. Summary

OPA today does emergency activation, continuous verified location, multi-
channel alerting, and a tamper-evident location record, on hardware the user
already owns, with no site installation.

It does not do indoor room-level positioning, two-way audio, dispatch
coordination, background capture, or hardware.

The honest comparison to a dedicated panic-button system is that OPA wins on
deployment cost, speed of adoption and evidentiary quality, is inapplicable on
carrier roaming and voice, and genuinely loses on indoor precision, background
operation and battery life. A briefing that concedes the third category is far
more credible to an institutional buyer than one that does not.
