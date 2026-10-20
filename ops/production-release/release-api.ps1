# One-shot API release through the staging slot (no database change).
# Builds the current commit, signs the policy (optionally rebinding one secret),
# stages it, waits for ready, swaps with a probe, stops staging, re-signs the
# endpoint policy and pushes it. Stops before the swap on any failure.
#
#   .\ops\production-release\release-api.ps1 -SecretId $id -SecretSha $sha
#   .\ops\production-release\release-api.ps1 -PreviousPolicy <signed.json> -DbPackage <zip> -DbPackageSha <sha256>
#     (database release: pauses after staging so you run check/activate/migrate/cleanup/verify)
param(
  [string]$DbPackage,
  [string]$DbPackageSha,
  [string]$SecretName = "AFRICASTALKING_API_KEY",
  [string]$SecretId,
  [string]$SecretSha,
  [string]$PreviousPolicy = ".\artifacts\release-7045bde\api-release-7045bde.signed.json"
)
$ErrorActionPreference = "Stop"
function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Fail($t) { Write-Host "STOPPED: $t" -ForegroundColor Red; exit 1 }

Set-Location (git rev-parse --show-toplevel)
Step "1/7 Pull"
git pull --ff-only; if ($LASTEXITCODE) { Fail "git pull" }
$build = git log -1 --format="%H"; $short = $build.Substring(0,7); "BUILD=$build"
$dir = ".\artifacts\release-$short"; New-Item -ItemType Directory -Force $dir | Out-Null
if (-not (Test-Path $PreviousPolicy)) { Fail "previous policy not found: $PreviousPolicy" }

Step "2/7 Build API (Docker, ~5-10 min)"
$zip = "$dir\opa-api-$short.zip"
if (-not (Test-Path $zip)) {
  docker run --rm -v "C:\Projects\OPA\.git:/repo.git:ro" -v "$((Resolve-Path $dir).Path):/out" node:22-bookworm bash -c "set -e; apt-get update -qq && apt-get install -y -qq zip >/dev/null; git config --global --add safe.directory '*'; git clone -q /repo.git /work; cd /work; git checkout -q $build; npm ci --no-audit --no-fund; npm run prisma:generate; npm --workspace apps/api run build; npm run artifact:production; test -f deploy/apps/api/dist/main.js; echo MIGRATIONS=`$(ls -d deploy/apps/api/prisma/migrations/*/ | wc -l); cd deploy; zip -qr /out/opa-api-$short.zip .; echo BUILD_OK"
  if ($LASTEXITCODE -or -not (Test-Path $zip)) { Fail "API build" }
} else { "zip already built: $zip" }

Step "3/7 Sign API policy"
$payload = "$dir\api-payload-$short.json"; $signed = "$dir\api-release-$short.signed.json"
Remove-Item $payload, $signed -ErrorAction SilentlyContinue
if ($SecretId -and $SecretSha) {
  python ops\production-release\rotate-secret-payload.py --previous $PreviousPolicy --build $build --name $SecretName --secret-id $SecretId --value-sha256 $SecretSha --output $payload
} else {
  python ops\production-release\carry-policy-payload.py --previous $PreviousPolicy --build $build --output $payload
}
if ($LASTEXITCODE) { Fail "payload" }
$hash = (Get-FileHash $payload -Algorithm SHA256).Hash.ToLower()
python ops\production-release\api-recovery-policy.py --payload $payload --build $build --approved-payload-sha256 $hash --sign --output $signed --authority "$env:LOCALAPPDATA\OPA\Production\ReleaseAuthority-20261006\authority.dpapi" --authority-module ops\production-release\authority.py
if ($LASTEXITCODE) { Fail "signing" }

Step "4/7 Stage (production untouched)"
$rg="opa-production"; $app="opa-api-production"
$stg="https://opa-api-production-staging-amhzcnbsftatbvhd.scm.southafricanorth-01.azurewebsites.net"
# Settings go through a JSON file: az.cmd (a batch file) breaks on the
# parentheses in "@Microsoft.KeyVault(SecretUri=...)" on the command line.
$settings = @(
  @{ name = "OPA_BUILD_SHA"; value = $build; slotSetting = $false },
  @{ name = "OPA_ENVIRONMENT_POLICY_FILE"; value = "/home/opa-production-policy/api-release-$short.signed.json"; slotSetting = $false },
  # Names the rejecting preflight rule (file:line only, never values) if startup is refused.
  @{ name = "OPA_PREFLIGHT_DEBUG"; value = "1"; slotSetting = $false }
)
# A swap exchanges settings, so staging may hold the previous release's Key Vault
# references. Start from production's current references, then apply any rotation.
# Parentheses: Windows PowerShell 5.1 emits a JSON array as ONE object unless enumerated.
$prodRefs = @((az webapp config appsettings list -g $rg -n $app -o json | ConvertFrom-Json)) | ForEach-Object { $_ } | Where-Object { $_.value -like "@Microsoft.KeyVault(*" -and -not $_.slotSetting }
foreach ($ref in $prodRefs) {
  if (-not ($SecretId -and $ref.name -eq $SecretName)) { $settings += @{ name = $ref.name; value = $ref.value; slotSetting = $false } }
}
"Key Vault references copied from production: $(@($prodRefs).Count) ($((@($prodRefs) | ForEach-Object { $_.name }) -join ', '))"
if (-not $SecretId -and @($prodRefs).Count -eq 0) { Fail "no Key Vault references found on production; refusing to stage with possibly stale secrets" }
if ($SecretId) { $settings += @{ name = $SecretName; value = "@Microsoft.KeyVault(SecretUri=$SecretId)"; slotSetting = $false } }
$settingsFile = Join-Path $dir "staging-settings.json"
[IO.File]::WriteAllText((Join-Path (Get-Location) $settingsFile), (ConvertTo-Json -InputObject $settings -Depth 3))
az webapp config appsettings set -g $rg -n $app --slot staging --settings "@$settingsFile" -o none; if ($LASTEXITCODE) { Fail "staging settings" }
$check = az webapp config appsettings list -g $rg -n $app --slot staging --query "[?name=='OPA_BUILD_SHA'].value" -o tsv
if ($check -ne $build) { Fail "staging OPA_BUILD_SHA is '$check', expected $build" }
az webapp start -g $rg -n $app --slot staging -o none
$token = az account get-access-token --query accessToken -o tsv
Invoke-RestMethod -Method Put -Uri "$stg/api/vfs/opa-production-policy/api-release-$short.signed.json" -Headers @{ Authorization="Bearer $token"; "If-Match"="*" } -InFile $signed -ContentType "application/octet-stream" | Out-Null
az webapp deploy -g $rg -n $app --slot staging --src-path $zip --type zip -o none; if ($LASTEXITCODE) { Fail "staging deploy" }
az webapp restart -g $rg -n $app --slot staging -o none

if ($DbPackage) {
  Step "4b/7 Database migration (staging waits as 'migrations pending')"
  if (-not (Test-Path $DbPackage)) { Fail "database package not found: $DbPackage" }
  $pkgSha = (Get-FileHash $DbPackage -Algorithm SHA256).Hash.ToLower()
  if ($pkgSha -ne $DbPackageSha.ToLower()) { Fail "database package SHA-256 is $pkgSha, expected $DbPackageSha" }
  "Database package verified: $pkgSha"
  $scm = "https://opa-api-production-g4f6cxdyanfbaub0.scm.southafricanorth-01.azurewebsites.net"
  $token = az account get-access-token --query accessToken -o tsv
  Invoke-RestMethod -Method Put -Uri "$scm/api/zip/opa-release-duty/" -Headers @{ Authorization = "Bearer $token" } -InFile $DbPackage -ContentType "application/zip" | Out-Null
  Write-Host "Uploaded to /home/opa-release-duty on the production container." -ForegroundColor Green
  Write-Host "`nOpen a SECOND PowerShell window and run:  az webapp ssh -g opa-production -n opa-api-production" -ForegroundColor Yellow
  Write-Host "Then follow docs/releases/2026-10-20-duty-reports.md step 2 (check, then activate/migrate/cleanup/verify)." -ForegroundColor Yellow
  $answer = Read-Host "Type VERIFY PASS when verify printed 'VERIFY PASS' (anything else stops here; production keeps running)"
  if ($answer -ne "VERIFY PASS") { az webapp stop -g $rg -n $app --slot staging -o none; Fail "database step not confirmed; staging stopped. Production is still serving." }
  az webapp restart -g $rg -n $app --slot staging -o none
}

Step "5/7 Wait for staging ready (up to 10 min)"
$h="https://opa-api-production-staging-amhzcnbsftatbvhd.southafricanorth-01.azurewebsites.net"; $ready=$false
for ($i=0; $i -lt 40; $i++) {
  try { $e=Invoke-RestMethod "$h/health/environment" -TimeoutSec 10; $r=Invoke-WebRequest "$h/health/ready" -UseBasicParsing -TimeoutSec 10
    "build=$($e.build.Substring(0,7)) ready=$($r.StatusCode)"; if ($e.build -eq $build -and $r.StatusCode -eq 200) { $ready=$true; break } } catch { "waiting" }
  Start-Sleep 15 }
if (-not $ready) {
  try {
    $hdr = @{ Authorization = "Bearer $(az account get-access-token --query accessToken -o tsv)" }
    $today = (Get-Date).ToUniversalTime().ToString("yyyy_MM_dd")
    $file = @((Invoke-RestMethod "$stg/api/vfs/LogFiles/" -Headers $hdr)) | ForEach-Object { $_ } | Where-Object { $_.name -like "$today*_default_docker.log" } | Select-Object -Last 1
    if ($file) { Write-Host "--- last lines of $($file.name) ---"; ((Invoke-WebRequest $file.href -Headers $hdr -UseBasicParsing).Content -split "`n" | Select-Object -Last 15) }
  } catch { "could not read staging log" }
  az webapp stop -g $rg -n $app --slot staging -o none; Fail "staging never became ready; production NOT changed, staging stopped"
}

Step "6/7 Swap with probe, then stop staging"
$prod="https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net"; $log="$dir\api-swap.log"
$probe = Start-Job -ArgumentList $prod -ScriptBlock { param($p) while ($true) { $t=(Get-Date).ToUniversalTime().ToString("HH:mm:ss"); try { $e=Invoke-RestMethod "$p/health/environment" -TimeoutSec 5; $r=Invoke-WebRequest "$p/health/ready" -UseBasicParsing -TimeoutSec 5; "$t OK $($e.build.Substring(0,7)) ready=$($r.StatusCode)" } catch { "$t FAIL $($_.Exception.Message)" }; Start-Sleep 3 } }
Start-Sleep 10; az webapp deployment slot swap -g $rg -n $app --slot staging --target-slot production
Start-Sleep 45; Stop-Job $probe; Receive-Job $probe | Tee-Object $log | Select-Object -Last 5
$fails = (Select-String -Path $log -Pattern " FAIL " | Measure-Object).Count; "FAILS=$fails"
az webapp stop -g $rg -n $app --slot staging -o none
$live = (Invoke-RestMethod "$prod/health/environment").build
if ($live -ne $build) { Fail "production reports $live, expected $build" }
Write-Host "PRODUCTION IS ON $short" -ForegroundColor Green

Step "7/7 Endpoint policy for the app builds"
python ops\production-release\sign-endpoint-policy.py --expect-build $build; if ($LASTEXITCODE) { Fail "endpoint policy" }
git add packages/environment-policy/release/production-endpoint.json
git commit -m "release(production): sign endpoint policy for API $short"; git push
Write-Host "`nDONE. Production $short, FAILS=$fails. Next: Vercel promote. App builds only if the mobile app changed." -ForegroundColor Green
