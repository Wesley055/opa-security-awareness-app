# Super Admin integration contract

The tenant boundary remains `Facility`. Accepted memberships remain `User.facilityId`; there is no parallel organization or membership table. Platform `ADMIN` authority is checked against the current account. Tenant operator and facility-admin roles cannot use platform administration.

## Administration API

All routes below use `JwtAuthGuard` and `AdminGuard`. Reads are `Cache-Control: no-store`. Collection responses are limited to 50 records and return `nextCursor`; pass it as the next `cursor` query parameter.

| Operation | Route | Response |
| --- | --- | --- |
| Create facility | `POST /admin/facilities` | Facility and server-owned lifecycle defaults |
| Facility directory | `GET /admin/facilities` | `facilities`, `nextCursor` |
| Facility detail | `GET /admin/facilities/:facilityId` | `facility` |
| Members and staff | `GET /admin/facilities/:facilityId/members` | `facility`, masked `members`, `nextCursor` |
| Invite operator | `POST /admin/operators` | `requestId`, `status` |
| Invite facility administrator | `POST /admin/facility-admins` | `requestId`, `status` |
| Invite resident/member | `POST /admin/residents` | `requestId`, `status` |
| Enrollment and delivery status | `GET /admin/facilities/:facilityId/invitations` | `invitations`, `nextCursor` |
| Resend invitation | `POST /admin/facilities/:facilityId/invitations/:id/resend` | `requestId`, `status` |
| Revoke invitation | `POST /admin/facilities/:facilityId/invitations/:id/revoke` | `requestId`, `status` |
| Change institutional access | `POST /admin/facilities/:facilityId/members/:id/access` | Masked account state |
| Administrative provenance | `GET /admin/facilities/:facilityId/audit` | `events`, `nextCursor` |

Invitation intake requires an `Idempotency-Key` header of 1–160 characters. The receipt is bound to the submitted identity, role, facility, actor, and key. Repeating that request does not create another enrollment or delivery pair. No global identifier lookup occurs during intake. The API does not disclose whether the supplied email or phone already belongs to an account.

Access changes accept `action` (`suspend`, `reactivate`, or `revoke`) and a nonempty `reason` of at most 500 characters. Invitation resend/revoke also requires a reason. The facility in the route must match the target's current scope. Platform membership actions cannot target platform ADMIN accounts. Revocation removes the facility association and disables the account; reactivation applies only to an accepted membership still attached to an active facility. Restoring a revoked membership requires a separately authorized recovery policy, rather than an implicit transfer.

## Invitation lifecycle

An enrollment request is pending intent, not an account or membership. `requestedRole` is chosen by the backend route, never a public registration parameter. Each enrollment has one EMAIL and one SMS row in the existing `AccountInvitationDelivery` outbox. Tenant and inviter provenance comes from `EnrollmentRequest`; enrollment outbox rows retain null `facilityId` and `userId`, as required by the existing database constraint.

The worker issues channel-specific proofs in memory and stores only their hashes. Provider acceptance yields `SENT`; it does not assert delivery to the recipient. Provider message IDs and attempt counts remain available in the durable outbox for later delivery reporting. Failed provider requests use the existing retry policy. Delayed provider responses cannot overwrite a newer claim.

Both identity proofs and explicit membership consent are required. New users become active only after verification. Existing active accounts must authenticate and accept the proposed membership, with matching email and phone and no cross-facility transfer. A role change invalidates old credentials. Legacy unclaimed staff seats can be recovered through a new invitation and both proofs; their old single activation secret no longer activates staff access.

Invitation status is `VERIFICATION_PENDING`, `ACCEPTANCE_PENDING`, `ACCEPTED`, `EXPIRED`, or `REVOKED`. Resend is serialized with verification and worker claims, requires a five-minute cooldown, and refuses queued/in-flight work, accepted/revoked requests, completed proofs, and exhausted proof attempts. It rotates proofs while retaining the existing channel rows. Concurrent resends cannot enqueue duplicate deliveries. Revocation invalidates all proof and acceptance hashes; already in-flight provider outcomes remain transport history and cannot grant membership.

Recipients complete the flow at `/enroll`. The website bridge keeps returned authentication/acceptance credentials server-side. The Super Admin browser receives receipts and allowlisted state, never an activation secret or invitation URL containing one.

## PII and audit

Default member names and contact identifiers remain masked. Facility directory responses omit contact details. The reveal UI resolves one protected identifier through the existing `/protected-identities/:id/resolve` endpoint, with explicit purpose and case reference. The current PII policy requires the actor's same-facility scope and an independent, unexpired grant. ADMIN does not bypass that policy. Successful reveals use `IdentityResolutionAudit`; there is no bulk plaintext export.

Administrative events retain actor, action, target, facility, timestamp, and lifecycle reason with before/after state. Enrollment events link the enrollment ID, accepted account, requested role and inviter. Avoid placing personal details in administrative reasons.

## Downstream boundaries

Command Center may use accepted `User.facilityId`, `role`, `isActive`, and `accountStatus`, with live backend tenant authorization. Member projections include `membershipState`: `ACTIVE`, `SUSPENDED`, or `PENDING_ACTIVATION`. A revoked membership is absent from the facility member collection and its removal remains in audit. Pending enrollment is separate from membership. Command Center source was not modified.

Future tenant SSO must exclude platform ADMIN, preserve verified enrollment and acceptance provenance, and derive facility scope from accepted membership. No SSO provider, mapping, or login flow is wired here.

Delivery Confirmation should consume the existing enrollment outbox and join `enrollmentId` for facility/role/provenance. Do not equate `SENT` with `DELIVERED`, add a second staff outbox, or infer membership activation from provider success. No Delivery Confirmation implementation is included.

The legacy platform identifier lookup, direct reassignment/removal shortcuts, and raw-token staff provisioning routes are no longer exposed. Existing internal resident-history helpers remain for compatibility. Consumers must use the explicit contracts above.

## Rollout

Apply `20260910120000_super_admin_lifecycle` before starting the changed API/worker. Run the API and worker from the same revision. Configure the existing enrollment encryption key, email/SMS providers, and `OPA_WEB_URL` for recipient links. Existing unclaimed staff seats should receive new verification-first invitations. Do not restore their old token flow. Validation uses local test providers; real provider credentials/delivery are an operational rollout check.
