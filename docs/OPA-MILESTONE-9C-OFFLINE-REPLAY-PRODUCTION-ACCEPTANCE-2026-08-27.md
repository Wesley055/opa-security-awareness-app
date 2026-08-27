# Milestone 9c - Offline Buffer + Retry Queue Production Acceptance

**Status:** PASS / CLOSED  
**Validation date:** 2026-08-27  
**Environment:** Production  
**Device:** Physical Android device  
**Journey session:** `8674caf9-34be-49b3-8163-f711a1039acf`

## Acceptance Scope

Milestone 9c validates that Journey location telemetry survives loss of network connectivity and is durably replayed when connectivity returns without losing ordering or creating duplicate sequence records.

## Hardware Validation

The production OPA Android application was tested during an active protection/Journey session.

The device was placed into a genuine no-network condition:

- Airplane Mode enabled.
- Wi-Fi disabled.
- Location remained enabled.
- Active protection remained running.
- Device was locked and moved during the outage.
- USB ADB remained connected so background execution could be observed.

During the outage:

- Android background location delivery continued.
- OPA continued attempting replay.
- Network requests failed with `Network Error`.
- Replay reported that durable rows were retained rather than deleted.

Observed behavior included:

`BGREPLAY HTTP_ERROR ... Network Error - durable rows retained`

## Reconnect Validation

Network connectivity was restored without restarting the OPA application process.

The same application process and Journey session continued operating.

After connectivity returned, replay transitioned from network failures to successful delivery.

Observed replay included:

`BGREPLAY SENT ... sent=1 removed=1`

and a multi-row recovery batch:

`BGREPLAY SENT ... sent=3 removed=3`

Normal live delivery then resumed.

## Production PostgreSQL Verification

Production database verification was performed against:

`JourneyLocationFix`

for Journey session:

`8674caf9-34be-49b3-8163-f711a1039acf`

The production database confirmed that location fixes recorded while connectivity was unavailable were subsequently received by the API after connectivity returned.

Query results included:

- 46 fixes recorded during the defined outage interval.
- 135 fixes received after reconnect.

Historical fixes in the offline/recovery period preserved sequence progression.

For example, sequences 44 through 96 were recorded before/during the connectivity interruption and were subsequently persisted with a `receivedAt` timestamp of approximately:

`2026-08-27T22:56:31.129Z`

The recovery continued through sequences 97-101.

From sequence 102 onward, `receivedAt` again followed `recordedAt` by approximately normal near-live latency, confirming transition from backlog replay to normal tracking delivery.

## Deduplication Verification

A production query grouped `JourneyLocationFix` records by sequence for the validated Journey session and searched for:

`HAVING COUNT(*) > 1`

Result:

`[]`

Therefore no duplicate sequence numbers were present for the validated session.

## Acceptance Result

Milestone 9c is **PASS / CLOSED**.

Production hardware validation proves:

1. Location capture continues during network loss.
2. Captured fixes remain in durable local storage when transmission fails.
3. Failed transmission does not delete queued telemetry.
4. Connectivity restoration does not require application restart.
5. Buffered telemetry is replayed after reconnect.
6. Multi-row backlog replay operates successfully.
7. Production PostgreSQL receives the buffered telemetry.
8. Sequence progression is preserved through the outage/reconnect boundary.
9. Replay does not create duplicate Journey sequence records.
10. Normal near-live tracking resumes after backlog recovery.

## Residual Queue Classification

A persistent mobile `durableDepth=72` was observed after the active Journey session returned to normal live delivery.

This does **not** invalidate Milestone 9c.

`durableDepth` represents the global SQLite `journey_queue` depth rather than only the active Journey session.

The queue replay selector explicitly prioritizes the current active session before historical sessions.

The validated active session successfully replayed its outage telemetry and returned to normal delivery while the global depth remained present.

The residual rows therefore require separate classification.

They must not be silently deleted.

Permanent handling must distinguish active emergency telemetry from historical/stale session telemetry and provide an appropriate reconciliation/quarantine lifecycle.

This residual queue work is tracked separately from Milestone 9c and does not block its closure.

## Final Decision

**Milestone 9c: CLOSED - PASS**

Validated end-to-end on physical Android hardware against the production API and production PostgreSQL database on 2026-08-27.
