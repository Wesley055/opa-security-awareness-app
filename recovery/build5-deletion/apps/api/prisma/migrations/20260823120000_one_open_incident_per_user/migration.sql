-- GAP-01B permanent database invariant.
--
-- A user may have at most one OPEN incident.
--
-- ACKNOWLEDGED is intentionally excluded from this invariant today.
-- The current SOS/orchestrator lifecycle treats OPEN as the retriggerable
-- active incident. Expanding the database invariant to include ACKNOWLEDGED
-- must be coordinated with the application lifecycle so an acknowledged
-- incident is also found and reused by subsequent SOS activation.
--
-- RESOLVED and CANCELLED are terminal and remain unlimited.
--
-- Legacy duplicate OPEN incidents were reconciled before this migration
-- was introduced. The unique partial index makes recurrence impossible
-- even if application-level OPEN-incident lifecycle logic regresses.

CREATE UNIQUE INDEX "Incident_one_open_per_user_key"
ON "Incident" ("userId")
WHERE "status" = 'OPEN'::"IncidentStatus";