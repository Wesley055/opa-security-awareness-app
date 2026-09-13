# Post-migration validation

The runtime database has 35 verified applied migrations. Use the protected `mode: validation` trigger for this gate. It requires a `migration-validation` runner lease and distinct `VALIDATE_MIGRATED_OPA_STAGING` authorization, all bound to the new commit. `execute: true` permits disposable test-database custody, not runtime migration in this mode.

Validation checks the runtime sentinel, identity/address, committed history/checksums and schema in a read-only transaction. A fresh `staging-migrate.cjs --verify-only` process runs Prisma preflight without any migrate command. Only successful runtime verification permits creation and validation of `opa_staging_test`. Existing custodian and runner cleanup remain mandatory.

The prior deployment command exited zero and all 35 migrations applied. Reconnection failed before cleanup; the retained network timeline rules out early NSG removal. The exact underlying connectivity cause is unproven. The wrapper now awaits an asynchronous Prisma child instead of blocking the Node event loop between Prisma client lifecycles. Verification uses a fresh process in this validation path. No automatic retry or SQL change is introduced.

Evidence/Insight isolated-branch work is not in the current release branch; do not claim it was validated. Production, notification and SSO boundaries remain unchanged.