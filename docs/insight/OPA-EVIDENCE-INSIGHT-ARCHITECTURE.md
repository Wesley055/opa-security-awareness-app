# OPA Evidence & Insight architecture

Status: internal foundation; no Partner Gateway, publication, deployment or compliance certification.

## One program, existing operational authority

Incident, IncidentTimelineEvent, IncidentNotification/DeliveryAttempt, Evidence and the SafeWalk emergency linkage remain authoritative. The pure allowlisted projector in insight.projection.ts supplies aggregate reporting, persisted ReportingProjection, stored AIR, Insight views and compliance evidence. CorrectiveAction is the only new business lifecycle. None of these paths writes operational lifecycle, notifications, tracking, PII, users, SSO or facilities.

Facility.id is the existing tenant identifier. Every service operation rereads the current account inside a SERIALIZABLE PostgreSQL transaction. Active FACILITY_OPERATOR and FACILITY_ADMIN use their assigned facility. ADMIN uses one explicitly selected facility (or its assigned facility), never a wildcard or a multi-facility aggregate. Inactive accounts, pending accounts and inactive facilities are denied. Existing JwtAuthGuard, AdminGuard, OperatorFacilityGuard and FacilityAdminGuard are reused through InsightGuard. Transaction checks remain mandatory for internal callers.

## Projection and reconciliation

ReportingProjection has one row per facility/incident, with schema/generator version in its structured document, source digest, observation cutoff and update time. It is a disposable cache, not an incident lifecycle authority. Reconciliation reads authoritative records in a transaction, regenerates the deterministic allowlisted document and upserts only when its digest/generator differs. Repeating an unchanged reconciliation does not create another reconciliation event. Audit and projection writes commit together. Unique indexes plus SERIALIZABLE retry of the complete transaction handle races; retries are capped at four attempts.

Rebuild by enumerating authorized incident IDs for one facility and invoking POST /internal/insight/incidents/:incidentId/reconcile with that facility context. Resume from the last incident ID; replay is safe. No operational event consumer or scheduler is introduced. Aggregate reads project current authoritative facts in the same transaction, so they never serve stale cached lifecycle state. AIR generation reconciles its source first. Stored AIRs are never rebuilt in place.

Facility reassignment or deletion does not transfer a historical AIR to another tenant: reads require both its stored facility and the incident's current facility. Old projection rows can remain inaccessible; an approved retention job may later purge disposable caches. Reporting IDs reference core records logically so retention does not prevent active operational lifecycle actions. Corrective actions have a composite foreign key to their AIR's ID, facility and incident. Completion evidence is verified against the authoritative incident evidence in the transaction.

## Privacy

Only selected source columns enter the projector. No raw payload, free-text closure reason, name, email, phone, guardian, recipient address, storage credential or precise coordinate is stored in reports or returned. Identity uses the existing protected display convention; there is no reporting decryption/reveal path or second identity store. Report actors are masked and linked to source event/audit references. Timeline actorUserId means ON_BEHALF_OF, not necessarily the performer.

Private SafeWalk sessions, planning, guardian notices and location history are not inputs. An incident linked to SafeWalk is eligible only when that session's safeWalkEmergencyIncidentId matches it and safeWalkEmergencyAt exists. Missed arrival alone creates no reporting eligibility.

## Bounds and operational isolation

Reporting has separate internal routes and no outbound network side effects. It does not poll or mutate emergency operations. Aggregate windows are half-open UTC intervals of at most 366 days and at most 1,000 incident candidates. Source histories are counted before materialization and are limited to 10,000 total timeline/notification/evidence/attempt records. Oversized requests fail; no partial counts are returned. Per-source arrays have a second 10,000-row tripwire. Transactions have a 20-second timeout. Cohort action metrics cap at 10,000 actions; compliance packages cap at 100 AIR versions and 1,000 actions.

Large-scale asynchronous aggregates, read replicas, scheduled rebuilds, retention/legal hold administration and load testing remain future work. These bounds are deliberate foundation limits, not a throughput claim.

## Command Center and contracts

The existing Reports page gains a server-loaded 30-day scoped Insight overview. HTTP-only session authorization stays server-side; responses are not cached, precise identity is absent, unavailable data does not become zero, and the page does not poll. Existing incident operations/layout remain intact. AIR/action workflow UI is not implemented; stable internal backend operations are available.

Internal routes are excluded from Swagger publication. Future partner design may consume versioned structured results after separate authentication/authorization, retention and export reviews. No external contract is published.
