# One-shot API release through the staging slot (no database change).
# Builds the current commit, signs the policy (optionally rebinding one secret),
# stages it, waits for ready, swaps with a probe, stops staging, re-signs the
# endpoint policy and pushes it. Stops before the swap on any failure.
#
#   .\ops\production-release\release-api.ps1 -SecretId $id -SecretSha $sha
param(
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
  python ".\artifacts\release-d718c64\make-payload.py" $PreviousPolicy $build $payload
}
if ($LASTEXITCODE) { Fail "payload" }
$hash = (Get-FileHash $payload -Algorithm SHA256).Hash.ToLower()
python ops\production-release\api-recovery-policy.py --payload $payload --build $build --approved-payload-sha256 $hash --sign --output $signed --authority "$env:LOCALAPPDATA\OPA\Production\ReleaseAuthority-20261006\authority.dpapi" --authority-module ops\production-release\authority.py
if ($LASTEXITCODE) { Fail "signing" }

Step "4/7 Stage (production untouched)"
$rg="opa-production"; $app="opa-api-production"
$stg="https://opa-api-production-staging-amhzcnbsftatbvhd.scm.southafricanorth-01.azurewebsites.net"
$settings = @("OPA_BUILD_SHA=$build", "OPA_ENVIRONMENT_POLICY_FILE=/home/opa-production-policy/api-release-$short.signed.json")
if ($SecretId) { $settings += "$SecretName=@Microsoft.KeyVault(SecretUri=$SecretId)" }
az webapp config appsettings set -g $rg -n $app --slot staging --settings @settings -o none; if ($LASTEXITCODE) { Fail "staging settings" }
az webapp start -g $rg -n $app --slot staging -o none
$token = az account get-access-token --query accessToken -o tsv
Invoke-RestMethod -Method Put -Uri "$stg/api/vfs/opa-production-policy/api-release-$short.signed.json" -Headers @{ Authorization="Bearer $token"; "If-Match"="*" } -InFile $signed -ContentType "application/octet-stream" | Out-Null
az webapp deploy -g $rg -n $app --slot staging --src-path $zip --type zip -o none; if ($LASTEXITCODE) { Fail "staging deploy" }
az webapp restart -g $rg -n $app --slot staging -o none

Step "5/7 Wait for staging ready (up to 10 min)"
$h="https://opa-api-production-staging-amhzcnbsftatbvhd.southafricanorth-01.azurewebsites.net"; $ready=$false
for ($i=0; $i -lt 40; $i++) {
  try { $e=Invoke-RestMethod "$h/health/environment" -TimeoutSec 10; $r=Invoke-WebRequest "$h/health/ready" -UseBasicParsing -TimeoutSec 10
    "build=$($e.build.Substring(0,7)) ready=$($r.StatusCode)"; if ($e.build -eq $build -and $r.StatusCode -eq 200) { $ready=$true; break } } catch { "waiting" }
  Start-Sleep 15 }
if (-not $ready) { az webapp stop -g $rg -n $app --slot staging -o none; Fail "staging never became ready; production NOT changed, staging stopped" }

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
Write-Host "`nDONE. Production $short, FAILS=$fails. Next: Vercel promote, then the two EAS builds." -ForegroundColor Green
