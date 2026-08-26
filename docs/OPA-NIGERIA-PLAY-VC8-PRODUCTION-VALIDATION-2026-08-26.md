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
