# Release: EstateFlow + mobile builds (17 Oct 2026)

Build: `wip/release-simplification-20261015` at `fdaf7de` or later. Database: 44 → 45 (`20261017200000_estateflow_visitor_passes`).
Database package: `opa-release-db-estate.zip` (SHA-256 `46ea86a5…587c0e`): runner + `activate.sql` (`a88b43b9…`, unchanged) + `cleanup.sql` (`553efa3e…`, adds the new tables and enums) + migration + schema.

**Order matters:** once migration 45 is applied, the running API (`d032e66`) keeps working but cannot restart. Steps 5–7 run back to back.

## 1. Pull and build (PowerShell)
```powershell
cd C:\Projects\OPA-release-simplification; git pull
$build = git log -1 --format="%H"; $short = $build.Substring(0,7); "BUILD=$build"
$dir = ".\artifacts\release-$short"; New-Item -ItemType Directory -Force $dir | Out-Null
docker run --rm -v "C:\Projects\OPA\.git:/repo.git:ro" -v "$((Resolve-Path $dir).Path):/out" node:22-bookworm bash -c "set -e; apt-get update -qq && apt-get install -y -qq zip >/dev/null; git config --global --add safe.directory '*'; git clone -q /repo.git /work; cd /work; git checkout -q $build; npm ci --no-audit --no-fund; npm run prisma:generate; npm --workspace apps/api run build; npm run artifact:production; test -f deploy/apps/api/dist/main.js; echo MIGRATIONS=`$(ls -d deploy/apps/api/prisma/migrations/*/ | wc -l); cd deploy; zip -qr /out/opa-api-$short.zip .; echo BUILD_OK"
```
Expect `MIGRATIONS=45`, `BUILD_OK`.

## 2. Sign the API policy
```powershell
python ".\artifacts\release-d718c64\make-payload.py" ".\artifacts\release-d032e66\api-release-d032e66.signed.json" $build "$dir\api-payload-$short.json"
$hash = (Get-FileHash "$dir\api-payload-$short.json" -Algorithm SHA256).Hash.ToLower()
python ops\production-release\api-recovery-policy.py --payload "$dir\api-payload-$short.json" --build $build --approved-payload-sha256 $hash --sign --output "$dir\api-release-$short.signed.json" --authority "$env:LOCALAPPDATA\OPA\Production\ReleaseAuthority-20261006\authority.dpapi" --authority-module ops\production-release\authority.py; "EXIT=$LASTEXITCODE"
```

## 3. Stage the API (production untouched)
```powershell
$rg="opa-production"; $app="opa-api-production"
$stg="https://opa-api-production-staging-amhzcnbsftatbvhd.scm.southafricanorth-01.azurewebsites.net"
az webapp config appsettings set -g $rg -n $app --slot staging --settings OPA_BUILD_SHA=$build OPA_ENVIRONMENT_POLICY_FILE=/home/opa-production-policy/api-release-$short.signed.json -o none
az webapp start -g $rg -n $app --slot staging
$token = az account get-access-token --query accessToken -o tsv
Invoke-RestMethod -Method Put -Uri "$stg/api/vfs/opa-production-policy/api-release-$short.signed.json" -Headers @{ Authorization="Bearer $token"; "If-Match"="*" } -InFile "$dir\api-release-$short.signed.json" -ContentType "application/octet-stream" | Out-Null
az webapp deploy -g $rg -n $app --slot staging --src-path "$dir\opa-api-$short.zip" --type zip -o none
```
Staging stays not-ready ("migrations pending") until step 5. That also stops it sending messages.

## 4. Upload the database package to the production container
Kudu paths start at `/home`, so the path below lands in `/home/opa-release-estate`.
```powershell
$scm="https://opa-api-production-g4f6cxdyanfbaub0.scm.southafricanorth-01.azurewebsites.net"
(Get-FileHash "$env:USERPROFILE\Downloads\opa-release-db-estate.zip").Hash   # 46EA86A5…587C0E
Invoke-RestMethod -Method Put -Uri "$scm/api/zip/opa-release-estate/" -Headers @{ Authorization="Bearer $token" } -InFile "$env:USERPROFILE\Downloads\opa-release-db-estate.zip" -ContentType "application/zip"
```

## 5. Migrate (`az webapp ssh -g opa-production -n opa-api-production`)
```bash
cd /home/opa-release-estate && /usr/local/bin/node opa-release-db.cjs check
```
Continue only on `READY_FOR_ACTIVATE true` (ledger 44, no open incidents). Then, as one paste:
```bash
cd /home/opa-release-estate; echo "RESTORE_POINT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
/usr/local/bin/node opa-release-db.cjs activate
/usr/local/bin/node opa-release-db.cjs migrate
/usr/local/bin/node opa-release-db.cjs cleanup
/usr/local/bin/node opa-release-db.cjs verify
```
Expect `VERIFY PASS` with `ledgerApplied: 45`, `estateTablesOwnedByReleaseOwner: 2`, `estateSettingsColumns: 2`, `migratorOwnedObjects: 0`.

## 6. Start staging on the new build
```powershell
az webapp restart -g $rg -n $app --slot staging
$h="https://opa-api-production-staging-amhzcnbsftatbvhd.southafricanorth-01.azurewebsites.net"
for ($i=0; $i -lt 40; $i++) { try { $e=Invoke-RestMethod "$h/health/environment" -TimeoutSec 10; $r=Invoke-WebRequest "$h/health/ready" -UseBasicParsing -TimeoutSec 10; "build=$($e.build.Substring(0,7)) ready=$($r.StatusCode)"; if ($e.build -eq $build -and $r.StatusCode -eq 200) { "STAGING_READY"; break } } catch { "waiting" }; Start-Sleep 15 }
```

## 7. Swap with probe, then stop staging
```powershell
$prod="https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net"; $log="$dir\api-swap.log"
$probe = Start-Job -ArgumentList $prod -ScriptBlock { param($p) while ($true) { $t=(Get-Date).ToUniversalTime().ToString("HH:mm:ss"); try { $e=Invoke-RestMethod "$p/health/environment" -TimeoutSec 5; $r=Invoke-WebRequest "$p/health/ready" -UseBasicParsing -TimeoutSec 5; "$t OK $($e.build.Substring(0,7)) ready=$($r.StatusCode)" } catch { "$t FAIL $($_.Exception.Message)" }; Start-Sleep 3 } }
Start-Sleep 10; az webapp deployment slot swap -g $rg -n $app --slot staging --target-slot production
Start-Sleep 45; Stop-Job $probe; Receive-Job $probe | Tee-Object $log; "FAILS=" + (Select-String -Path $log -Pattern " FAIL " | Measure-Object).Count
az webapp stop -g $rg -n $app --slot staging
```
The old build left in staging (`d032e66`) cannot run on 45 migrations, so there is no instant rollback; fix forward.

## 8. Website
Vercel → Deployments → the newest commit on this branch → Promote.

## 9. Mobile builds (EAS, from your PC)
First, after any API release, re-sign the endpoint policy (the build checks the live API build):
`python ops\production-release\sign-endpoint-policy.py --expect-build <api sha>`, commit, push.
iOS reads the app config before applying the profile, so set the profile values in the session too.
```powershell
cd C:\Projects\OPA-release-simplification\apps\mobile-app
npm ci
$env:OPA_ENVIRONMENT = "production"
$env:OPA_API_BASE_URL = "https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net"
$env:OPA_ENDPOINT_POLICY_FILE = "../../packages/environment-policy/release/production-endpoint.json"
npx eas-cli@latest build --platform all --profile production
npx eas-cli@latest submit --platform android --latest
npx eas-cli@latest submit --platform ios --latest
```
iOS build 7, Android versionCode 22. For tomorrow's testing without waiting for store review, also build an installable APK: `npx eas-cli@latest build -p android --profile production-apk`.

## Smoke check after release
1. Facility admin signs in → lands on **Estate overview**.
2. Resident (app or web API) creates a visitor pass → gets a six-digit code.
3. Operator → **Gate** → types the code → sees name and house → Admit → visitor appears under "Recorded inside" → Record exit.
4. Wrong code 3 times → "No valid visitor pass"; the gate log shows "Wrong code".
