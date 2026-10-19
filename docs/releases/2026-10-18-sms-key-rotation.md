# Africa's Talking API key rotation (18 Oct 2026)

**Cause of the SMS 401:** a new API key was generated on the live `OPASafety` app while setting up the sandbox, which revoked the key production holds. Username (`OPASafety`), sender ID (`OPAALERT`) and wallet are fine.

**Why this is a release, not a settings edit:** the signed API policy pins the SHA-256 and Key Vault version of `AFRICASTALKING_API_KEY`. Changing the key on the running production slot would make the API refuse to restart. So the new key goes in through the staging slot and a swap, with the same build (`7045bde`) and a re-signed policy. Zero downtime; no database change.

Never print the key. Every command below keeps it in a variable or a temporary file that is deleted.

## 1. New key, tested without sending an SMS
Africa's Talking → live app **OPA Safety** (not sandbox) → Settings → API Key → generate → copy.
```powershell
$k = (Get-Clipboard).Trim()
(Invoke-RestMethod "https://api.africastalking.com/version1/user?username=OPASafety" -Headers @{ apiKey = $k; Accept = "application/json" }).UserData.balance
```
Expect the wallet balance (e.g. `NGN 2262.4426`). A 401 means the wrong key was copied; do not continue.

## 2. Store it as a new Key Vault version
```powershell
az webapp config appsettings list -g opa-production -n opa-api-production --query "[?name=='AFRICASTALKING_API_KEY'].{value:value,slotSetting:slotSetting}" -o json
$f = New-TemporaryFile; [IO.File]::WriteAllText($f, $k)
$id = az keyvault secret set --vault-name opa-kv-production -n opa-production-africastalking-api-key --file $f --query id -o tsv
Remove-Item $f
$sha = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($k)) | ForEach-Object { $_.ToString("x2") })
Remove-Variable k; "ID=$id"
```
The first command shows the current Key Vault reference (not the key). Its secret name must match the one used in `secret set`; `slotSetting` must be `false`.

## 3. Policy for the same build with the new binding
```powershell
cd C:\Projects\OPA-release-simplification; git pull
$build = git rev-parse 7045bde; $dir = ".\artifacts\release-7045bde"
python ops\production-release\rotate-secret-payload.py --previous "$dir\api-release-7045bde.signed.json" --build $build --name AFRICASTALKING_API_KEY --secret-id $id --value-sha256 $sha --output "$dir\api-payload-7045bde-sms1.json"
$hash = (Get-FileHash "$dir\api-payload-7045bde-sms1.json" -Algorithm SHA256).Hash.ToLower()
python ops\production-release\api-recovery-policy.py --payload "$dir\api-payload-7045bde-sms1.json" --build $build --approved-payload-sha256 $hash --sign --output "$dir\api-release-7045bde-sms1.signed.json" --authority "$env:LOCALAPPDATA\OPA\Production\ReleaseAuthority-20261006\authority.dpapi" --authority-module ops\production-release\authority.py; "EXIT=$LASTEXITCODE"
```
Expect `PAYLOAD_OK …` then `SIGNATURE_VERIFIED`, `EXIT=0`.

## 4. Stage, swap, stop staging
```powershell
$rg="opa-production"; $app="opa-api-production"
$stg="https://opa-api-production-staging-amhzcnbsftatbvhd.scm.southafricanorth-01.azurewebsites.net"
az webapp config appsettings set -g $rg -n $app --slot staging --settings OPA_BUILD_SHA=$build OPA_ENVIRONMENT_POLICY_FILE=/home/opa-production-policy/api-release-7045bde-sms1.signed.json "AFRICASTALKING_API_KEY=@Microsoft.KeyVault(SecretUri=$id)" -o none
az webapp start -g $rg -n $app --slot staging
$token = az account get-access-token --query accessToken -o tsv
Invoke-RestMethod -Method Put -Uri "$stg/api/vfs/opa-production-policy/api-release-7045bde-sms1.signed.json" -Headers @{ Authorization="Bearer $token"; "If-Match"="*" } -InFile "$dir\api-release-7045bde-sms1.signed.json" -ContentType "application/octet-stream" | Out-Null
az webapp deploy -g $rg -n $app --slot staging --src-path "$dir\opa-api-7045bde.zip" --type zip -o none
```
Then wait for staging (`STAGING_READY`) and swap with the probe, exactly as steps 6–7 of `2026-10-17-estateflow.md`, and stop staging afterwards. Expect `FAILS=0`.

## 5. Prove it
Command Center → re-send an invitation to your own phone. Expect the SMS within a minute, and the message as **Sent/Success** in Africa's Talking → SMS → Bulk SMS → Outbox.

## Rollback
Swap back is safe here (same build, same database); the old slot only has the revoked key, so SMS would stop again.
