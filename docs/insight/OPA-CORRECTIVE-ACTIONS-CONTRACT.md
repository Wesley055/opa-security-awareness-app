# OPA corrective actions contract v1

POST /internal/insight/corrective-actions.
Body: requestKey, airId, ownerId, category, dueAt (ISO), priority, optional facilityId.

PATCH /internal/insight/corrective-actions/:actionId.
Body: expectedVersion plus either ownerId or status, optional completionEvidenceId on COMPLETED, optional facilityId. Mixed reassignment/status requests are rejected. Unknown body fields are rejected by the existing global validation pipe.

Creation/reassignment requires FACILITY_ADMIN or scoped ADMIN. Owner must be an active FACILITY_OPERATOR/FACILITY_ADMIN assigned to the same facility. Titles/descriptions come from a bounded operational catalog (DELIVERY_REVIEW, RESPONSE_REVIEW, EVIDENCE_REVIEW, PROCEDURE_REVIEW), so free text cannot introduce PII into routine reporting. Custom free-text action authoring is intentionally not exposed in v1; supporting it needs a protected-content/reveal policy. Priority is LOW, MEDIUM, HIGH or URGENT. Due dates in the past are allowed and immediately show overdue.

The row stores correctiveActionId, incident/AIR/facility references, title, description, category, owner, due date, priority, status, createdBy/time, updatedAt, version, completion evidence/time, verification actor/time. Ordinary results mask owner/creator/verifier and give assignedToMe and auditReference. The authoritative User and Evidence domains are reused; no copied user profile or evidence file is stored.

## Explicit transitions

| From | To | Authority / precondition |
| --- | --- | --- |
| OPEN | IN_PROGRESS | assigned owner |
| OPEN | CANCELLED | manager |
| IN_PROGRESS | COMPLETED | assigned owner; STORED Evidence for the same incident |
| IN_PROGRESS | CANCELLED | manager |
| COMPLETED | VERIFIED | different manager from owner; completion evidence still STORED |
| COMPLETED | IN_PROGRESS | assigned owner; prior completion retained in audit, current completion fields reset |
| VERIFIED / CANCELLED | any | denied |

OVERDUE is a derived boolean: status is OPEN/IN_PROGRESS and dueAt < observation time. It never replaces lifecycle state or completes work. Reassignment is allowed only for OPEN/IN_PROGRESS and is audited. Completion and verification cannot be performed by a different owner or self-verifying manager respectively.

A compare-and-swap update matches expectedVersion and increments it exactly once. Concurrent updates from the same version produce one success and one conflict (HTTP 409); reload before retrying. Ownership/status/evidence checks and audit run in the same SERIALIZABLE transaction. Completion evidence changes on reopening remain in beforeState audit provenance. Terminal versions cannot be reopened implicitly.

The database enforces positive versions, priority vocabulary, required completed/verified evidence timestamps, independent verifier and composite AIR/facility/incident linkage. References to core users/evidence are resolved transactionally; no parallel operational records are created.

Read actions through the incident compliance-evidence package, including historical AIR versions. Creation, ownership, progress, cancellation, completion, verification and reopening all produce scoped AdministrativeAuditEvent records.
