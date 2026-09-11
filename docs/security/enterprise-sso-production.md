# Enterprise SSO production integration

Baseline: integration/institutional-security at 360b853b1d2dc4e2ba650e33f7ba36eba7ad0ffe.
The SSO source worktree at 58b517270b8d7cc9aa6c850cd8ea9788dddf2ffd supplied policy
contracts only. No branch was cherry-picked. This change must not be deployed
before the forward migration and environment/IdP configuration are reviewed.

## Authority and persistence

OidcProtocolVerifier and SamlProtocolVerifier implement ProtocolVerifier.
The shared verifySsoCallback coordinator checks server-loaded transaction binding
before and after protocol verification. SsoService then rechecks configuration
revision, account, Facility membership, and exact identity under PostgreSQL locks.
It uses the same per-user advisory lock as institutional membership changes.
Successful completion, replay insertion, transaction consumption, mapping creation
when linking, and success audit are one database transaction. The only session
issuer is the existing AuthService.issueTokens. Existing JwtStrategy and refresh
rotation continue to enforce credentialVersion.

Facility is the authoritative tenant. User.facilityId is the existing membership;
there is no parallel membership or session table. A browser configuration UUID
selects a connection; it cannot supply tenant authority. Account activation,
isActive, active Facility, matching membership, and OPA role are independently
checked. ADMIN is always excluded from tenant SSO. Platform administrators can
configure tenant connections through their existing local platform authentication.

The new forward migration adds SsoConfiguration, SsoExternalIdentity,
SsoTransaction, SsoReplay, and SsoAuditEvent. Existing records are not rewritten.
Composite foreign keys bind transactions and identities to the configuration's
Facility. Unique identity and replay keys make concurrent consumption fail closed.
Mapping owners are never updated or reassigned; unlink retains a disabled
tombstone. There is no delete/relink or JIT endpoint. Recovery continues through
the existing local account process.

## Environment and secrets

API:

- SSO_WEB_ORIGIN: exact HTTPS website origin, without path or trailing slash.
- SSO_ENCRYPTION_KEYS: JSON object with active key version and keys map. Each
  key is 32 random bytes encoded as 64 hexadecimal characters. Provision through
  the existing secret-management system, never through browser configuration.
- SSO_LOOKUP_KEY: separate 32 random bytes in hexadecimal for stable exact-identity
  HMAC lookup. Preserve this key; changing it requires a separately reviewed
  mapping reindex operation.

Website: set the identical SSO_WEB_ORIGIN and existing OPA_API_URL.

Provider client secrets, raw expected nonce, PKCE verifier, pending verified link
proof, and external identity are AES-256-GCM envelopes with versioned keys and
record-specific authenticated context. Retain old decryption keys when rotating
the active encryption version. Configuration reads never return secrets,
certificates, ciphertext, or key references. Identity lists return opaque mapping
IDs and lifecycle state only. No provider tokens/assertions enter the OPA session.
Consumed transactions clear sensitive transient fields. Expired transactions and
replay rows remain inert; retention/purge is an operational database maintenance
task, and must never remove live replay entries or mapping tombstones.

## Configuration API

Use the existing authenticated API, without exposing administrator bearer tokens
in scripts, URLs, logs, or documentation:

- POST /sso/facilities/:facilityId/configurations creates a connection.
- PUT /sso/facilities/:facilityId/configurations/:id updates trust/enabled state
  with expectedRevision. Protocol, issuer, audience, and Facility are immutable.
- GET /sso/facilities/:facilityId/configurations returns sanitized configuration.
- GET /sso/facilities/:facilityId/audit returns the latest 100 tenant audit events.

Only ADMIN or the matching FACILITY_ADMIN may administer a connection. Bodies are
strictly validated; bypass flags and JIT flags are rejected.

OIDC input contains providerType OIDC, exact issuer, audience/client ID, enabled,
clientSecret, and trust with discoveryUrl, authorizationEndpoint, tokenEndpoint,
jwksUri. Discovery uses the standard OIDC path for the exact approved issuer.
Metadata must exactly match each administered endpoint and advertise S256.
ClientSecretBasic and RS256 are the supported profile; unsupported IdP profiles
fail closed and need review, not a verification exception.

SAML input uses providerType SAML2, exact IdP issuer/entity ID, audience/SP entity ID,
enabled, and trust with authorizationEndpoint and one to three independently
administered PEM signing certificates. Certificates must be currently valid RSA
keys of at least 2048 bits, including during verification. Metadata upload cannot
enroll keys. Rotation is an explicit revisioned configuration change.

Any configuration update increments revision, invalidates pending callbacks and
local discovery cache, and increments credentialVersion for enabled mapped
non-platform users. This deliberately revokes their existing OPA sessions across
login methods. A historic tenant mapping cannot revoke a promoted ADMIN's platform
session. Unlink requires fresh local password verification, disables the mapping,
and increments that user's credentialVersion atomically with audit.

## Browser and account-linking flow

Institutional sign-in links use /api/sso/initiate?configurationId=<connection UUID>.
The server sets a five-minute Secure, HttpOnly, SameSite=None, __Host-opa_sso
correlation cookie. Both protocols return to /api/sso/callback. The callback
exchanges verified identity for the existing OPA access/refresh session and stores
it through the existing operator-session cookie bridge. Command Center admits its
existing FACILITY_OPERATOR/FACILITY_ADMIN roles; no platform session is created.

Linking starts with a same-origin form POST to /api/sso/initiate containing
configurationId and password while locally authenticated. The API rechecks the
password/account and binds the transaction to the exact original bearer session,
credentialVersion, target user and Facility. It does not trust provider email.
After cross-site IdP return, encrypted proof is staged server-side; the user
completes the same-origin POST at /operator/sso/complete. This preserves the
existing Strict session cookies. The final transaction checks the original local
session and proof freshness before inserting a previously unowned identity.
No client can replace the target user or tenant in this flow.

Authenticated API clients can use /sso/configurations/:id/link and
/sso/link/callback, or staged /sso/link/finish. GET /sso/identities lists the
caller's opaque mappings. POST /sso/identities/:id/unlink accepts a fresh password.
Unlinking requires local sign-in again because it revokes the current session too.

## Protocol security profile

OIDC uses openid-client directly with enableNonRepudiationChecks, code flow,
S256 PKCE, required ID token, expected nonce and state, exact issuer,
audience/azp, asymmetric RS256 signature, and time checks. It never trusts a
decoded token or token-supplied key URL. The original nonceHash policy remains.
The library handles JWKS rotation with a bounded refresh cooldown (60 seconds);
new unknown keys during cooldown fail closed. Configuration cache is bounded to
256 entries and five minutes. The new revision is rechecked before issuance.

Outbound access is exact-endpoint HTTPS only on port 443. All resolved IPv4
addresses must be public; the connection pins the checked address and retains TLS
hostname verification. Redirects and compressed responses are rejected. There is
a five-second absolute deadline, 16 KiB outgoing body limit and 1 MiB incoming
limit. IPv6-only and private-network IdPs are outside this approved profile.

SAML uses node-saml/xml-crypto signature verification, requiring both response
and assertion signatures and InResponseTo always. Preflight delegates XML parsing
to xmldom and rejects DTD/entities, malformed XML, duplicate/ambiguous IDs,
comments/CDATA in content, multiple assertions, encrypted assertions, and remote
key retrieval. Limits are 64 KiB decoded XML, 2,000 elements, depth 32, 24
attributes per element, and bounded values. Only RSA-SHA256, SHA256 digests,
exclusive canonicalization, and the enveloped-signature/exclusive transforms
are accepted. Identity is extracted only from node-saml's verified assertion.
Persistent NameID, issuer, audience restrictions, bearer recipient, correlation,
and assertion/subject-confirmation time limits are mandatory. Response and
assertion replay IDs have separate issuer-wide durable namespaces.

Transactions and local reauthentication last at most five minutes, with one clock
sample defining their lifetime. Assertion age/lifetime is bounded; expiry is never
extended. SAML uses zero clock-skew allowance. Synchronize server and IdP clocks.
Unsigned, encrypted-SAML, nonpersistent-NameID, SHA-1, unsupported transforms,
and unsupported provider profiles are denied rather than downgraded.

## Audit, PII, and dependency evidence

Success audit commits atomically with security mutations. Authentication failure,
link completion failure, denied configuration changes, and denied unlink attempts
write durable fixed-shape events. Events contain opaque references and action/state,
not subjects, email, raw XML/JWT, credentials, or provider error bodies. This
integration introduces no reveal endpoint and preserves existing PII reveal policy.

Direct approved adapters: openid-client 6.8.8 and @node-saml/node-saml 5.1.0.
Reviewed components are pinned through overrides: jose 6.2.12, oauth4webapi 3.8.8,
xml-crypto 6.1.2, @xmldom/xmldom 0.8.15. xmldom is also an explicit production
dependency for XML preflight; xml-crypto is explicit test tooling for signed
fixtures. The resolved SSO tree is MIT except sax (BlueOak-1.0.0).
Retain distributed license files/notices. See sso-dependency-evidence.json for the
resolved tree, licenses, audit findings, and unchanged preexisting versions.

The repository audit reports 37 findings (4 low, 14 moderate, 18 high, 1 critical),
with none in the resolved SSO tree at review time. No unrelated package version
was changed and no automatic audit fix was run. Broader production release
requires disposition of these existing findings.

## Reproducible artifact and validation

The production workflow now runs npm run artifact:production. The assembler keeps
root/API workspace manifests and the root lockfile, installs with npm ci
--omit=dev, generates Prisma Client using the build's installed CLI, and verifies
every installed version/integrity against the source lock and installed versions.
It rejects a changed lock or missing expected entrypoint. The API build explicitly
includes src and fixes rootDir so npm start resolves apps/api/dist/main.js.
The existing migration deployment guard is retained.

Local API runtime is Node 26.5.0. Website tests passed on available Node 24.19.0
after Node 26 worker-start timeouts. CI retains Node 22.x and root engines require
Node >=22.12.0 for native require(ESM). Jest 29 uses a test-only syntax transform
for the three approved ESM packages; production does not use that transform.
The deploy artifact excludes tests and fixture keys.

Tests use actual RSA-signed OIDC tokens and dual-signed SAML XML. Only IdP network
transport is simulated; signature validation is real. The PEM key in test/sso
is public test material and must never be trusted by a production IdP configuration.
PostgreSQL tests use the guarded opa_test database and real forward migrations,
not db push. Do not run the destructive test harness against an application DB.

Live institutional IdP interoperability, production network egress, secret
provisioning, Azure startup/runtime settings, and production migration execution
are release gates. They were not changed or deployed by this implementation.

## Executed acceptance evidence

- Focused SSO: 125 tests across policy, OIDC, SAML, encryption and bounded network
  suites; included in the passing full API run (88 suites, 837 tests).
- PostgreSQL 16.14: all 16 suites and 166 tests passed, including 21 SSO cases,
  concurrent SAML callback consumption, response/assertion replay, OIDC replay,
  exact mapping, linking, suspension, epoch revocation and tenant regressions.
- Website: all 35 files and 133 tests passed on Node 24.19.0 with
  --pool=forks --maxWorkers=1 --no-file-parallelism.
- API/website changed-file lint passed. Prisma generation and validation passed.
- Two clean local production dependency installations each verified 330 packages
  against lock SHA-256
  990daece4d5904c6b2c18ef2a90f877c86b62bbdddf3e5d7d8a033cf1390ee8f.
  The final artifact uses the corrected deterministic entrypoint.

Earlier failed attempts were not acceptance passes: an unsupported Node type
option, incomplete network fixture typings, website worker-start errors, a
temporary local PostgreSQL connection failure, and independently sampled link
timestamps were corrected or rerun as described above. No signature check was
relaxed to make tests pass.
