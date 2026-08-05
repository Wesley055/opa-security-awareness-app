# OPA Architecture Decision Log

Decisions that shaped the system, why they were made, and what was rejected.
Newest first. Written so that six months from now the reasoning survives,
not just the outcome.

---

## ADR-016 - The readiness verdict covers current required capabilities: an optional dependency reports optional-down and does not fail the probe

**Status: Accepted. Implemented.**

### 1. Context

`/health/ready` returns HTTP 503 in production today, with a healthy API and a
healthy database. Measured 1 August 2026:

```
HTTP/1.1 503 Service Unavailable
Content-Type: application/json; charset=utf-8
X-Powered-By: Express
{"status":"degraded","database":"up","redis":"down","timestamp":"..."}
```

The response is Nest's, not Azure's - it carries `X-Powered-By: Express` and an
`x-correlation-id`, so it passed through `RequestLoggingMiddleware` and out of
`HealthController`. The chain is `health.service.ts:44`
(`allUp = database === 'up' && redis === 'up'`) -> `:47`
(`status: allUp ? 'ok' : 'degraded'`) -> `health.controller.ts:22-24`
(`status === 'ok' ? 200 : 503`).

Redis is unavailable by design. `REDIS_URL` in App Service is
`redis://placeholder:6379` - a syntactically valid Redis URL whose hostname is
intentionally unresolved while Redis-backed features remain deferred.
`docs/TODO.md:355-357` records that deferral explicitly, and `:370-375` records
that the work which would use Redis - the dispatch pass - is unstarted, with
`incidents.service.ts:32`'s `redisDispatchPrepared: true` named as a placeholder.

A sweep of `apps/api/src` (`scanned_ts=120`) found 38 Redis references. Twenty-
eight are Redis defining itself, two are the placeholder metadata flag and its
spec, one is the env schema, and the remainder are `health.service.ts`.
**`RedisService.getClient()` has no callers anywhere in the tree.** Redis backs
no production capability.

**There is no current App Service availability impact from this readiness
mismatch.** Azure App Service
Health check is enabled and its probe path is `/health`, which is pure liveness -
`getLiveness()` touches no dependency and carries `@HttpCode(HttpStatus.OK)`.
Unhealthy instance removal is configured with a ten-minute load-balancing
threshold. `/health/ready` still returns 503, and Redis continues to generate
reconnect noise in the log stream.

So this is not an outage. It is a semantic mismatch: Redis is optional in
behaviour and mandatory in the readiness calculation. The risk is that the
mismatch is invisible until the probe path changes, at which point Azure would
remove and replace a healthy instance on a permanent 503, presenting as an
application crash.

Two further observations shaped this decision.

**The route's Swagger summary is inconsistent with the implementation.**
`health.controller.ts:19` describes readiness in terms of database reachability,
while the service also makes Redis readiness-critical. This establishes an
inconsistency between prose and code, not what was originally intended - the same
defect class as the provider-validator comments corrected in `13d20fc`.

**A three-state reality is being flattened to a binary at the boundary.**
`ReadinessStatus` already distinguishes `ok` from `degraded` and reports each
dependency independently. The service reduces the dependency state to a binary
verdict, and the controller maps that verdict to HTTP 200 or 503.

### 2. Decision

**D1. Liveness and readiness remain separate routes with separate meanings.**
`/health` answers whether the process is running and must not touch a
dependency. `/health/ready` answers whether the application can serve its
**current required capabilities**. The readiness verdict is not a fold over every
reported dependency. The response may report optional infrastructure without
treating its absence as inability to serve required capabilities.

**D2. An optional dependency does not fail readiness.** A dependency that is not
part of the current required-dependency set is reported as unavailable without
forcing a non-ok status or a 503.

**D3. The reported vocabulary is widened to make optionality explicit.**

```ts
redis: 'up' | 'down' | 'optional-down';
```

- `up` - reachable.
- `down` - **required** and unavailable.
- `optional-down` - unavailable, and the application can still serve its current
  required capabilities.

The intended production shape today:

```json
{ "status": "ok", "database": "up", "redis": "optional-down", "timestamp": "..." }
```

And once Redis is required but unavailable:

```json
{ "status": "degraded", "database": "up", "redis": "down", "timestamp": "..." }
```

Widening the union rather than leaving readers to infer optionality from
`status: 'ok'` alongside `redis: 'down'` is deliberate. That inference is exactly
the ambiguity that produced this investigation, and reproducing it one level down
would be perverse. `/health/ready` has no known consumers, so this is the
cheapest moment the contract will ever be explicit.

**D4. Required-versus-optional is an explicit application policy. It is never
inferred from configuration.** In particular, optionality must not be derived
from whether `REDIS_URL` is set, absent, or well-formed. The current URL exists,
is valid, and is intentionally stubbed - configuration presence carries no
information about whether a capability depends on it.

The initial policy is declared in application code as a reviewed
required-dependency set. Redis is not in that set. It must not be controlled by
the mere presence of `REDIS_URL` or by an independently editable environment
toggle. A variable such as `REDIS_REQUIRED=false` would recreate exactly the
policy drift this decision exists to prevent, by making a reviewed architectural
statement editable from a portal blade.

**D5. Graduation is explicit and atomic.** Redis moves from `optional-down`
semantics to required `down` semantics **only in the same change set that
deploys a production capability whose correctness depends on it**. That change
set must include: provisioning, configuration, failure-path tests, the readiness
update, and operational verification. A dependency must not become required by
drift.

**D6. The Azure probe path is pinned to `/health`.** `/health/ready` must not be
used as the App Service health probe until every readiness-critical dependency is
provisioned and verified. Because the portal is migrating this setting ("Health
check is being moved to Configuration"), the pin is recorded in three places, not
one: this ADR, the deployment section of `docs/TODO.md`, and a permanent
production-operations runbook. A handover is not one of the three - handovers are
historical records and are superseded. The Azure setting should also be checked
during deployment verification.

### 3. Consequences

`/health/ready` returns 200 in production with Redis stubbed, and its body still
reports Redis as unavailable - the information is preserved, the verdict changes.

`ReadinessStatus.redis` becomes a three-value union. This is a contract change on
a public endpoint, taken now precisely because it is free now.

The readiness calculation gains a notion of which dependencies are required.
That list is a deliberate, reviewable statement rather than a fold over whatever
services happen to be injected.

`health.controller.ts:19`'s summary should be corrected to describe what the
route actually decides.

### 4. What this does not decide

**This ADR governs readiness only.** It does not decide how partial availability
is handled elsewhere in the system, and there are at least two other instances of
the same shape: `POST /journey/fixes` rejects a whole batch of up to 200 for one
bad fix (issue 17.22, and ADR-014 fixes one case of it), and
`emergency-intelligence.service.ts:50` orchestrates six providers under
`Promise.all`, which is fail-fast. Open question 40 already recommends one policy
for the ingestion family. Whether a single degradation policy should span all
three is left open deliberately - the enrichment half is blocked on Sprint 10C
and should not be decided at the same time as this.

### 5. Rejected

**Provisioning Azure Cache for Redis to satisfy the check.** Paying for a cache
so that a health endpoint stops complaining about a service nothing uses inverts
the reasoning. `docs/TODO.md:355-357` already defers provisioning until a feature
needs it, and that deferral is correct.

**Leaving `redis: 'up' | 'down'` and letting `status: 'ok'` imply optionality.**
Recreates the ambiguity this ADR exists to remove. Rejected under D3.

**Inferring optionality from configuration** - treating an unset or placeholder
`REDIS_URL` as "optional". Rejected under D4. It would also make the policy
silently reversible by an environment-variable edit.

**Removing Redis from the readiness body entirely.** The information is useful;
the verdict was the problem. Reporting a dependency and failing on it are
separable, and this ADR separates them.

**Removing `RedisService` and its module.** The dispatch pass is planned work
(`docs/TODO.md:370-375`), the foundation is committed at `44ff065`, and deleting
it would have to be undone. Redis is deferred, not abandoned.

**Pointing the Azure probe at `/health/ready` "because it is more thorough."**
Rejected under D6. With unhealthy instance removal configured at a ten-minute
threshold, a permanent 503 would cause Azure to replace a healthy container, and
it would present as an application crash.

### 6. Implementation notes

The implementation changes `health.service.ts` so that the required-dependency
set is explicit and `allUp` is computed over that set rather than over every
reported dependency. Redis continues to be probed and reported.

Tests should pin, at minimum: Redis optional and down yields `status: 'ok'`,
`redis: 'optional-down'`, and HTTP 200; **Redis marked required and unavailable
yields `status: 'degraded'`, `redis: 'down'`, and HTTP 503**; database down
yields `status: 'degraded'` and HTTP 503 regardless of Redis; and the
controller's status-code mapping is asserted separately from the service's
verdict, since the defect recorded here lived in the join between them.

The graduation case is listed even though Redis is optional today. Without it,
D3's three-state vocabulary is pinned by tests while D5's graduation behaviour
exists only as prose - and a policy that exists only in prose is vulnerable to
drifting away from implementation, which is exactly the inconsistency recorded in
section 1.

---

## ADR-014 - Session-state and temporal fix failures are classified per item and returned in the success envelope; request-level validation stays request-level

**Status: Accepted for the response envelope, the scope boundary and the
implementation staging. The interaction between reacquisition and
`START_GRACE_MS` is an OPEN QUESTION recorded in section 4 and is NOT decided
by this ADR. The client half is design-only and has no implementation until 9c
exists.**

### 1. Context

`journey-ingestion.service.ts` rejects a whole batch on a single bad item, in
two places and for two different reasons.

A session with status `ENDED` throws `ConflictException` before any fix is
examined, so a batch buffered across a supersession is discarded entirely -
including fixes captured while the session was still open. The temporal checks
throw `BadRequestException` from inside `.map()`, so one bad `recordedAt`
returns 400 for a batch of up to 200 otherwise-valid fixes.

Measured bounds: `MAX_FUTURE_SKEW_MS = 5 minutes` forward;
`floor = startedAt - START_GRACE_MS` with `START_GRACE_MS = 5 minutes` backward.

**Partial acceptance is not a new idea in this API.** `recordTrackedFixes`
already returns `skippedDuplicateInBatch` and `skippedAlreadyStored` - items not
inserted on a call that succeeded. The response already says "some of your batch
did not land"; it says it as anonymous counters no client can act on. This ADR
makes an existing partial-acceptance path addressable rather than introducing
one.

**The case that makes it urgent.** Under issue 17.13 the tracker never stops
when the user leaves the SOS screen, and `if (running) return` means a second
activation no-ops while keeping the first session's id. After a supersession the
client keeps capturing against the ended session, every fix with
`recordedAt >= endedAt`. Supersession happens when a new incident starts - which
is to say, during the emergency. Item 10's airplane-mode test is this scenario.

**Caveat on reachability.** Nothing in `journey-ingestion.service.ts`,
`journey-session.service.ts` or their specs sets `status = ENDED`. Whatever
writes it lies outside the journey module and is UNMEASURED. Live data supports
the same reading: the observed session is `ACTIVE` with a five-day-old
`lastFixReceivedAt` - it never ended, it stopped receiving. **This ADR therefore
governs a path whose frequency in production is unknown.** That does not change
the contract; it changes how urgently the ENDED branch should be prioritised
relative to 17.13, which is what keeps sessions open in the first place.

### 2. Scope

**ADR-014 changes only classifications occurring after the request has been
parsed and authenticated.**

| Layer | Example | Under ADR-014 |
|---|---|---|
| DTO / pipe validation | unparseable `recordedAt`, missing field | **unchanged** - request-level 400 |
| Session existence and ownership | unknown id, another user's session | **unchanged** - request-level 404 |
| Session *state* | session is `ENDED` | **per item** |
| Per-fix temporal | future skew, precedes session | **per item** |

**The 404 stays request-level as a security property, not a layering
preference.** The service comment and two pinned tests are explicit that an
unknown session and another user's session return the same 404, so the response
never confirms an id is real but owned by someone else. A per-item rejection
carrying `sessionId` would leak exactly that. Existence and ownership are never
expressed per item.

Structural invalidity is not classified per item because the DTO pipe rejects it
before `ingest()` is entered. Converting it would mean redesigning request
validation, which this ADR does not do.

### 3. The three classifications

Returned inside the success envelope, not thrown.

**3.1 Transient - future skew.**

```json
{ "idempotencyKey": "...", "code": "FIX_RECORDED_TOO_FAR_IN_FUTURE",
  "retryable": true, "retryAfter": "<recordedAt minus MAX_FUTURE_SKEW_MS>" }
```

`retryAfter = recordedAt - MAX_FUTURE_SKEW_MS` is the instant server time
catches up enough for the identical fix to become acceptable. The server
computes it because only the server knows its own clock; a client that guessed
would be reasoning from the very clock that is wrong. Client: keep, wait,
**resend unchanged**. A device clock ten minutes fast is a temporary
disagreement, and deleting on it converts disagreement into permanent location
loss.

**3.2 Permanent against this session - ENDED mismatch.**

```json
{ "idempotencyKey": "...", "code": "FIX_RECORDED_AFTER_SESSION_ENDED",
  "retryable": false, "resubmit": "reacquire",
  "endedAt": "...", "recordedAt": "..." }
```

Accepted when `recordedAt < endedAt`; rejected as above when
`recordedAt >= endedAt`. **`endedAt` is not currently selected** - the query
selects `id, userId, status, startedAt` only, and the implementation must widen
it. **A null `endedAt` on an `ENDED` session means reject-and-reacquire, never
accept**: the boundary is unknown, so no fix can be proven to precede it.

Client: reacquire, retag, resend - **subject to section 4.**

**3.3 Permanent against this session - precedes the session.**

```json
{ "idempotencyKey": "...", "code": "FIX_PRECEDES_SESSION", "retryable": false }
```

`recordedAt < startedAt - START_GRACE_MS`. Client: delete and record permanent
rejection - **subject to section 4.**

`retryable` and `resubmit` are independent. `retryable: false` states that
resending unchanged *against this session* will never succeed. It does not mean
discard.

### 4. OPEN ISSUE - reacquisition against the start floor

**This section records an unresolved interaction. Nothing in it is accepted by
this ADR, and section 3.3's delete instruction must not be implemented until it
is resolved.**

**Measured behaviour of reacquisition.** `resolveForActivation` takes the
lifecycle advisory lock, then `findFirst` for a session with status `STARTED` or
`ACTIVE` ordered by `startedAt` descending. **If one exists it is returned
unchanged.** Only when none exists is a new row created, with `startedAt`
defaulting to creation time. `startSession` surfaces both the resolved
`startedAt` and a `reused` flag.

**The collision.** A fix rejected under 3.2 is told to reacquire and resubmit.
If reacquisition yields a session whose `startedAt` is later than the oldest
buffered fix by more than `START_GRACE_MS`, that fix is then rejected under 3.3
and deleted. **The recovery path defined in 3.2 can walk its own fixes into the
permanent rejection defined in 3.3** - in the airplane-mode scenario item 10
exists to demonstrate.

**There is one condition, not two cases.** The question is always whether the
oldest buffered fix clears `resolvedSession.startedAt - START_GRACE_MS`. Reuse
of an existing open session makes that likely but does not guarantee it; a
newly created session makes it unlikely but not impossible. The grace window
absorbs write latency, not buffer duration. **Because `startSession` returns
`startedAt`, the client can evaluate this condition before resubmitting rather
than discovering it by rejection.**

**CANDIDATE IMPLEMENTATION, NOT ACCEPTED: validate retagged fixes against an
origin session echoed by the client.** The server would compute `floor` from the
origin session rather than the destination, preserving the check's meaning while
admitting legitimately buffered fixes.

**This is a change to the trust model and cannot be adopted without deciding
its invariants.** It introduces a second client-supplied session reference. At
minimum, undecided: whether origin may equal destination; whether origin may
itself be `ENDED`; whether origin may belong to a different incident or purpose;
how long an origin reference remains valid; whether ownership failure returns
the same 404 as section 2 (it must, for the same reason); and what replay
protection applies to a reference that authorises acceptance of otherwise
out-of-window data.

**A second constraint on any bypass.** `recordTrackedFixes` derives the chain
tail via `orderBy: { sequence: 'desc' }` and appends. Admitting historical fixes
into a session already holding newer ones gives them **higher sequence numbers
with older `recordedAt`** - the hash chain's order and time's order diverge. The
chain is a demonstrated capability; any mechanism that admits out-of-order
historical fixes must answer for it.

**Also recorded, and not to be defaulted into:** permanent loss of
outside-window buffered fixes may be the *correct* outcome for a session that
ended with nothing succeeding it - the ordinary end-of-journey case. It is
acceptable as a decision and unacceptable as an accident.

### 5. The queue rule

**This records the intended queue contract for 9c, so the rule is decided in
advance rather than invented during implementation. Portions that depend on the
unresolved interaction in section 4 are not yet implementable, and are marked
below.**

```
2xx accepted                             -> delete
retryable=true with retryAfter           -> keep, retry at retryAfter, unchanged
retryable=false, resubmit=reacquire      -> RE-TAG and resend, do NOT delete
                                            [DEFERRED - section 4]
retryable=false, no resubmit path        -> delete, record permanent rejection
                                            [DEFERRED where the classification
                                             is FIX_PRECEDES_SESSION - section 4]
network / 408 / 429 / 5xx                -> keep
anything ambiguous                       -> keep
```

**Classification may legitimately change between attempts.** A fix held under
`FIX_RECORDED_TOO_FAR_IN_FUTURE` whose session ends before `retryAfter` arrives
reclassifies on retry as `FIX_RECORDED_AFTER_SESSION_ENDED`. The client re-reads
the classification on every response and never caches a verdict against a queued
item.

**Retention ceiling.** An absolute queue-age ceiling applies to every retained
item regardless of classification: before it, keep and retry; at it, delete and
record permanent expiry. **The value is not decided here.** Two constraints bound
it: `MAX_QUEUED_FIXES = 600` at the verified 10-second cadence is roughly 100
minutes of continuous capture, so depth is already bounded independently; and a
ceiling shorter than a plausible offline window defeats 9c's purpose. It is
recorded as an explicit parameter so it cannot be set implicitly by an eviction
policy written later.

### 6. In-order flush

**9c preserves oldest-first flushing as an explicit invariant.** `893d65a`
orders by `receivedAt DESC, sequence DESC`, correct **only** because the tracker
flushes in capture order. If 9c retried an old batch after newer ones succeeded,
the newest `receivedAt` would carry the oldest `recordedAt` and the tracking page
would present a stale position as current - on the page a family member reads
during an emergency.

**Consequence, recorded so it is not mistaken for a defect.** A fix held under
`retryAfter` at the head of the queue holds the items behind it. With a
uniformly fast device clock every fix is skewed alike, so the stream self-heals
into a steady state running late by up to five minutes and correctly ordered.
During that window the page renders SILENT, indistinguishable from signal loss.

**Rejected: skip the held item and flush past it.** It breaks in-order flushing
and forces the latest-fix query off `receivedAt` onto `recordedAt` - trading a
bounded, self-correcting delay for a silent ordering hazard in the query that
drives the live page.

### 7. Implementation staging

The controller is a pass-through returning the service result unwrapped, so the
`ingest()` return type **is** the public contract.

**Naming, decided.** `InsertFixesResult` is returned by `recordTrackedFixes`,
which is also reached from `recordActivationFix` and the retrigger path. It is
**not renamed** and its shape is unchanged. A new `IngestFixesResult` is
introduced on the `ingest()` path only, carrying `accepted[]`, `rejected[]` and
the existing `InsertFixesResult` counters. Phase A is therefore purely additive
and touches no caller outside `ingest()`.

**Phase A - type only.** Introduce `IngestFixesResult`. Behaviour unchanged.
Invisible to clients.

**Phase B - partition in `ingest()`.** The temporal checks live in `ingest()`'s
`.map()`, and `recordTrackedFixes` never sees a `recordedAt` violation.
Partitioning therefore happens in `ingest()`, which passes only surviving fixes
down; `recordTrackedFixes` is unchanged and keeps its dedup counters. The two
partitions merge in the envelope. Invisible to clients.

**Phase C - return the envelope, stop throwing.** The coupled change. Today the
client deletes on 2xx, so a half-rejected batch returning 2xx reads as complete
success and rejected items are discarded unretried - worse than the whole-batch
rejection being replaced. **Phase C lands with the client or after it. There is
no safe ordering in which the server goes first.** Phases A and B being
independently safe does not make C safe.

**`tailSequence` and `tailHash` describe the accepted subset only**, not the
submitted batch. Correct under partitioning but no longer obvious from the field
names, and stated so a later reader does not assume the tail covers everything
sent.

### 8. Required test coverage

Three pinned tests assert thrown exceptions and will not survive Phase C:
`409s an ended session`, `rejects a fix from too far in the future`, and
`rejects a fix from before the session started`. The 404 pair and the
`accepts a fix at the current time` control remain valid unchanged.

**Legacy expectations are not edited in place.** A second `describe('ADR-014')`
block is added, made green first, and only then are superseded assertions
removed - the discipline CI run #83 established. The suite baseline moves
deliberately, and that is recorded in the handover so a later session does not
read it as a regression.

**None of the following are covered today, and all are behaviours this ADR
defines. 9c is not complete without them:**

1. A fix at `startedAt - START_GRACE_MS ± epsilon`. The existing test uses an
   hour-old fix against a five-minute floor and passes on a 55-minute margin, so
   it proves nothing about the boundary.
2. A batch spanning `endedAt` - some fixes accepted, some rejected, in one
   response.
3. Reconnect resolving to an existing `ACTIVE` successor.
4. Reconnect creating a new session, with buffered fixes older than its floor.
5. Retag-and-resubmit end to end, which is the path section 4 leaves open.

### 9. Consequences

**In favour.** This ADR establishes the contract under which a batch spanning a
supersession can deliver what was captured before the session ended. One bad
timestamp no longer discards up to 200 good fixes. 9c is written against a
recorded delete rule with its deferred portion named, rather than against no
rule at all. q40 is closed at a boundary the code already has.

**Against.** The response body becomes structured and both sides must parse it.
A held skewed item delays the fixes behind it (section 6). The mobile queue
remains in memory and dies with the process until 9c lands, so **the client half
of this contract is foreground-only and non-durable in the interim** - any
external claim about buffered tracking must say so. Section 4 remains open, so
the reacquire path is specified but not yet safe to complete.

**Not addressed here.** The `Promise.all` enrichment case in
`emergency-intelligence.service.ts` is the third member of the whole-batch family
and remains ADR-017's subject.

### 10. Amendment - reachable ENDED lifecycle and retrigger routing

Measured after commits `bf51d2e` and `73d829e`.

The supersession transition described elsewhere in this ADR is not reachable
from the implemented incident lifecycle. `resolveForActivation` reuses an
existing STARTED-or-ACTIVE session rather than ending it as SUPERSEDED, so the
documented transition has no implementation path today. It should not be relied
upon when reasoning about current behaviour without a separate decision defining
what supersedes what. This amendment records the implemented behaviour; it does
not assign an owner to SUPERSEDED.

The "In favour" reasoning recorded in section 9 assumes that the supersession
transition described elsewhere in this ADR is reachable. Until an implementation
path and a separate decision define what supersedes what, that reasoning should
be read as applying to the intended future lifecycle rather than the current
implementation.

A retrigger against an incident whose linked journey session is missing or
ENDED does not append a fix to the missing or terminal link. Inside the existing
orchestrator transaction, `recordRetriggerFix`:

1. takes the lifecycle advisory lock;
2. resolves an available open session, creating one only when none exists;
3. atomically updates `Incident.journeySessionId` when the selected session
   differs from the incident's current link; and
4. writes the retrigger fix to the selected session.

A linked STARTED-or-ACTIVE session is reused unchanged. The guard applies to
every ENDED reason currently representable; it is not narrowed to USER_ENDED.
ADMIN_ENDED has no owner or admin surface today and must be reconsidered when
one is introduced.

At the time this amendment was accepted, no mobile workflow exercised the
end-session API. The retrigger behaviour described here therefore represents
the server contract independently of current client adoption. Future client
support should implement this server contract rather than redefine it.

Public tracking selects only the newest fix from the incident's currently
linked journey session. Relinking therefore resumes the current-location view
on the selected session. Fixes belonging to earlier sessions remain stored and
are not modified or deleted, but they are not reachable through this
current-session public-tracking query. This does not implement incident-to-
session history or a segmented historical viewer. Representing multiple
journey segments for a single incident remains a separate design decision.

#### Mutation evidence

Both load-bearing protections were demonstrated by mutation and then restored
byte-exactly.

Removing only the ENDED branch from `recordRetriggerFix` caused:

`moves a retrigger from an ENDED session to a fresh linked session`

to fail. The retrigger selected the old ENDED session and the incident was not
relinked. This demonstrates that the ENDED guard is the mechanism that
preserves terminal-session immutability.

Removing the ingestion pre-read advisory lock caused:

`prevents ingestion from appending after a concurrent end wins`

to fail. The concurrent ingestion completed successfully and wrote a new fix
after the session had already transitioned to ENDED, returning `inserted = 1`
instead of rejecting with `ConflictException`. The failure therefore
demonstrates that the advisory lock is the mechanism that prevents successful
post-END writes. The observed behaviour is neither a timing artifact nor a
unique-index side effect.

After each mutation, the committed file was restored byte-for-byte. The
integration baseline returned to 6 suites and 32 tests passing, and the
repository returned to a clean (`porcelain=0`) state.

### 11. Durable mobile queue storage

**Decision:** the mobile Journey queue uses `expo-sqlite`.

SQLite was selected because the queue requires durable ordered rows, an
explicit journey-session identifier per fix, persisted capture sequence state
across process death, and atomic removal only after acknowledged delivery.
Those requirements map directly to row storage and transactions.

`expo-secure-store` remains reserved for small secrets and authentication
material. It is not a telemetry queue. AsyncStorage was rejected for this
workload because enqueue and dequeue operations would require repeatedly
serialising, parsing and replacing the entire queue of up to 600 fixes.

The durable store must preserve the existing oldest-first flush invariant,
store the owning session with every fix, and persist the capture sequence so
process restart cannot reuse an idempotency key.

This decision does **not** set an age-retention ceiling. The existing
`MAX_QUEUED_FIXES = 600` remains the independent depth bound, while the
time-based retention limit remains an explicit open product decision.

---

## ADR-012 - Mock emergency-intelligence providers may be registered in production when their outputs are provably suppressed, acknowledged by an explicitly named boot flag

**Status: Accepted. Implemented.**

### 1. Context

`ProviderConfidenceValidator.onModuleInit()` counts registered providers
reporting `MOCK` confidence and throws unless `OPA_ALLOW_MOCK_PROVIDERS ===
'true'` (strict equality). Six of seven providers are mock-backed. The flag is
set in `apps/api/.env` for local development and is absent from Azure App
Service.

**Measured in Azure Log stream, 2026-08-01 UTC:** the production API initialises
every module, maps every route, and then dies at the validator, repeating on
each container restart. The full message names all six providers. This is the
sole reason production does not serve requests, confirmed by observation rather
than inference.

**This is not a defect.** The gate is opt-in and deliberately not derived from
`NODE_ENV`, so forgetting it fails closed. A mock geocoder returning a plausible
invented address could send a responder to the wrong place.

**Two remedies were evaluated and eliminated.** Response-level gating does not
satisfy the validator, which is a boot-time check on registered providers rather
than on response shape. Conditional registration does not work either: the six
providers are concrete constructor parameters, and
`incident-orchestrator.service.ts:86` awaits `buildLocationIntelligence` on the
SOS activation path, so the module cannot be unregistered without breaking
dependency resolution.

### 2. Decision

**The production state OPA requires is a single mode: mock providers registered,
their outputs suppressed, boot permitted.** The existing mechanism already
produces that state. Its name does not describe it.

`OPA_ALLOW_MOCK_PROVIDERS` reads as permission to expose fabricated data, which
is why three documents ban setting it in Azure. The flag is therefore **renamed
to `OPA_BOOT_WITH_SUPPRESSED_MOCKS`**, and the throw is retained unchanged in
mechanism.

Three states, exhaustive:

| Condition | Behaviour |
|---|---|
| No MOCK providers registered | Boot normally |
| MOCK providers + `OPA_BOOT_WITH_SUPPRESSED_MOCKS === 'true'` | Boot with a warning; mock-backed outputs remain null |
| MOCK providers + flag absent, or any other value | Refuse to boot |

**The strict `=== 'true'` comparison is retained.** `TRUE`, `True`, `1`, `yes`,
`on`, `false` and `''` all continue to fail. The existing test pinning this
behaviour applies unchanged to the new name.

**The rename is hard, not transitional.** `OPA_ALLOW_MOCK_PROVIDERS` stops being
read. The old name has one known consumer, is absent from Azure, and an
unrecognised variable fails closed - which is the correct outcome. A
compatibility branch would be carried permanently for a variable nobody else
sets.

### 3. Message text

**Warning, on permitted boot:**

> Mock emergency-intelligence providers are registered. Current response
> handling suppresses their outputs from user and responder responses. Boot
> permitted because OPA_BOOT_WITH_SUPPRESSED_MOCKS=true.

**Error, on refusal:** the existing message is retained in structure - it names
every mock provider, explains the danger, and offers remedies rather than
guessing. Only the flag name and the acknowledgement framing change:

> Refusing to start because mock emergency-intelligence providers are registered
> ({list}). The current response builder is designed to suppress their outputs,
> but boot requires explicit acknowledgement with
> OPA_BOOT_WITH_SUPPRESSED_MOCKS=true.

**The provider list must stay in the message.** It is what makes the failure
actionable.

**Amended 1 August 2026:** The emitted refusal and permitted-boot messages
follow the intent described in this section rather than treating the
illustrative quotations as exhaustive. They retain the number and names of
registered mock providers for operational diagnosis. This clarification does
not change the suppression or acknowledgement semantics of this decision.

### 4. The suppression contract

The flag acknowledges suppressed-provider operation. It does not permit
fabricated data to surface. The following hold:

- Emergency intelligence is **optional enrichment, not a prerequisite for
  incident creation**. Raw device coordinates and the incident record remain
  available regardless.
- Each mock-backed enrichment section is omitted **independently, per provider**.
- The orchestrator **must continue to handle null enrichment**. Its current
  tolerance of a fully-null return is asserted in ADR-015 section 4 but has not
  been measured; it should be verified before ADR-015's freeze lifts.
- A suppressed mock provider must **never** surface fabricated data through any
  response path.
- **Before this flag is enabled in production, tests must pin the suppression
  behaviour for all currently registered mock providers. Every future provider
  must add equivalent coverage before it may coexist with this mode.**
  Suppression is presently six hand-written checks in a 148-line method, not a
  loop, and no test currently pins that every mock-backed section is omitted.
  **This ADR does not claim that coverage exists today; it makes it a
  precondition of setting the flag.** Deferring it to the next provider added
  would leave the present six untested while the retained throw guards against
  drift it cannot detect.

**This shares its rationale with ADR-015 section 6b:** a provider that reports
what it did not do corrupts a record whose value is that it can be verified.
Suppression and honest failure reporting are the same principle applied to
enrichment and to delivery.

### 5. Consequences

- Production boots once the flag is set under its new name in App Service.
  **Production boot unblocks the remaining ADR-015 entry criteria, including
  applying pending database migrations through the approved private-network
  deployment path.** The current migration count and the access mechanism are
  deployment facts and belong in the handover, not here.
- `apps/api/.env` must be updated **in the same implementation session** as the
  code change, before the next local `start:dev`. **The file remains untracked
  and must not be committed.**
- The three documents banning `OPA_ALLOW_MOCK_PROVIDERS` in Azure need their
  prose updated to the new name, retaining the reasoning.
- Setting the flag remains a deliberate, recorded act. It is not
  `NODE_ENV`-derived and must not become so.

### 6. What this does not decide

Replacing the mock providers with real ones is procurement (Sprint 10C) and is
unaffected. This ADR permits boot with suppression; it does not make suppressed
enrichment a permanent acceptable state.

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

**Amended 1 August 2026:** ADR-012 supersedes the flag name and production
policy recorded here. The validator throw remains fail-closed, but the hard
rename is `OPA_BOOT_WITH_SUPPRESSED_MOCKS`. Exact lowercase `true` explicitly
acknowledges booting with registered mock providers whose outputs are
suppressed. The old `OPA_ALLOW_MOCK_PROVIDERS` name is retired and is not read.

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
