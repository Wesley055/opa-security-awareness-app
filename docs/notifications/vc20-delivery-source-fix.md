# VC20 notification source fix

Scope: source only. No credentials, grants, production records or infrastructure changed. Historical FAILED notifications are not requeued by this change.

## Supported intents

The existing live/allowlist notification mode and real adapter configuration define capability. delivery-capabilities.ts centralizes the checks; no new environment variable is introduced. SMS still requires receivesEmergencySms. Email requires both existing Resend settings. WhatsApp, push and voice remain explicit non-sending adapters and are not supported contact activation channels. Existing unsupported rows remain untouched.

## Protected readiness and claims

An incident worker resolves the immutable, source-bound protected snapshot, including DELIVERY authorization, decryption and committed resolution audit, before attempting the existing atomic ledger claim. Failure logs a bounded code and leaves the row QUEUED without consuming an attempt. No plaintext fallback exists. Multiple ready workers may each create a legitimate resolution audit, but only the winner of the existing row-lock claim may invoke the provider. The payload remains internal and ephemeral. Lease, stale-attempt UNKNOWN semantics, late provider evidence and receipt reconciliation remain unchanged.

Workers skip already visited IDs within each tick so a deferred row cannot consume an entire batch. Permanently broken protected work also stays queued and needs operational investigation; deferral is not evidence that a row will eventually succeed. Deferred diagnostics are operational logs, not fabricated provider attempts. Missing institutional snapshots still fail closed and never send plaintext.

## Safe evidence

Delivery failures carry allowlisted internal codes; original messages/stacks and payloads are never persisted. WeakMap tagging preserves generic client-facing exceptions. Crypto, audit insertion and audit commit failures remain distinct. DeliveryStatusEvent.source records PRE_PROVIDER, PROVIDER_REQUEST, PROVIDER_RESPONSE or conservative DISPATCH for older unannotated adapter results. Its reason stores an allowlisted diagnostic; lastError remains the existing category.

Every claim transaction appends a WORKER event with an opaque per-process UUID in reason, linked to the attempt. Deferred logs carry the same UUID. This fits existing source/reason columns; no migration is needed. It distinguishes processes without exposing hostnames, credentials or instance secrets. Historical attempts cannot be attributed retrospectively.

## Deployment and retest (not executed)

1. Review the complete incremental diff and isolated tests. Commit/build only after approval.
2. Use the existing production release procedure. The signed policy must bind the new build; preserve all unrelated settings and secret/resource bindings. No new channel switch or provider credential change is needed.
3. This patch cannot change the behavior of already running pre-fix binaries. The first rollout must account for old workers; do not begin the controlled SOS gate until they have exited and readiness is stable. Do not manually resend or repair historical rows.
4. Read-only verification: intended build/policy, live SMS configuration, actor/grants, crypto, no unexpected backlog/sends, and a separately approved test subject with zero OPEN incidents. The current incident must not be resolved as part of this source task.
5. Only on separate authorization, one foreground physical SOS. Verify HTTP success, one OPEN incident, location, protected SMS snapshot, one claimed attempt/provenance, provider acceptance and the actual intended recipient outcome. No WhatsApp intent; email only when configured and a recipient exists.
6. On separate authorization, I'm Safe resolves that same test incident; then evaluate Play submission. Provider acceptance alone is not handset delivery.
