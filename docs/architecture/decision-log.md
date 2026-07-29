# OPA Architecture Decision Log

Decisions that shaped the system, why they were made, and what was rejected.
Newest first. Written so that six months from now the reasoning survives,
not just the outcome.

---

## ADR-011 - Tracker capture policy: cached replay, stationary silence,
and the two clocks
**Date:** 29 July 2026
**Status:** Decided and implemented - d5aca8b, verified on device.

ADR-010 deferred this: to be recorded when the work lands, the two defects
found on the first device run of item 9b, if the fixes for them were kept.
They were kept, verified and committed.

### The two defects

The first device run of the fix sender produced a working sender and two
behavioural defects that `tsc --noEmit` could not see. `apps/mobile-app`
has no test framework, so the device is the only gate, and this is the
clearest demonstration of that to date: `tsc` returned 0 on the defective
code and returned 0 again on the fix for it.

**Defect 1 - `recordedAt` ran backwards against `sequence`.**
`watchPositionAsync` delivers a cached last-known position on subscribe. The
tracker's first fix was therefore the same reading SOS had already acquired
during the countdown, carrying its original timestamp - captured 3.3 seconds
BEFORE the activation fix that precedes it in the chain. Chain integrity was
unaffected, because the chain orders by `receivedAt` and that is monotonic.
But the public envelope selects the newest fix by `receivedAt desc`, and that
fix held an OLDER `recordedAt` than the one before it, so the tracking page
could show "last seen" jumping backwards the moment tracking started.

**Defect 2 - `distanceInterval: 25` silenced a stationary phone.**
On Android it maps to `setSmallestDisplacement(25)`, which suppresses updates
entirely until the device physically moves 25 metres. A stationary phone got
the cached fix and then nothing: one fix, one flush, never another.

### Decision 1 - DISTANCE_INTERVAL_M is 0, permanently

`timeInterval` drives alone.

For a panic button, stationary is not an edge case - it is arguably the most
important case, because someone held in one place is precisely who needs a
location record. A displacement filter makes the tracker look like it is
working while it emits nothing, and the tracking page then reports SILENT
after 120 seconds while the app sits there running perfectly.

Do not reintroduce a displacement filter as a battery optimisation without
solving the stationary case first.

### Decision 2 - the pre-start guard compares recordedAt against a start
time captured before subscribe

`trackingStartedAtMs` is set immediately before `watchPositionAsync`, and
`enqueue()` drops any fix whose `recordedAt` precedes it. Nothing is lost:
the activation fix already holds that same position.

It is initialised to `0`, so the guard is INERT until a full start runs. That
was chosen for safety, and it turned out to be the property that made the
next problem diagnosable - see the closing section.

### Decision 3 - the drop-only-the-first-fix variant is REJECTED

It was considered, because a guard that drops everything older than start
could in principle drop every delivery if a provider re-delivers the same
cached object. Device evidence says it does not: across 50 fixes at
`distanceInterval: 0` on a stationary Android phone, every `recordedAt` was
distinct.

So the simple comparison suffices, and the first-fix-only variant would be
strictly worse - it would let a genuinely stale replay through on any
delivery after the first.

### Decision 4 - if re-delivery is ever observed, the fix is a monotonic
rule, not a first-fix exception

Recorded in advance, because the platform most likely to exhibit it - iOS -
has not been tested, and this reasoning should not have to be rediscovered
under time pressure.

    lastEnqueuedMs initialised to trackingStartedAtMs at start
    accept only if ms > lastEnqueuedMs

One rule, three behaviours: the pre-start cached fix is rejected because
`ms < startedAt`; a re-delivered identical object is rejected because
`ms === lastEnqueuedMs`; a genuine new reading passes.

And it fails HONESTLY. If the provider never yields a fresh reading, nothing
is sent and the page goes SILENT, which is true. The alternative fills the
chain with fixes carrying frozen timestamps, which looks healthy server-side
and lies to the person reading the page. Between a system that reports it has
lost contact and one that reports a position it knows is stale, the first is
the only defensible choice for this product.

It also gives `recordedAt` the same monotonicity `sequence` already has,
which is what defect 1 was really about.

Note the interaction with session reuse: `trackingStartedAtMs` is assigned
after `acquireSession()`, which is after a successful activation, so it is
always later than that activation's `recordedAt`. Initialising
`lastEnqueuedMs` to it therefore handles the reused-session case for free.

### Decision 5 - the guard must log the threshold, not just the rejection

`trackingStartedAtMs` is device wall-clock (`Date.now()`); `ms` is
`position.timestamp` from the platform location provider. **Those are two
clocks.** On Android they are normally both system time, so the cost of the
guard is losing a reading acquired in the few hundred milliseconds before
subscribe - trivial at a 10 second interval.

But if they ever diverge, the guard rejects EVERY fix, silently, and the
symptom is indistinguishable from a subscription that is not firing. The log
line must therefore carry both the rejected timestamp AND the threshold it
lost to, so that one console capture is self-diagnosing rather than merely
suggestive.

### What this ADR does not cover

- **The tracker's stop lifecycle.** ADR-010 Decision 3 specified when the
  tracker starts and never when it stops, other than logout. Nothing stops
  it on leaving the SOS screen, so `running` stays true and a second
  activation no-ops while keeping the first session. Observed twice. It is a
  real defect and it needs its own decision.
- **The `receivedAt` tie-break.** Multi-fix batches share one `receivedAt`
  and the envelope ordering has no tie-break. Server-side, and it must be
  fixed before the offline buffer makes a 200-fix batch routine.
- **iOS.** Every device run to date has been Android. The negative-sentinel
  family that ADR-010 exists for is an iOS `CLLocation` behaviour, so the
  sanitiser remains unproven against the platform that motivated it.

### The general lesson, which cost a session

After both fixes were applied, two further activations produced ZERO
foreground fixes - worse than the one fix produced before them. The
conclusion recorded at the time was that the fixes had regressed the sender
and should not be committed.

That was wrong. The fixes had never EXECUTED. A fast refresh preserves module
state, so `running` was still true from the earlier run, `startTracking()`
early-returned, `trackingStartedAtMs` was never assigned, and the surviving
subscription still carried `distanceInterval: 25`. The phone ran the pre-fix
bundle throughout. Nothing was ever compared to anything.

Two facts settled it without spending a device run, both readable from
artifacts that already existed:

1. `trackingStartedAtMs` is initialised to `0`, so `ms < trackingStartedAtMs`
   can never be true until a full start assigns it. **The guard could not
   have dropped anything.** This alone turns two competing readings of one
   ambiguous situation into two opposite claims about the same diff.
2. `acquireSession()` sits BELOW the `if (running)` early return, so a full
   start always POSTs `/journey/sessions` and a no-op start never does. The
   API log already contained the answer: exactly one session POST, from the
   pre-fix run.

**When new code appears to have made things worse, prove it RAN before
concluding it is wrong.** The cheapest proof is usually a request, log line
or side effect that only the new path can produce.

This is the fourth instance in this project of a correct action condemned by
a wrong inference: a fix framed too narrowly around one field; a correct
write failing a wrong post-write assertion; a well-reasoned fix that looked
like a regression; and now a handover that recommended reverting a correct
commit. The pattern is not carelessness - each conclusion followed from the
evidence in view. What was missing each time was a check on the MECHANISM
rather than the outcome.

---

## ADR-010 - The negative-sentinel family, tracker lifecycle and 9b scope
**Date:** 29 July 2026
**Status:** Decided. Implementation pending - Sprint 10B item 9b (the
client sanitiser) and a separate commit on the SOS request DTO.
**Amended 29 July 2026:** the client sanitiser landed in `fa087a6` and the
two tracker corrections in `d5aca8b`, both verified on a real device. The
SOS request DTO commit is STILL outstanding, so Decision 1 is only half
discharged. Implementation outcomes and the decisions that followed from
them are recorded in ADR-011 above.

Four decisions taken before any code was written for item 9b, the mobile
fix sender. They are recorded first, deliberately: the reasoning is the
part that gets lost between sessions, and the outcome alone would invite a
later tidy-up that reverts it.

### The defect family

ADR-009 records the heading -1 sentinel and both of the contradictory rules
that govern it. It states them about `heading`. That framing was too narrow.

iOS CLLocation signals an invalid reading with a negative number rather
than null, and it does so on three fields:

- `course` is -1 whenever course is invalid, which INCLUDES a stationary
  device.
- `speed` is negative whenever speed is invalid; a stationary device is
  again the ordinary case.
- `horizontalAccuracy` is negative when the location itself is invalid.

Commit edec8c4 fixed `JourneyFixDto.heading` and stopped there, because the
reasoning was framed around one field rather than around "this platform
signals invalid readings with negative numbers". The correct frame would
have caught all three at once.

**The general rule, which outlives this ADR: when a platform uses a
sentinel value, audit every field sourced from that platform, not just the
field that prompted the discovery.**

One of the remaining gaps is not latent. `app/sos.tsx` line 181 already
sends `position.coords.accuracy` raw on the panic path. The `?? undefined`
there handles null, not a negative. A device returning a negative accuracy
on an invalid fix will 400 the SOS activation today.

### Decision 1 - fix at both boundaries, client first

The client sanitiser lands in 9b: one helper applied to `accuracy`, `speed`
and `heading` at the boundary, always, whatever the DTOs do. It is free,
immediate, and it protects the batch.

The API DTO fix is a SEPARATE commit, because a client-side sanitiser is
not a boundary. It protects exactly one client, and the moment a second
client exists the exposure returns. `create-incident-request.dto.ts` is the
boundary that outlives any one client.

Open question 14 - tightening the SOS DTO `timestamp` to `@IsISO8601()` -
rides along in that commit, since the file is open anyway.

### Decision 2 - the transforms are deliberately asymmetric

| Field | Rule |
|---|---|
| `heading` | exactly -1 maps to null |
| `speed` | any negative maps to null |
| `accuracy` | any negative maps to null |

**This asymmetry is intentional and must not be corrected into
consistency.**

`course` has a specific documented invalid sentinel, exactly -1, so
transforming exactly -1 preserves the ability to reject other negative
values as genuine garbage - which a control test already asserts for -20.

`speed` and `horizontalAccuracy` are documented by SIGN, not by a single
value. An exactly--1 transform copied onto them would look symmetric, would
pass a spec written against -1, and would still let -3 through to `@Min(0)`.
That is the same too-narrow framing that produced this ADR, repeated inside
its own fix.

The failure mode settles it. `forbidNonWhitelisted` is true and validation
is per request, so ONE negative field on ONE fix rejects an ENTIRE batch of
up to 200 fixes - it does not drop a single fix. The ordinary cause is a
phone sitting still, which is exactly what a buffered batch is full of.
Discarding a negative number that was never a measurement costs nothing.
Discarding 200 emergency location fixes is not comparable.

### Decision 3 - the tracker starts only after a successful SOS activation

Not on login. The app is foreground-only - there is no TaskManager and no
background location permission - so starting at login means watching
location for an entire session with no product behind it. SafeWalk is the
feature that would justify it, and SafeWalk is not built.

**This closes open question 25 as a side effect, and the reason matters
more than the closure.** A cancelled SOS never calls the API, so the
concern was that a cancelled trigger could strand an open session holding
tracked fixes with no incident attached. If the tracker only ever starts
AFTER a successful activation, that state is unreachable.

It becomes reachable again the moment a session can be started
independently of an SOS - which is exactly what SafeWalk requires.
**Reopen q25 when SafeWalk starts.**

### Decision 4 - no battery capture in 9b

`batteryLevel` and `isCharging` exist in both DTOs and are hashed into the
chain, and no client has ever sent them. Capturing them needs
`expo-battery`, a new dependency, and Expo Go bundling must be verified
before anything is built on it - the same constraint that governs the 9c
buffer dependency and Porcupine.

Deferred to 9c, where a dependency decision is being taken anyway. Nothing
displays the value today, so shipping it in 9b would add a dependency in
order to produce a field nobody reads.

### Rejected

- **Copying the exactly--1 transform from `heading` onto `speed` and
  `accuracy`.** Symmetric, and wrong for a sign-documented field.
- **Relying on the client sanitiser alone.** It is not a boundary.
- **Relying on the DTO transform alone.** The sanitiser is free and lands
  first; the DTO change is a separate commit with its own tests.
- **Starting the tracker at login.** Decision 3.
- **Adding `expo-battery` in 9b.** Decision 4.

### Not covered

Whether the DTOs should distinguish "absent because the reading was
invalid" from "absent because it was never captured". Both arrive as null.
Nothing reads the difference today.

---

## ADR-009 - Journey sessions, location fixes and the hash chain
**Date:** 28 July 2026
**Status:** Decided and largely implemented. Sprint 10B items 5-8 shipped;
mobile sender, end-to-end test and silence detection outstanding.

Sprint 10B turns a single activation coordinate into a continuous, verifiable
position stream. This records what was decided, what was deliberately NOT
built, and the reasoning that would otherwise be lost.

### The primitive

A `JourneySession` is the parent; `Incident.journeySessionId` is nullable and
`SetNull` on delete. An SOS raised during an open session ATTACHES to it
rather than creating a second. `purpose` is a tag only - nothing in 10B may
branch on it, which is what makes `JourneyPurpose.GUARDIAN` harmless despite
having no product behind it (two independent strategy documents confirm
Guardian was never defined). One active session per user, enforced by a
PARTIAL unique index over STARTED and ACTIVE.

That index is invisible to Prisma. A future `migrate dev` can silently emit
`DROP INDEX journey_session_one_active_per_user`. Every generated migration
must be grepped for it; `test/int/global-setup.ts` asserts its SEMANTICS, not
merely its existence, so ENDED being absent from the predicate is checked.

### Fixes are append-only, in RECEIPT order

The chain orders by `receivedAt`, not by `recordedAt`. It proves what the
server received and in what order. It does NOT prove where the person
actually was, nor that a device told the truth. Any external claim about the
timeline must respect that boundary.

`recordedAt` is the DEVICE clock and carries arbitrary skew. `receivedAt` is
the DATABASE clock, captured ONCE per transaction with
`SELECT date_trunc('milliseconds', now())`.

`date_trunc` is mandatory, not cosmetic. The column is `timestamp(3)` and
PostgreSQL ROUNDS on store, so an untruncated value would hash one way and
read back another. `canonicalTimestamp` will NOT catch this - it truncates
silently - so truncation at the source is the only guard. The integration
test that recomputes both digests from stored values is the mechanical
defence, and the only test that would catch `receivedAt` being left to the
column default.

### Three clocks, and why the page needs all of them

- `recordedAt` - device: when the position was captured. Surfaced as
  `location.capturedAt`.
- `receivedAt` - database: when the server stored it. Surfaced as
  `tracking.lastFixReceivedAt`.
- `serverTime` - database, at read: on the VALID envelope only.

Position age is `serverTime - capturedAt`. Silence is measured from
`lastFixReceivedAt`. They are deliberately different questions: a buffered
offline fix arriving late is FRESHLY RECEIVED but OLD. Collapsing them would
tell a family the position is current when it is not.

`serverTime` exists so the browser clock never enters the comparison. Both
operands are server values. Do NOT compute an age server-side and send it:
a derived number freezes at send time and goes stale on the page, which is
why `newestFixAgeSeconds` was rejected.

### Canonical serialisation

Two SIBLING modules, deliberately not merged: `canonical-fix.ts` builds the
payload preimage, `canonical-chain.ts` the chain preimage. They share
`CANONICAL_VERSION` and `NULL_TOKEN`, so bumping either format bumps both.
Domain separation is free: chain preimages open `v1|prev=`, payload
preimages `v1|nonce=`.

Rules: `Decimal(9,6)` at exactly 6 fractional digits for coordinates; 2 for
accuracy and speed; heading normalised to [0,360) at 1; timestamps UTC ISO
with exactly milliseconds; `sequence` plain base-10. One rounding mode
everywhere - ROUND_HALF_UP.

`Prisma.Decimal.set()` is NEVER called: it mutates shared global state.
`toFixed()` is banned - `new Decimal(1.005)` rounds to "1.01" where
`(1.005).toFixed(2)` is "1.00" in V8. A test asserts V8 behaviour so a future
Node change is detected rather than silently changing hashes.

Heading re-wraps AFTER rounding. `-0` is normalised twice. The canonicaliser
runs on READ as well as write, which is why the canonical string is never
stored alongside the values.

The delimiter assertions cannot fire today. That is the point. Do not delete
them for being unreachable.

### The heading -1 sentinel, stated together with range validation

These two rules contradict each other if only one is read, so both belong
here:

1. CANONICALISATION treats `-1` as the GPS "course invalid" sentinel and
   normalises it.
2. INGESTION VALIDATION enforces 0..360 and would REJECT `-1`.

On iOS, `CLLocation.course` is `-1` whenever course is invalid, WHICH
INCLUDES A STATIONARY DEVICE. A sender forwarding `course` straight through
would ship a panic button that fails validation for someone standing still.

Resolved at the DTO boundary: `@Transform` nulls `-1` before `@Min(0)` sees
it. `@IsOptional()` then skips a null. A genuinely out-of-range value such as
`-20` is still rejected, and a control test asserts exactly that - without it,
a transform that nulled everything would pass every other case.

### D1-D13, the decisions that shaped the service

- **D1** The payload envelope is signed off as-is.
- **D2** ONE shared private `insertFixes` owns the chain; every public method
  is a thin wrapper. Two implementations of the chain is the one duplication
  this design cannot afford.
- **D3** `receivedAt` from the database clock, truncated, captured once.
- **D4** The chain hash gets the same envelope discipline as the payload.
- **D5** In-batch idempotency dedupe runs BEFORE the database existence
  check. Unreachable until item 6 shipped, because every earlier caller
  passed exactly one fix.
- **D6** `resolveForActivation` takes the user lock defensively.
- **D7** `tx` is REQUIRED, with no injected fallback and no `PrismaService`.
  This diverges from house style on purpose: `pg_advisory_xact_lock` is
  transaction-scoped, so on a non-transactional client each statement is its
  own implicit transaction and the lock is released before the next runs. The
  code would look identical, raise nothing, and provide NO mutual exclusion.
  `JourneyIngestionService` exists to own the transaction so the session
  service does not have to.
- **D8** Genesis is `sequence = 0`.
- **D9** A fully idempotent replay does NOT advance `lastFixReceivedAt`,
  which is denormalised from the newest fix and would otherwise disagree with
  every row it derives from.
- **D10** Fixes are sorted by `recordedAt` before sequencing; the chain stays
  receipt-ordered.
- **D11** `recordedAt` falls back to the SERVER clock when the client
  timestamp is absent or unparseable. Availability over precision: the
  orchestrator's job is that the emergency gets created. This does NOT
  violate D3 - D3 binds `receivedAt`, which remains the database clock.
  Detection mirrors `canonicalTimestamp` and happens at the ORCHESTRATOR
  boundary, so the service only ever receives a Date.
- **D12** The wrappers were widened to carry accuracy, speed, heading,
  batteryLevel and isCharging immediately rather than later. Every fix
  created before a later change would permanently lose telemetry available
  at the time. Consequence: the same coordinates now produce a DIFFERENT
  payload preimage than before `e99cdb9`. Harmless - no production rows
  exist - but a genuine before/after.
- **D13** Free-text redaction gets a SIBLING helper, not an extended
  `redactSensitivePath`. See below.

### Ingestion is strict where the SOS path is forgiving

D11 trades precision for availability because an SOS must not fail on a
malformed client field. A tracked fix is not an emergency, so ingestion is
strict: `@IsISO8601()`, and a malformed value is rejected rather than
substituted. Garbage stays out of the chain.

Other boundary rules: the wire accepts only `foreground | background |
manual` - `activation` and `retrigger` are reserved for the SOS path.
An unknown session and a session owned by another user return the SAME 404,
so the response cannot confirm that an id is real. An ENDED session is 409.
`recordedAt` is bounded against ~5 minutes of future skew and against the
session start minus a grace window.

`forbidNonWhitelisted: true` is live globally. Every field on the wire needs
a decorated DTO property or the WHOLE request 400s - there is no silent
drop. This binds the ingestion DTO, the mobile sender, and every future
field addition.

### Advisory locks

Lifecycle uses the 1-arg `pg_advisory_xact_lock(hashtext(userId))`; ingestion
uses the 2-arg `(2, hashtext(sessionId))`. The two FORMS occupy separate lock
spaces - a 1-arg int8 key and a 2-arg (int4,int4) key never collide whatever
their values - so they are structurally independent, not merely namespaced by
the classid. `hashtext` returns int4, so two sessionIds can collide within a
form; that costs serialisation, never correctness.

The lifecycle lock is taken TWICE on the create path: once by the
orchestrator, once defensively by `resolveForActivation` (D6). It is
reentrant within a transaction, so this is correct - but state it, or it
reads as a bug.

`$executeRaw`, never `$queryRaw`: the function returns void and Prisma fails
to deserialize it.

### READ COMMITTED is a load-bearing dependency

The waiting transaction blocks on the lock, and after the holder commits it
must SEE the committed row when it re-reads the tail. Under RepeatableRead
the waiter's snapshot predates the commit, so it would hold the lock
correctly and still read a stale tail. Prisma inherits the database default,
so this works BY INHERITANCE RATHER THAN BY DECLARATION. Never pass
`isolationLevel: 'RepeatableRead'` or `'Serializable'` to these transactions.

### Testing concurrency

A badly written concurrency test passes whether or not the lock exists. Both
service locks were mutation-tested: removing each produced exactly one
failing test, named, with the other twenty passing. The control case - "does
not block a DIFFERENT session" - stays in the suite as the durable defence.

At service level the TIMING assertion is not the proof. Remove the ingestion
lock and the second transaction still blocks, on the unique index, then fails
with P2002. The mutation-sensitive assertions are the OUTCOME ones.

### Two redaction contracts (D13)

```
redactSensitivePath(originalUrl)        // structured path, prefix truncation
redactSensitiveTrackingUrls(value)      // free text, global substitution
```

Siblings, not one function. Path truncation and free-text substitution are
different operations, and callers stay explicit about which kind of input
they hold. NEVER pass a message or a stack to the path helper: it matches by
`startsWith` and would silently do nothing.

The trigger that made this necessary was NOT the tracking controller, which
never throws - it sets status codes and returns. It is Nest's own
unmatched-route 404, whose message contains the full URL and therefore so
does `Error.stack`. Redacting `path` alone would have closed the vector that
mostly does not fire and left open the one that does.

`redactSensitivePath` matches `/public/tracking/` by PREFIX. There is no
`setGlobalPrefix` today. If one is ever added, `SENSITIVE_PATH_PREFIXES` must
be revisited IN THE SAME COMMIT - the live URL would change while the spec,
which tests the pure function against hand-written paths, stayed green. The
free-text sibling is unanchored and survives this, which is why it was
written that way.

### The public envelope, and the omission principle

Fields OPA cannot populate honestly are OMITTED, never nulled: a null implies
the capability exists and is merely empty.

Applied here: the `tracking` block is ABSENT for any incident with no journey
session - every incident raised before Step 4. It is not reported as
`AWAITING_FIRST_FIX`, which would describe a session that does not exist. The
page renders exactly as it always did for those incidents, including the
sentence "It does not update", which remains true only there.

The four tracking states describe the SESSION, not the fix:
`AWAITING_FIRST_FIX | RECEIVING | SILENT | ENDED`. Staleness is deliberately
NOT a response state - it is a rendering judgement made from `serverTime`.
`SILENT` is not terminal: a device regaining signal must be able to bring the
page back to life.

`location.origin` is `ACTIVATION` for the immutable origin ADR-005 refuses to
overwrite, `TRACKED` once the position has moved on. A REDACTED fix has null
coordinates by design - that is the erasure mechanism - so it falls back to
the incident origin rather than overwriting the position with nulls.

The null token in canonicalisation deliberately diverges from the omission
principle: omission binds the WIRE DTO, not the hash preimage, where an
absent key and an explicit null must never take different paths.

### Silence threshold

`JOURNEY_SILENCE_SECONDS`, default 120. Invalid configuration THROWS rather
than falling back: a NaN threshold makes every comparison false, so every
active session would report SILENT - a false alarm on a page whose whole job
is telling a family the phone is still reporting. An empty string survives
`??` and `Number('')` is 0, which is finite, so `<= 0` is rejected too.

The page polls the SAME-ORIGIN bridge at `/api/tracking/<token>` every 15
seconds - eight polls inside the silence window. The browser never calls the
OPA API directly, so the API hostname stays out of client code and no
cross-origin request carries the token. Polling stops only on states terminal
for the capability token: INCIDENT_CLOSED, EXPIRED, REVOKED, NOT_FOUND.
UNAVAILABLE keeps polling - that is our infrastructure, not the incident.

### Framework rules that are easy to get wrong

- A DTO used with `@Body()` must be a VALUE import. `import type` erases the
  class from `design:paramtypes` and `ValidationPipe` then validates NOTHING,
  silently, with tests still green. Same for injected services and Nest DI.
  Type imports are correct for DTOs used only as types.
- `GlobalExceptionFilter` is registered via `useGlobalFilters` in `main.ts`,
  NOT as an `APP_FILTER` provider. Its spec must instantiate it directly with
  a mocked `ArgumentsHost`; a `Test.createTestingModule` harness would not
  exercise the registration and would pass with the filter absent.
- A spec that uses class-validator decorators without `@nestjs/testing` must
  `import 'reflect-metadata'` itself, or the whole suite dies at LOAD with
  "Reflect.getMetadata is not a function".
- `@IsUUID()` checks the VARIANT nibble. A plausible 8-4-4-4-12 hex string is
  not necessarily a valid UUID.
- ts-jest compiles only what the test graph reaches. A file nothing imports
  is invisible to `npm test` even when `tsc --noEmit` is green.

### Deliberately not built

Silence DETECTION. `endedReason` records why a session ended; nothing detects
that a session has gone quiet and escalates. Commercial consequence: SafeWalk
is gated on 10B PLUS this, not on 10B alone, because missed check-in
escalation IS silence detection.

Timestamp PROVENANCE is intentionally unrecorded. There is no clean column,
and `JourneyFixSource` is the wrong home: it is a capture-mode axis, not a
clock axis, and overloading it would retroactively make the existing five
ambiguous. Accept the gap; address it with a schema enhancement.

Also out of scope: ETA, arrival detection, route intelligence, risk scoring,
WebSockets, geofencing, `VERIFIED_CONTACT` and `AUTHORIZED_RESPONDER` tiers,
OTP re-issue, and location HISTORY access for tokens.

### What the chain does and does not cover

It covers `JourneyLocationFix`. It does NOT cover `IncidentTimelineEvent`,
which has no chain and whose `recordEvent` has an unguarded sequence race.
So an "audit-grade, hash-verified timeline" claim is currently true of WHERE
THE PERSON WAS and false of WHAT HAPPENED. `insertFixes` is the worked
solution to that exact race and is the model when it is fixed.

### Rejected

- `Float` coordinates - the schema uses `Decimal(9,6)`.
- Migrating accuracy/speed/heading to Decimal - canonicalisation instead.
- Storing the canonical string alongside the values.
- Extending `canonical-fix.ts` with the chain envelope.
- Extending `redactSensitivePath` to handle free text.
- `tx?` optional on `JourneySessionService` - see D7.
- `$queryRaw` for advisory locks.
- A timing-only concurrency test at service level.
- Per-worker schema isolation for tests - advisory lock keys are
  database-wide.
- `newestFixAgeSeconds` on the envelope - derived, and freezes on send.
- A full `retentionState` enum.
- Renaming RECEIVING to LIVE.
- A `Test.createTestingModule` harness for `GlobalExceptionFilter`.

### Open

- Late fixes after supersession: proposal is to accept into ENDED when
  `recordedAt < endedAt`, else reject as permanent.
- Whether redaction is itself recorded as an event.
- Retention policy proper; NDPC obligations are live post-CAC.
- Whether `redactSensitiveTrackingUrls` and `SENSITIVE_PATH_PREFIXES` should
  share a source - two lists, one concept.
- Whether the DTO should tighten `dto.timestamp` to `@IsISO8601()` on the SOS
  path too. D11 says validation is not the safeguard, but it is still worth
  doing as a separate change.

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
