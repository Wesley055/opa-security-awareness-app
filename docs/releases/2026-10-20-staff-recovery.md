# Release: staff password recovery by code (database 46 → 47)

Owner decision, 20 Oct. In **My profile → Account security → Change password**, "Forgot your current password? Get a code instead" sends:
- **Operators:** a 6-digit SMS code.
- **Facility Admin, Technical Support, Super Admin, Head Office:** an SMS code **and** an email code. Both are required.

Codes last 10 minutes. Five wrong tries locks the code, there are at most 3 requests an hour, and codes are stored only as keyed HMACs. On success every session is signed out, and the change is audited as `STAFF_PASSWORD_RECOVERED`. If you're signed out, the existing email reset link still works. If you've lost your email or phone, use administrator-assisted recovery.

Migration `20261020220000_staff_recovery_codes` is additive: one table, `StaffRecoveryCode`.

Package `opa-release-db-47.zip` (SHA-256 `e34699acb8afaf44347fef661f4639ac3d4235a746727d6995f60bbf633bcc95`):
- `activate.sql` `a88b43b9…` (unchanged);
- `cleanup.sql` `1391ebf9…` (release 46 cleanup plus StaffRecoveryCode);
- migration `b7198b35…`.

Rehearsed on the production-like database at 46: migrator-owned objects 0, the table is owned by the release owner, the runtime can write to it, and the migrator is no longer a member of the owner role. If `migrate` fails, `resolve` marks that one attempt as rolled back, as it did for release 46.

## Steps
1. **Window 1:**
   ```powershell
   cd C:\Projects\OPA-release-simplification
   git pull --rebase --autostash
   powershell -ExecutionPolicy Bypass -File .\ops\production-release\release-api.ps1 -PreviousPolicy ".\artifacts\release-0baa72b\api-release-0baa72b.signed.json" -DbPackage "$env:USERPROFILE\Downloads\opa-release-db-47.zip" -DbPackageSha e34699acb8afaf44347fef661f4639ac3d4235a746727d6995f60bbf633bcc95
   ```
   Expect `MIGRATIONS=47`. It pauses at 4b/7.
2. **Window 2:** `az webapp ssh -g opa-production -n opa-api-production`, then:
   ```bash
   cd /home/opa-release-duty && /usr/local/bin/node opa-release-db.cjs check
   ```
   Expect `READY true` and `NEXT activate`. Then:
   ```bash
   cd /home/opa-release-duty; echo "RESTORE_POINT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   /usr/local/bin/node opa-release-db.cjs activate && /usr/local/bin/node opa-release-db.cjs migrate; /usr/local/bin/node opa-release-db.cjs cleanup; /usr/local/bin/node opa-release-db.cjs verify
   ```
   Expect `VERIFY PASS` with `ledgerApplied: 47` and `recoveryTableOwnedByReleaseOwner: 1`.
3. **Window 1:** type `VERIFY PASS`.
4. **Vercel:** promote the newest Ready deployment.

The release script uploads the package to `/home/opa-release-duty`, which replaces the release 46 runner there.
