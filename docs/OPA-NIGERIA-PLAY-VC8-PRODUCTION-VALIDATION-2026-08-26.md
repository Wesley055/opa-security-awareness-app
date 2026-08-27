# OPA Nigeria Google Play vc8 Production Validation
Date: 2026-08-26
Build: vc8 / versionCode 8 / version 1.0.0
Git commit: b671a7bebcf521d838b2aaf3c13801a1debc2007
Distribution: Google Play Internal Testing

## Confirmed

- Google Play internal-test distribution successfully installed OPA on a tester device in Nigeria.
- Play-delivered vc8 reached the production OPA API.
- POST /incident-orchestrator/activate returned HTTP 201.
- Journey session creation and location tracking continued successfully after SOS activation.
- The resulting SOS did not appear in the tested Command Center operator queue.

## Command Center routing investigation

GET /operator/incidents is protected by:
- JwtAuthGuard
- OperatorFacilityGuard

OperatorFacilityGuard:
- re-reads authorization state from PostgreSQL;
- requires an ACTIVE account;
- requires role FACILITY_OPERATOR or ADMIN;
- requires the viewing account to have a facilityId;
- places that database-derived facilityId into request.operatorFacilityId.

OperatorIncidentsController calls:

FacilitiesService.listIncidentsForFacility(
  request.operatorFacilityId,
  query
)

FacilitiesService filters Incident using:

facilityId = operatorFacilityId

and normally limits results to LIVE_STATUSES.

Therefore:

USER/resident -> SOS -> Incident snapshots resident User.facilityId
-> FACILITY_OPERATOR assigned to same facility
-> /operator/incidents -> incident visible.

The resident triggering SOS DOES NOT need FACILITY_OPERATOR role.

A resident with no facilityId, or a facilityId different from the viewing
operator's facility, will not appear in that operator queue.

## Production ADMIN discovery

Read-only Prisma query identified two ACTIVE ADMIN accounts:

- charles@opasafety.com
  role=ADMIN
  facilityId=null
  isActive=true

- info@opasafety.com
  role=ADMIN
  facilityId=null
  isActive=true

ADMIN discovery was READ ONLY. No roles or database records were modified.

## Nigeria tester under investigation

OPA account:
sambest086@gmail.com

Next action:
Use an authenticated ADMIN provisioning flow to find this USER and determine
their current facility membership. If appropriate, assign the resident to
the same facility as the intended Command Center operator.

Do not promote the resident to FACILITY_OPERATOR.

## SMS

SMS non-delivery was also observed during the Nigeria test.

IMPORTANT:
Do not yet attribute SMS non-delivery to facility membership.
Trace notification recipient selection/outbox/provider dispatch separately.

## Current diagnosis

Play distribution: PASS
Production API connectivity: PASS
SOS activation: PASS
Journey/tracking continuation: PASS
Command Center polling: PASS
Command Center incident visibility: INVESTIGATING FACILITY SCOPE
SMS delivery: INVESTIGATION REQUIRED

No mobile rebuild is justified by the evidence currently available.

## Follow-up: facility-scope root cause confirmed

Production read-only inspection confirmed:

operator@opasafety.com
- role: FACILITY_OPERATOR
- facilityId: a0ede9e9-9771-477a-a36e-777454f6e31e
- isActive: true

sambest086@gmail.com before remediation
- role: USER
- facilityId: null
- isActive: true

This confirms why Sam's already-created incident could not appear in the
operator@opasafety.com facility queue: the incident was created while Sam
had no facility membership, and incident creation snapshots User.facilityId.

Remediation was performed through the existing protected ADMIN provisioning
API, not by direct database modification:

PATCH /admin/residents/:userId/facility

Result:
- sambest086@gmail.com remains role USER
- facilityId is now a0ede9e9-9771-477a-a36e-777454f6e31e

No role promotion was performed.

A fresh SOS is required to validate the remediation because previously
created incidents retain their facility snapshot. Fresh Nigeria validation
is deferred until the tester is available.

SMS non-delivery remains a separate open investigation. Facility assignment
must not be declared its root cause without notification/outbox/provider
evidence.

## Follow-up: SMS non-delivery root cause confirmed

Production inspection of Sam's incident showed:

Incident:
- createdAt: 2026-08-26T21:25:27.100Z
- status: OPEN
- facilityId at creation: null
- IncidentNotification rows: 0

Production inspection of Sam's emergency contacts showed one active contact:

Eyis Benita
- relationship: Daughter
- phoneNumber: +2348169744147
- isActive: true
- createdAt: 2026-08-26T21:57:38.168Z

The emergency contact was therefore created approximately 32 minutes AFTER
the SOS incident.

Confirmed conclusion:

At SOS activation time Sam had no configured emergency contact. OPA therefore
created no IncidentNotification rows and did not submit an SMS to Africa's
Talking.

This was not an Africa's Talking or Nigerian carrier delivery failure.

Two independent causes were established for the Nigeria vc8 test:

1. Command Center visibility
   Sam had facilityId=null when the incident was created.

2. SMS notification
   Sam had no emergency contact when the incident was created.

Current remediation state:
- Sam remains role USER.
- Sam is now assigned to facility:
  a0ede9e9-9771-477a-a36e-777454f6e31e
- Sam now has an active Nigerian emergency contact.
- A fresh controlled SOS is required to validate both remediations.

No mobile rebuild is justified by these findings.
