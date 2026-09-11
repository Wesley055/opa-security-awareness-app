# OPA environment boundary

This package is Node-only. API bootstrap, Expo dynamic config and website upstream resolution use it. Mobile runtime checks use the non-secret values embedded by the verified Expo build.

## Deliberate onboarding gate

trusted-signers.json is empty. No staging endpoint, production secret, cloud ID, actual signing key or deployable environment manifest was created during local implementation. Hosted configurations fail closed until reviewed identities and policies are supplied. Explicit OPA_ENVIRONMENT=development enables local work; this is not an implicit fallback and is rejected for Azure deployments and incompatible EAS profiles.

The signing registry maps environment -> key ID -> Ed25519 public-key PEM. Private signing keys stay in the approved release system. Do not add a test key to this registry. Tests pass ephemeral keys directly to the pure verifier; production entry points always read the checked-in trust registry.

An envelope has keyId, payload (base64 exact UTF-8 JSON bytes) and signature (base64 Ed25519 signature over those exact bytes). Payload requires version=1, environment, purpose (api, migration or endpoint) and expiresAt. Wrong signature, scope, expiry or configuration rejects with a neutral error. No environment variable can supply a replacement verification key.

## API and migration payload

Required shape is demonstrated using ONLY synthetic fixtures in fixtures.cjs. Do not deploy that fixture. The payload binds build to OPA_BUILD_SHA, plus:

- resources.app: environment, Azure resource id, origin; id must equal OPA_DEPLOYMENT_RESOURCE_ID.
- resources.database: environment, Flexible Server resource id, host, numeric port, database, role.
- resources.redis: environment, Managed Redis resource id, host and numeric TLS port. Required in staging; production may omit Redis as before.
- resources.vault: environment, Key Vault resource id, secretOrigin.
- resources.storage: environment, Azure storage account resource id, accountName and container.
- settings: exact environment-variable values or null for absent values. index.cjs exports the complete settingNames list. It includes notification controls, provider scopes, website/SSO origins, PII versions and delivery actor bindings.
- secrets: for each present name in exported secretNames, an environment, vaultId, versioned secretId and SHA-256 of the resolved secret value. Bind the full encryption key ring, not only the active key. Missing/unbound/replaced secrets and unresolved Key Vault expressions reject.
- ssoBindings when enabled: providerType, issuer, audience, callbackUrl, trustSha256 and clientSecretSha256 when applicable. trustSha256 uses recursively sorted JSON object keys; arrays retain order. This binds OIDC endpoints and SAML certificate trust as well as client identity. No production IdP configuration is loaded by default in staging.

DATABASE_URL must use Prisma 6 TLS settings sslmode=require&sslaccept=strict, with no additional query parameters/host overrides. URL identity and exact secret fingerprint are both checked. URLs must contain percent-encoded credentials. Redis uses rediss, explicit bound port and no query/DB overrides. Storage accepts only AccountName, AccountKey, DefaultEndpointsProtocol=https and EndpointSuffix=core.windows.net, with the signed exact connection-string digest.

Use a separately signed purpose=migration policy for the staging migration role. An API policy cannot substitute for it. Both bind the actual staging app target, but the runner must obtain its elevated credentials through a separate least-privileged identity. Runtime role must lack DDL privileges.

Signers must verify Azure resource IDs/ownership, Key Vault provenance, independent secret generation and network/RBAC isolation before signing. These repository checks validate approved bindings; they do not query Azure IAM or prove that a wrongly approved manifest is truthful. Cross-environment secret reuse is rejected when it differs from approved fingerprints or key provenance. Detecting a value deliberately reapproved under a second environment requires release inventory comparison. Never give staging runtime access to production keys to perform that comparison.

## Database identity and readiness

Before Prisma migrations, provisioning must create opa_deployment.environment_identity with exactly one row: singleton=true and environment=staging (production uses production in its independently approved environment). Provisioning owns this schema/table; runtime and migration roles receive SELECT and schema USAGE only. Neither role may UPDATE the sentinel. This provisioning step is outside the application migration chain and is not executed by repository code.

Bootstrap checks the sentinel, current_database() and current_user after URL/policy validation and before importing AppModule. It then checks every active _prisma_migrations row against the full repository migration set/checksum, refusing partial/failed/divergent history. Migration mode permits unapplied migrations before deploy, then requires complete history after deploy. No reset, historical edits or production import utility exists.

## Endpoint payload

purpose=endpoint binds environment, apiOrigin, build, httpsVerifiedAt and expiresAt. Only assign apiOrigin after the actual resource exists and has been approved. Expo hosted config additionally probes /health/environment with TLS certificate verification enabled, no redirects, bounded response/time, and matching environment/build plus migrationReadiness=ready. Website startup performs the same probe. This is not a live check of an API endpoint in this local work.

OPA_ENDPOINT_POLICY_FILE is a reviewed, signed, non-secret file input for mobile/website. EAS preview has no API URL. Set OPA_API_BASE_URL in EAS preview only after staging provisioning and verification. Website uses OPA_API_URL; conflicting API URL variables reject. Never add API/database/provider secrets to EAS or public app extras. The signed endpoint file must be explicitly included in the build input; there is no default path or production fallback.

## Notifications

Staging defaults disabled. To enable tests, the signed settings must explicitly include OPA_NOTIFICATION_MODE=allowlist, OPA_NOTIFICATION_ALLOWLIST_JSON, OPA_NOTIFICATION_MAX_PER_HOUR, OPA_NOTIFICATION_MAX_PER_RUN and OPA_ACCEPTANCE_RUN_ID. Limits are integers 1..999; a reviewed run ID is at most 64 alphanumeric/underscore/hyphen characters. Missing/empty/unusable policies deny sends.

Allowlist keys are EMAIL, SMS and PUSH. Email matches canonical case-insensitively, SMS must be a valid canonical E.164 number, and push requires an exact token. Push/voice/WhatsApp providers remain unimplemented and never manufacture success. Restriction runs in each provider send method, including invitation/recovery callers. Database advisory locking serializes both aggregate hourly and run counters; denied/exhausted sends never call providers. A consumed reservation is not refunded after an uncertain send, preventing retries from exceeding the budget. Changing a run ID requires a newly approved signed policy. Quota store failure denies sending. Expired hourly counters can later be purged under a staging-only retention job; active run counters must not be reset during a run.

Denials return success=false, retryable=false, REJECTED and no messageId. The durable ledger records ENVIRONMENT_POLICY_DENIED and FAILED; it does not create accepted/delivered timestamps or undo already verified delivery. Diagnostics/startup logs identify the environment and notification mode without recipients, keys or connection strings.

## Production rollout dependency

Existing production notification semantics and optional Redis behavior are retained after valid configuration. Missing classification now intentionally rejects startup, including production. Do not deploy this code until production has a reviewed signed policy, independently verified key/resource provenance, a read-only identity sentinel and the complete migration chain. The existing production migration guard is unchanged. Actual production configuration has not been modified.
