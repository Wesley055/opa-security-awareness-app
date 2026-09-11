# Command Center reconciled contracts

Integration: `integration/institutional-security`, baseline `cf21ec39555b9a66cc272143a385070fe53e1756`.
Source: `codex/command-center-production`, HEAD `58b517270b8d7cc9aa6c850cd8ea9788dddf2ffd`, **plus its uncommitted production UI**. The HEAD alone does not contain that UI. Files were selected and reconciled; no cherry-pick was performed.

## Institutional authority and administration

`Facility` and accepted `User.facilityId` remain the tenant boundary. The browser has no role, membership, organization, or product-profile authorization authority. Operator queue and membership requests do not accept a selected facility. Incident IDs select a resource; the API must authorize that resource on every read. The context polling boundary clears previously displayed data on rejected access or a changed account/facility/role. Its scope comparison is presentation invalidation, never a replacement for API guards.

Command Center's platform navigation targets the current `/super-admin` workspace. Its facility directory/detail, member and staff state, pending enrollment, durable invitations, suspension/revocation and provenance remain the existing production implementation. No legacy `/operator/admin` backend, staff activation flow, direct identity lookup or reassignment shortcut was imported. Facility administrators keep the current verification-first resident UI. Recipients use `/enroll` and both ownership proofs plus consent.

The authoritative administrative contract is `docs/SUPER_ADMIN_CONTRACT.md`: `/admin/facilities`, facility detail, `/members`, `/invitations`, `/audit`; staff intake at `/admin/operators` and `/admin/facility-admins`; invitation resend/revoke and member access actions. Intake uses `Idempotency-Key`. Browser receipts are allowlisted `requestId` and state, without activation secrets. Pending requests are distinct from accepted memberships. Revoked memberships disappear from the member list and retain audit provenance.

The operator and Super Admin consoles retain their existing separate HttpOnly cookie namespaces and sign-in routes. Navigating between consoles can require the appropriate existing sign-in; no token transfer or new authentication scheme was introduced.

## Protected identity

Institutional readers consume masked backend projections. Authentication alone grants no plaintext contact access. The existing Super Admin reveal submits an opaque identifier, `SUPPORT_CASE` or `ACCOUNT_RECOVERY`, and a UUID case reference to `/protected-identities/:id/resolve`. Same-facility membership, an independent live grant and durable resolution audit remain mandatory, including for ADMIN. There is no new reveal path, automatic grant, bulk export, raw-token display or plaintext identity fallback.

## Incident operations

The queue uses `/operator/incidents` with server-issued cursor pagination. Detail, tracking, timeline and timeline integrity verification use the current guarded incident routes. Loading, rejected access, unavailable service and confirmed empty data remain distinct. Polling stops on rejected access. Operators receive no invented acknowledgement or closure authority: acknowledgement is unavailable and closure remains owner-only under the current API lifecycle.

Evidence metadata uses the existing guarded reader. Verified downloads retain the source's server-side Azure read-grant validation, bounded 50 MiB download and SHA-256 comparison. Signed storage URLs are not exposed to the browser. Matching the recorded hash does not establish independent authenticity. The upstream evidence list is not paginated; browser pagination does not solve that upstream bound. Production Azure grant compatibility and real evidence transfer remain live validation requirements.

## Delivery Confirmation adapter

`apps/website/src/lib/delivery-confirmation.ts` defines the consumer boundary. The incident screen currently renders `BACKEND_BLOCKED`. No delivery reader has been invented or notification backend duplicated. Enrollment invitation `SENT` is provider acceptance, never confirmed delivery.

For the owning lane's future reconciliation, the required consumer shape is `{state:'READY',incidentId,asOf,attempts,nextCursor}`. Each bounded attempt needs `id`, `channel`, server-masked `recipientMasked`, `state`, `providerReference`, `failureClass`, `attemptCount`, `queuedAt`, `acceptedAt`, `deliveredAt`, `failedAt`, `updatedAt`, and nullable `deliveryProof:{source,receivedAt}`. Supported states are QUEUED, PROVIDER_ACCEPTED, DELIVERED and FAILED. Unknown timestamps remain null. The owning API must establish incident authorization, pagination, receipt provenance and semantics. A delivered claim without proof is withheld. Implement a validated server adapter and cursor loading when the authoritative reader lands; changing a flag is insufficient.

## OPA Insight consumer requirements — proposed, not implemented

The four reporting areas are explicit unavailable shells. No endpoint below is asserted to exist. The future reporting owner must ratify route names and supply these bounded, authorized contracts before the UI can call them:

| Operation | Required response and behavior |
| --- | --- |
| List reports by cursor and bounded limit | `{items:[{id,kind,status,createdAt,updatedAt}],nextCursor,asOf}`; no fabricated report or estimated completion |
| Report detail | `{id,kind,status,version,generatedAt,coverage:{from,to,completeness},provenance,incidentReferences,evidenceReferences,confirmedOutcomes}`; unknown outcomes explicitly unknown |
| Request generation / read status | Idempotent request receipt `{requestId,status}`; status QUEUED/RUNNING/READY/FAILED, stable report reference only when available; safe failure classification |
| Aggregate query | Authorized window/filter input; `{asOf,window,coverage,provenance,measures}` with units, numerator/denominator where relevant, source counts and suppression/unknown semantics |
| Corrective action list/create/update | Bounded cursor reader; `{id,status,assigneeReference,dueAt,version,createdAt,updatedAt,provenance}`; guarded mutations with reason and expected version; conflict response and durable audit |

Every operation derives tenant authority server-side, denies cross-tenant access, returns masked references, sets no-store where private, and distinguishes empty success from unavailable service. No organization domain or browser product profile may substitute for accepted facility membership. Browser form selection is a resource/filter input only. Reporting requires a separate implementation and institutional validation.

## SSO-facing session assumptions

SSO must finish at the existing OPA server-side session issuance boundary. Bind a verified issuer and immutable subject to a stable OPA user through approved institutional mapping; matching mutable email alone is insufficient. Preserve verification-first enrollment/consent and accepted facility membership. Tenant federation must exclude platform ADMIN.

The current API validates a bearer JWT signature/expiry and `sub` against the database; the user must exist, be active, have ACTIVE account status and a matching `credentialVersion` (missing token version currently means zero). The API returns current database role instead of trusting a stale role claim. Resource guards re-read current facility/role authority. SSO must issue the same OPA access and refresh credentials through existing session functions, not put IdP tokens into these cookies or turn IdP group/facility claims into authorization.

The website keeps `opa_operator_access`/`opa_operator_refresh` in HttpOnly, SameSite=Strict, path=/ cookies, Secure in production, with existing 15-minute/30-day lifetimes. Platform administration uses `opa_super_admin_access`/`opa_super_admin_refresh` separately. Access failures use the existing refresh flow. The callback must establish its own server-side state/nonce/PKCE protection as appropriate; Strict cookies cannot be assumed present on cross-site callbacks. No SSO provider, issuer mapping, callback or federation model is implemented in this reconciliation.

## Validation boundary

Unit/component tests and isolated browser fixtures are test assets only. They are never imported into production application code. PostgreSQL tests use the existing guarded `_test` database harness and actual migrations. Browser tests prove layout/interactions against isolated response fixtures, not real providers, federation, reporting or live institutional E2E. Delivery, reporting and SSO remain independently owned integrations.
