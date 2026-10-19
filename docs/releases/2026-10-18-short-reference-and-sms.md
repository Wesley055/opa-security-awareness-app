# Release: short invitation reference + new SMS key (18 Oct 2026)

One API release, one swap: build `19ff3ab` (or later on this branch) **and** the new Africa's Talking key. **No database change** (still 45 migrations), so staging starts ready straight away and a swap back is possible.

What changes for people:
- SMS and email show **Reference OPA-XXXXXX** (6 characters). Residents type it in the app; the link still fills it in automatically. Both 4-digit codes are still required.
- SMS works again (new key).
- Mobile enroll/activate/visitors screens readable on every phone (ships with the next app builds, after step 7).

Never print the key. Keep one PowerShell window open from step 1 to step 3 (`$k`, `$id`, `$sha` live there).

## 1. Key Vault (new key version)
```powershell
az webapp config appsettings list -g opa-production -n opa-api-production --query "[?name=='AFRICASTALKING_API_KEY'].{value:value,slotSetting:slotSetting}" -o json
$f = New-TemporaryFile; [IO.File]::WriteAllText($f, $k)
$id = az keyvault secret set --vault-name opa-kv-production -n opa-production-africastalking-api-key --file $f --query id -o tsv
Remove-Item $f
$sha = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($k)) | ForEach-Object { $_.ToString("x2") })
"ID=$id"; "SHA_PREFIX=$($sha.Substring(0,8))"
```
The current setting's secret name must be `opa-production-africastalking-api-key` and `slotSetting` `false`.

## 2. Build the API
```powershell
cd C:\Projects\OPA-release-simplification; git pull
$build = git log -1 --format="%H"; $short = $build.Substring(0,7); "BUILD=$build"
$dir = ".\artifacts\release-$short"; New-Item -ItemType Directory -Force $dir | Out-Null
```
Then the `docker run …` line from step 1 of `2026-10-17-estateflow.md` unchanged. Expect `MIGRATIONS=45`, `BUILD_OK`.

## 3. Sign the policy (new build + new key binding)
```powershell
python ops\production-release\rotate-secret-payload.py --previous ".\artifacts\release-7045bde\api-release-7045bde.signed.json" --build $build --name AFRICASTALKING_API_KEY --secret-id $id --value-sha256 $sha --output "$dir\api-payload-$short.json"
$hash = (Get-FileHash "$dir\api-payload-$short.json" -Algorithm SHA256).Hash.ToLower()
python ops\production-release\api-recovery-policy.py --payload "$dir\api-payload-$short.json" --build $build --approved-payload-sha256 $hash --sign --output "$dir\api-release-$short.signed.json" --authority "$env:LOCALAPPDATA\OPA\Production\ReleaseAuthority-20261006\authority.dpapi" --authority-module ops\production-release\authority.py; "EXIT=$LASTEXITCODE"
```
Expect `PAYLOAD_OK`, `SIGNATURE_VERIFIED`, `EXIT=0`.

## 4. Stage
```powershell
$rg="opa-production"; $app="opa-api-production"
$stg="https://opa-api-production-staging-amhzcnbsftatbvhd.scm.southafricanorth-01.azurewebsites.net"
az webapp config appsettings set -g $rg -n $app --slot staging --settings OPA_BUILD_SHA=$build OPA_ENVIRONMENT_POLICY_FILE=/home/opa-production-policy/api-release-$short.signed.json "AFRICASTALKING_API_KEY=@Microsoft.KeyVault(SecretUri=$id)" -o none
az webapp start -g $rg -n $app --slot staging
$token = az account get-access-token --query accessToken -o tsv
Invoke-RestMethod -Method Put -Uri "$stg/api/vfs/opa-production-policy/api-release-$short.signed.json" -Headers @{ Authorization="Bearer $token"; "If-Match"="*" } -InFile "$dir\api-release-$short.signed.json" -ContentType "application/octet-stream" | Out-Null
az webapp deploy -g $rg -n $app --slot staging --src-path "$dir\opa-api-$short.zip" --type zip -o none
```

## 5. Wait for staging, swap with probe, stop staging
Steps 6 and 7 of `2026-10-17-estateflow.md`, unchanged. Expect `STAGING_READY`, then `FAILS=0`.

## 6. Website
Vercel → newest deployment on this branch → Promote. Check `/enroll` shows "e.g. OPA-3F9A1C".

## 7. Endpoint policy, then app builds
```powershell
python ops\production-release\sign-endpoint-policy.py --expect-build $build
git add packages/environment-policy/release/production-endpoint.json; git commit -m "release(production): sign endpoint policy for API $short"; git push
cd apps\mobile-app
$env:OPA_ENVIRONMENT = "production"
$env:OPA_API_BASE_URL = "https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net"
$env:OPA_ENDPOINT_POLICY_FILE = "../../packages/environment-policy/release/production-endpoint.json"
npx eas-cli@latest build --platform android --profile production-apk
npx eas-cli@latest build --platform ios --profile production
```
Android versionCode 23, iOS build 7.

## Proof
Command Center → invite yourself → SMS and email both show `Reference OPA-…` and a 4-digit code → in the new APK, Accept invitation → type the reference and both codes → account created.
