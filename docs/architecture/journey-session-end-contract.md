# Journey Session End — provisional implementation note

**Status: PROVISIONAL. Not an ADR.** Written before implementation, to be promoted
to an ADR or discarded once the endpoint's behaviour is proven. Nothing here
supersedes an installed ADR.

**Measured at:** f5a8ab2 on main.

---

## Scope

This note governs only the explicit `USER_ENDED` path. It does not claim the
five-reason lifecycle is implemented, and it must not be read as doing so.

`JourneySessionEndReason` already exists in the schema with five values
(`USER_ENDED`, `INCIDENT_RESOLVED`, `TIMED_OUT`, `SUPERSEDED`, `ADMIN_ENDED`),
and `@@index([status, lastFixReceivedAt])` exists with a docstring naming the
silence reaper. The lifecycle was designed on 2026-07-26 and never implemented.
**The gap is ownership, not design.** No new enum value is required and no
migration is required.

---

## 1. Ownership secrecy

An unknown session and another user's session return the **same 404**. No 403
ownership distinction is exposed.

This is not a layering preference. `journey-ingestion.service.ts:97` and ADR-009
(line ~1106) both state it explicitly, and ADR-014 §2 repeats it as a security
property: the response must never confirm that an id is real but owned by someone
else. An end endpoint that 403s would leak exactly what `ingest()` conceals.

## 2. Idempotency

Ending an already-`ENDED` session **succeeds**. It does not 409.

- The original `endedAt` and `endedReason` are preserved.
- A retry must **not** overwrite `endedAt` with a fresh timestamp.
- The write is therefore conditional on `status !== ENDED`, not unconditional.

Rationale: a mobile client on a degraded connection will retry. A 409 on a
successful retry is a false failure. `resolveForActivation`'s own docblock cites
being "IDEMPOTENT for free" as a virtue; this follows the same rule.

Note the asymmetry with ingestion, which is deliberate: `ingest()` **does** 409 on
an `ENDED` session (ADR-009). Ending is idempotent; writing fixes to an ended
session is not.

## 3. Write semantics

For an owned session in `STARTED` or `ACTIVE`:

```
status      = ENDED
endedAt     = database clock
endedReason = USER_ENDED
```

Three constraints inherited from ADR-009, all load-bearing:

- **Lock form.** Lifecycle operations take the **1-arg**
  `pg_advisory_xact_lock(hashtext(userId))`. Ingestion's 2-arg
  `(2, hashtext(sessionId))` is a separate lock space and is the wrong one here.
  The two forms do not serialise against each other.
- **Transaction ownership (D7).** `JourneySessionService` methods take an explicit
  `tx` and have no injected fallback, because `pg_advisory_xact_lock` is
  transaction-scoped — on a non-transactional client the lock is released before
  the next statement runs, the code looks identical, raises nothing, and provides
  no mutual exclusion. The transaction is opened by `JourneyIngestionService`,
  matching `startSession`.
- **Clock.** `endedAt` comes from the **database** clock, not the process clock,
  consistent with D3's `SELECT date_trunc('milliseconds', now())`. `recordedAt` is
  the device clock and carries arbitrary skew; `endedAt` is a server fact.
  **Do not use `new Date()`.** Measure the established database-clock pattern in
  `insertFixes` and reuse it, or issue the update with database `now()` inside the
  same transaction.

### 3.1 Transaction sequence

```
BEGIN
  -> pg_advisory_xact_lock(hashtext(authenticatedUserId))
  -> find session by id
  -> null, or userId differs: same 404
  -> already ENDED: return stored ended state UNCHANGED, no write
  -> otherwise: update status, endedAt and endedReason atomically
COMMIT
```

The lock is taken on the **authenticated caller's** userId, before the lookup.
That is correct rather than merely convenient: a session owned by another user is
never mutated on this path, so the caller's lock is the only one that needs to
hold. Taking it before the lookup is what makes the read-then-write
non-racy.

### 3.2 An attached OPEN incident is unchanged

A session may be attached to an incident that is still `OPEN`.

**`USER_ENDED` ends the journey session and does not close the incident.**
`Incident.status` is untouched. No incident-close workflow is invented here — none
exists, and inventing one on this path would be the second time a mechanism got
assumed into existence rather than measured.

**The response must not imply the emergency is over.** ADR-008 is explicit that
"incident closed" and "link expired while the incident is still OPEN" must never
share a message, because telling a family the emergency has ended while their
relative is missing is the worst failure this product has. Ending a session is a
telemetry event, not an incident outcome, and nothing in this endpoint's response
may be phrased as though it were.

## 4. Response

Return the ended session state, so that a retry receives the same authoritative
`endedAt` rather than a bare 204 the client cannot reconcile.

`JourneySessionDto` does not currently carry `endedAt` or `endedReason`. Prefer a
separate response type over widening it: `startSession` returns
`JourneySessionDto` today, and widening it changes a shipped contract for no
benefit. Keep this purely additive, on the pattern ADR-014 §3 used for
`IngestFixesResult`.

```ts
type EndJourneySessionResult = {
  sessionId: string;
  status: 'ENDED';
  endedAt: string;
  endedReason: JourneySessionEndReason;
  alreadyEnded: boolean;
};
```

`alreadyEnded` makes retry behaviour explicit without changing the authoritative
timestamp.

**`endedReason` is the enum, not the `'USER_ENDED'` literal.** On the
`alreadyEnded: true` path the stored reason is whatever ended the session, and
once any other owner exists — reaper, incident close, admin — that will not always
be `USER_ENDED`. Pinning the literal would type-check today and quietly
misreport the moment a second owner ships.

## 5. Consequence — the ENDED branch becomes reachable

Today `journey-ingestion.service.ts:107` throws a `ConflictException` that
**nothing can trigger**: no code anywhere writes `status = ENDED` (swept
repo-wide at f5a8ab2). Shipping this endpoint makes that branch live for the
first time.

**What the endpoint commit must contain, and nothing more:**

1. A real session transition to `ENDED`.
2. Integration coverage showing that subsequent ingestion against that session
   reaches the **existing** 409. This is the first time that branch has ever been
   exercisable; without it, item 10 can pass green without touching it.
3. Idempotent re-end preserving the original `endedAt`.

**What the endpoint commit must NOT contain.** Widening `ingest()`'s select alone
is not a partial improvement — ingestion still rejects every ended session before
any fix is examined, so the widened field would be selected and unused. ADR-014's
per-item partitioning, the `recordedAt < endedAt` comparison and the
response-envelope change are one coupled server-and-client phase. Do not implement
any part of them here.

Two constraints to carry forward into that later phase, recorded now so they are
not rediscovered:

- `ingest()` selects `id, userId, status, startedAt` only. ADR-014 §3.2 requires
  `endedAt` and records that the implementation must widen the select. This
  endpoint creates the first rows where `endedAt` is non-null, so that widening
  stops being hypothetical.
- ADR-014 §3.2 rules that a **null `endedAt` on an `ENDED` session means
  reject-and-reacquire, never accept**. This endpoint must therefore never produce
  an `ENDED` row without `endedAt` — status and timestamp are one write, not two.

## 6. Deferred lifecycle owners

| Reason | Why it is not implemented here |
|---|---|
| `INCIDENT_RESOLVED` | No incident-close path exists. A sweep of `incidents.service.ts` for `close`/`CLOSED`/`resolve` returned nothing. Nothing closes an incident, so nothing can cascade to its session. |
| `TIMED_OUT` | Silence detection is listed under ADR-009's "Deliberately not built", with the commercial consequence recorded: SafeWalk is gated on 10B **plus** this. The reaper index exists; the reaper does not. |
| `SUPERSEDED` | **Contradicted, not merely deferred.** See below. |
| `ADMIN_ENDED` | No admin surface exists. |

**`SUPERSEDED` is the one to be careful about.** ADR-014 (line ~250) states that
supersession happens when a new incident starts — "which is to say, during the
emergency" — and builds its §3.2 rejection path on that. But
`incident-orchestrator.service.ts:268` calls `resolveForActivation`, which
**reuses** any `STARTED`-or-`ACTIVE` session and never ends one. The mechanism
ADR-014 assumes does not exist in the code. Do not implement `SUPERSEDED` on the
strength of ADR-014's description without re-deciding what supersedes what.

## 7. Documentation corrections — separate commit

**Not to be made in the endpoint commit.** Record after the endpoint's behaviour
is proven.

- **ADR-014** — amend to state that its supersession trigger does not currently
  exist. §3.2's ENDED branch is written against a mechanism the orchestrator does
  not implement.
- **ADR-009** — its "Open" list still carries *"Late fixes after supersession:
  proposal is to accept into ENDED when `recordedAt < endedAt`, else reject as
  permanent."* ADR-014 §3.2 now owns that contract as accepted. Close or supersede
  the open item so the two documents stop disagreeing.

## 8. Open, and deliberately not decided here

- The route shape (`POST` vs `PATCH`, path) is an implementation choice, not a
  contract decision. The controller is a pass-through.
- Whether `USER_ENDED` is the correct reason when the client ends a session that
  an SOS later attached to. Probably yes, but unmeasured.
- What the public tracking page renders once a session is `ENDED` but its incident
  is still `OPEN`. §3.2 fixes the API's behaviour; the page's four states
  (`AWAITING_FIRST_FIX | RECEIVING | SILENT | ENDED`) have never had a real
  `ENDED` session to render, and `tracking-state.ts:63` returns `ENDED` on session
  status alone. Worth looking at before the first real ended session exists in
  production, not after.
