# OPA Production Release Authority

## Status

This document is the canonical non-secret continuity record for OPA production release authority, signed endpoint policy issuance, signer rotation and handover.

Future engineers and handovers MUST use this document as the starting point. Do not reconstruct production release authority from historical handovers, shell history, chat history or old build artifacts unless this document explicitly directs an investigation.

Private signing material MUST NEVER appear in Git, handovers, screenshots, logs, tickets, documentation or chat.

## Mandatory handover contract

Every OPA engineering/release handover MUST contain a section titled:

`Production Release Authority`

That section MUST reference this runbook and carry forward the current:

- active production signer keyId
- signer enrollment/rotation commit
- signer custody mechanism by NON-SECRET reference only
- active endpoint-policy repository path
- endpoint-policy SHA-256
- bound application/API build SHA
- production API origin
- httpsVerifiedAt
- expiresAt
- endpoint verification result
- migration/readiness state
- renewal/rotation status
- unresolved signer/policy risks
- rollback/checkpoint reference

A handover missing this section is incomplete.

Do not duplicate private material into a handover.

## Production API origin

Canonical production API origin:

`https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net`

Observed on 2026-10-06:

- Azure App Service state: Running
- HTTPS-only: true
- Runtime: Node 22 LTS

## Historical production signer

Historical signer keyId:

`opa-production-release-20260919`

Signer enrollment commit:

`dd8277f744471b0ce5242194dbc3c3e728ad36b0`

Commit subject:

`security(production): enroll release policy signer`

The public key remains in:

`packages/environment-policy/trusted-signers.json`

Do not delete this public signer merely because its private authority is unavailable. Historical signed policies must remain verifiable.

## Historical endpoint policies

### Original vc20 policy

The original production endpoint policy was introduced by:

`b5e43c8d456d87b023c03b00e0bedc63ba40dddb`

Commit subject:

`release(android): bind vc20 to verified production endpoint`

The committed policy was bound to build:

`dd8277f744471b0ce5242194dbc3c3e728ad36b0`

It expired on 2026-09-27 and MUST NOT be reused or edited.

### Recovered b02a851 policy

Historical artifact:

`C:\Projects\OPA\packages\environment-policy\release\production-endpoint-b02a851f6fbe.json`

Verified non-secret metadata:

- keyId: `opa-production-release-20260919`
- version: 1
- environment: production
- purpose: endpoint
- build: `b02a851f6fbe369661e3e3fc68d02898851278ba`
- apiOrigin: `https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net`
- httpsVerifiedAt: `2026-09-21T23:25:47.638Z`
- expiresAt: `2026-10-05T23:59:59.000Z`
- envelope SHA-256: `F1E25519D6E58C715680525C293EB572060ACFBBC9194D5FD2A2D0ACFA04773E`

On 2026-10-06 the normal endpoint verifier failed closed against this expired policy with:

`OPA HTTPS/environment verification failed`

and exit code 1.

This is expected fail-closed behavior, not evidence of application breakage.

Never extend its expiry, modify its payload/signature, or copy it over the active policy as a renewal mechanism.

## Historical authority recovery conclusion

Production release worktree recovered:

`C:\Projects\OPA-production-release`

It is pinned at:

`dd8277f744471b0ce5242194dbc3c3e728ad36b0`

The private signing authority corresponding to:

`opa-production-release-20260919`

was NOT recovered.

Searches included:

- production release worktree
- `%LOCALAPPDATA%\OPA`
- `%APPDATA%\OPA`
- likely signer/key filenames
- files modified around signer enrollment
- PowerShell command history
- Git history
- historical endpoint artifacts

Only the staging DPAPI authority was recovered.

Historical recovery is CLOSED unless new concrete evidence appears. Do not repeat broad filesystem/Git/PowerShell archaeology during a future release merely because the old private authority is unavailable.

## Staging precedent — not production authority

A staging-only DPAPI-protected authority exists at:

`%LOCALAPPDATA%\OPA\Staging\ReleaseAuthority-20260913\authority.dpapi`

This is NOT a production signing authority.

The staging implementation demonstrates required security properties for production tooling:

- Ed25519 signing
- private authority protected at rest
- public-key fingerprint validation
- recovered private/public key equality verification
- exact source/build binding
- bounded policy expiry
- immediate signature verification
- exact written-payload verification
- policy/envelope SHA-256 recording
- non-secret issuance receipt
- fail-closed errors

Do not use the staging private authority to sign production material.

## Production signer rotation — 2026-10-06

Reserved successor keyId:

`opa-production-release-20261006`

Repository search confirmed this identifier was unused before rotation work began.

The existing verifier already supports additive signer rotation using:

`keys[environment][envelope.keyId]`

The historical signer MUST remain registered alongside the successor signer.

Rotation safety tests were added and passed 26/26 before any real successor authority was generated.

Test commit:

`a53fc8e`

Commit subject:

`test(security): prove production signer rotation boundaries`

The tests prove:

- historical and successor production signers can coexist
- both explicitly enrolled production signers can validate their own signatures
- unknown key IDs fail closed
- signer-ID substitution fails
- staging signer cannot authorize a production policy

## Pre-rotation rollback checkpoint

Annotated Git tag:

`pre-production-signer-rotation-20261006`

Peeled commit:

`bb914440df309c8fa01867be7c1348ba14d77d4f`

The annotated tag was verified both locally and remotely.

## Private authority Git protection

Commit:

`f8ed265`

Commit subject:

`security(release): prevent private authority artifacts entering git`

Repository ignore protections include:

- `.local/release-authority/`
- `*.private.pem`
- `*.private.key`
- `*.authority.dpapi`

The real production authority must live outside the repository in protected local/approved release-system storage.

These ignore rules are defense in depth, not permission to store production private material inside the repository.

## Endpoint policy security contract

Production EAS/website release configuration consumes a reviewed signed endpoint policy through:

`OPA_ENDPOINT_POLICY_FILE`

Non-development policy verification is fail closed.

The signed endpoint payload binds at least:

- version
- environment
- purpose
- apiOrigin
- build
- httpsVerifiedAt
- expiresAt

Do not:

- manually edit expiry
- manually edit build binding
- manually edit httpsVerifiedAt
- alter signed payload bytes
- replace signatures
- bypass `verify-endpoint.cjs`
- introduce an unsigned production fallback
- supply a verification key through an environment variable
- commit private signing material

## Production database evidence — 2026-10-06

Azure PostgreSQL Flexible Server:

`opa-api-production-server`

Resource group:

`opa-production`

Observed:

- state: Ready
- PostgreSQL: 14
- region: South Africa North
- storage: 128 GiB
- SKU: Standard_B1ms
- public network access: Disabled
- backup retention: 7 days
- earliest observed PITR: `2026-09-30T08:44:02.038370+00:00`
- HA: NotEnabled

`Ready` does not prove migration readiness, sentinel correctness, runtime role correctness or application readiness.

HA NotEnabled is a tracked resilience item and must not be silently represented as highly available.

## Migration state

Current release candidate contains 42 migration directories.

Candidate tail currently includes:

- `20260922230000_bounded_onboarding_authority`
- `20260928010000_support_role`
- `20260928010100_institutional_authority`
- `20260929090000_support_enrollment_provenance`
- `20260930010000_canonical_organization`
- `20260930010100_operational_response_policy`
- `20261004010000_reporting_foundation_reconciled`

The release ledger previously identified a seven-migration production plan.

That does NOT prove production currently has 35/42 migrations.

Production migration state MUST be measured read-only before migration authorization.

Do not run production migrations merely from this document.

## Production migration rule

MIGRATE BEFORE DEPLOYING new code that depends on the new schema.

The historical App Service SSH migration method depended on accidental runtime state where Prisma dev dependencies survived an old deployment. That method is not the desired permanent architecture and must not be treated as a canonical production runbook.

Production migration execution requires a reviewed migration/cutover/recovery procedure inside the production private network.

Never use:

- `prisma db push`
- database reset
- historical migration edits
- fabricated migration history
- manual migration-history repair without an approved incident/recovery procedure

## Production policy issuance checklist

Before issuing a new production endpoint policy:

1. Confirm approved release candidate SHA.
2. Confirm production signer is explicitly enrolled.
3. Confirm protected private authority matches the enrolled public key.
4. Confirm production API resource/origin.
5. Confirm production database migration/readiness state.
6. Verify HTTPS/TLS without disabling certificate validation.
7. Verify `/health/environment`.
8. Require matching production environment.
9. Require matching build SHA.
10. Require `migrationReadiness=ready`.
11. Create a short-lived endpoint payload.
12. Sign exact UTF-8 payload bytes with Ed25519.
13. Independently verify the signature immediately.
14. Verify exact bytes written to disk.
15. Record policy and envelope SHA-256.
16. Record `httpsVerifiedAt` and `expiresAt`.
17. Produce a non-secret issuance receipt.
18. Consume through `OPA_ENDPOINT_POLICY_FILE`.
19. Verify EAS/website configuration fails closed with expired/tampered/wrong-signer policies.
20. Archive only non-secret release evidence.

## Current unresolved items

As of 2026-10-06:

- historical production private authority: NOT RECOVERED
- successor production authority `opa-production-release-20261006`: NOT YET GENERATED
- successor public key: NOT YET ENROLLED
- fresh production endpoint policy: NOT YET ISSUED
- live production migration count for the 42-migration candidate: NOT YET MEASURED
- migration/cutover/recovery authorization: PENDING
- iOS successor build after Apple build 5: PENDING

Update this section as each gate closes.

## Handover rule

Every future OPA handover MUST:

1. include a `Production Release Authority` section;
2. link/reference this runbook;
3. carry forward current non-secret signer/policy/build/expiry/hash/status values;
4. explicitly list unresolved release-authority risks;
5. never include private authority bytes, passwords, tokens, secret values or recovery material;
6. never restart historical authority archaeology unless new concrete evidence exists;
7. update this canonical runbook when release-authority architecture changes.

This requirement is mandatory.
