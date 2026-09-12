# OPA aggregate reporting and Insight contract v1

GET /internal/insight/overview?from=<ISO>&to=<ISO>[&facilityId=<UUID>].

The authenticated database account determines authority. Facility selection is optional for assigned institutional staff and mandatory for an unassigned platform ADMIN. Supplying another facility never grants tenant staff access. from is inclusive, to exclusive; timestamps are normalized to UTC. Maximum span 366 days, maximum 1,000 incident candidates and 10,000 source-history records. Size/invalid-window errors are HTTP 400 and never return partial metrics.

## Metrics

- incidentCount: eligible Incident records created in the requested window.
- byTrigger / byActivationSource / byActivationMode: source enum values, with UNKNOWN bucket when initial activation provenance is missing. Only ACTIVATION_RECORDED with retrigger=false establishes initial activation mode/source.
- byDayUtc: creation date histogram; byFacility contains only the authorized facility.
- acknowledgementLatency: meanMs=null, known=0, unknown=incidentCount. This base has no authoritative incident acknowledgement writer. Notification acknowledgement never establishes incident acknowledgement.
- resolutionLatency: Incident.createdAt to resolvedAt for RESOLVED records only. CANCELLED records are excluded. Missing/negative intervals yield null and increment unknown; no zero-filled averages.
- notificationOutcomes: counts by authoritative deliveryStatus. PROVIDER_ACCEPTED is not DELIVERED. Legacy NotificationStatus.SENT/DELIVERED and sentAt/deliveredAt are not delivery proof.
- locationAvailability: RECORDED when both incident origin coordinates exist, otherwise UNKNOWN. This is not independently verified position.
- unresolved: OPEN or ACKNOWLEDGED. staleUnresolved: unresolved creation age at observation time >=24 hours. This measures incident age, not inactivity since a responder action.
- safeWalkEmergencyEscalations: eligible incidents with matching authorized emergency linkage only.
- evidenceCompleteness: present/possible across five fixed checks per incident: activation provenance, creation timeline, notification attempt history, stored evidence, closure provenance. A zero denominator has no percentage. This coverage is not quality; open incidents naturally lack closure provenance.
- missingEvidence and missingClosureProvenance: deterministic source absence counts.
- recurringZones, responder-arrival latency and causal conclusions: null, unavailable.

Action metrics apply to actions linked to the eligible incident cohort, not a separate action-createdAt window. OPEN/IN_PROGRESS, COMPLETED, VERIFIED and due-date-derived overdue are counted separately. Notification history completeness requires an authoritative DURABLY_QUEUED event and matching recorded attempt count, as in Delivery Confirmation. This coverage is not proof of every historical event.

## Four stable views

Executive: incident volume, daily trend, unresolved, resolution latency, action summary, evidence coverage.
Operations: acknowledgement and resolution measures, delivery outcomes, single-facility comparison map.
Risk: observed category frequency and overdue actions; no predictive or causal AI statements.
Evidence: fixed coverage, missing stored evidence, missing closure provenance. Source audit coverage is null because it is not established by the source.

schemaVersion=1, tenantId/facilityId, normalized window, observedAt and AUTHORITATIVE_TRANSACTION_SNAPSHOT accompany metrics. This is an observation of current facts for a creation cohort, not an arbitrary historical time-travel query. JSON remains the contract. CSV/PDF are not implemented.
