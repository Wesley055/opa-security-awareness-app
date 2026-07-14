\# Incident Lifecycle — As Built



\## Entry point



`IncidentOrchestratorService.createCoordinatedIncident(userId, dto)` —

the single real coordination path. `IncidentsService.create()` exists

independently but is a lower-level primitive the orchestrator calls

partway through, not a separate activation path.



\## The real sequence, in order



1\. \*\*Detection\*\* — `EmergencyDetectionService.evaluate()` runs first,

&#x20;  before anything else exists. If `shouldActivate` is false, the

&#x20;  function returns immediately with `NOT\_ACTIVATED` or

&#x20;  `CONFIRMATION\_REQUIRED` — no incident, no timeline event, nothing

&#x20;  written to the database. This is intentional: a rejected trigger

&#x20;  should leave no trace.

2\. \*\*User lookup\*\* — the real user record is fetched

&#x20;  (`UsersService.findById`) — this is what makes notification text say

&#x20;  the actual person's name instead of a placeholder.

3\. \*\*Intelligence\*\* — `EmergencyIntelligenceService.buildLocationIntelligence()`

&#x20;  resolves address/cross-street from raw lat/lng.

4\. \*\*Incident created\*\* — `IncidentsService.create()` — this is the

&#x20;  first point an incident row exists.

5\. \*\*Timeline begins\*\* — `INCIDENT\_CREATED`, then `LOCATION\_ATTACHED`,

&#x20;  recorded via `IncidentTimelineService.recordEvent()`. Sequence

&#x20;  numbers and the hash chain start here.

6\. \*\*Contacts loaded\*\* — active `EmergencyContact` rows for the user.

7\. \*\*Notifications sent\*\* — one `sendEmergencyAlert()` call per contact

&#x20;  per available channel (SMS always attempted; email only if the

&#x20;  contact has one on file). Each attempt writes a real

&#x20;  `IncidentNotification` row and a `CONTACT\_NOTIFIED` timeline event,

&#x20;  regardless of success or failure.

8\. \*\*Response returned\*\* — includes `contactsNotified` (unique contacts

&#x20;  with at least one successful send — not total attempts, this was a

&#x20;  real bug fixed and tested) and the full per-notification result list.



\## What updates status/stage after this point



Not yet built as a coordinated flow — there's no orchestrator method for

"mark resolved" or "assign to facility" yet. That's real, open work, not

an oversight in this document.



\## Access control



Any endpoint that reads a specific incident (`incident-timeline`,

`evidence`) is gated by `IncidentAccessGuard` — the incident's owner,

`HOSPITAL\_STAFF` assigned to its facility, or `ADMIN`. Lives in

`src/shared/guards/`, shared rather than duplicated.

