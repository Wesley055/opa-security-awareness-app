# Institutional authority implementation contract

Approved 2026-09-28. Implementation in progress; not release-approved.

User.facilityId is the single authoritative tenant reference. membershipState
(ACTIVE/SUSPENDED/REVOKED) qualifies that assignment, never supplies another tenant.
A null facilityId gives no tenant authority regardless of membershipState.
Suspension/revocation retains facilityId for history and restoration; it does not
change global User.isActive. Existing globally inactive assigned accounts remain
globally inactive and classify conservatively as suspended memberships.

Support employees have TECHNICAL_SUPPORT role, no facility assignment, a current
SupportEmployment and explicit scoped SupportCapabilityGrant. No role-only support
allow rule. OnboardingAuthorityGrant and IdentityAccessGrant remain independent.

An operational acknowledgement never changes Incident.status from OPEN. Extend
IncidentsService.close for institutional resolution; preserve owner closure,
locking, telemetry termination, tracking revocation and timeline history.

Last administrator changes must serialize by Facility, including global suspension,
role changes and reassignment. Pending invitations are not active administrators.
Zero-admin legacy/new facilities require commissioning; do not fabricate accounts.

Migration rollout is additive. Do not enable new role writes with old binaries.
Rollback disables new workflows and retains authority/audit history; enum removal
or destructive database restore is not a supported rollback.
