# Silent SOS Android acceptance — execution required

No physical result has been recorded by this implementation task. Do not claim production readiness from unit tests or a successful build.

## Preparation

Use a designated test account and consenting test recipients in a controlled institution. Record date, tester, handset/OEM, Android version (cover 14/15/16), app build SHA, API SHA, notification channel settings, DND/ringer state, permissions, voice provider readiness and network. Use a second observer/device to capture actual sound, vibration and screen behavior. Do not enable extra recordings of users or bystanders.

Install the reviewed native build. Sign in, enroll in the correct facility, configure test recipients, and grant the disclosed location/background location, notification and (only if using voice protection) microphone permissions. Verify the required protection notification and SOS action exist. Confirm there is no OPEN incident. Open the user-controlled Silent SOS switch and enable it. Restart the app and verify it remains enabled. Changing this setting must neither enable voice capture nor activate an incident.

## Locked / dark sequence

1. Close any previous incident. Record whether location capture is already running. Lock the handset and let the display go dark.
2. Wake only enough to access the existing notification SOS action; tap SOS without unlocking. For the separate voice case, keep the screen dark and speak the configured phrase only when the native provider is verified operational.
3. Observe: no OPA siren, sound, vibration, Activity launch or conspicuous emergency transition. Required OS/service/microphone/location indicators remain. Record any OEM/system sound separately; never report completely invisible operation.
4. Verify server-side exactly one OPEN incident for the test account, correct facility and fresh location (or accurately reported unavailable location). Inspect atomic ACTIVATION_RECORDED audit payload for SILENT and LOCK_SCREEN/VOICE source. Do not put raw tokens or PII in the test report.
5. Verify the correct Command Center sees the incident, other tenants cannot, intended recipients receive alerts, public messages do not disclose the mode, and Delivery Confirmation progresses according to actual provider/recipient events.
6. Move a known short route while still locked for at least two expected fix intervals; verify distinct fresh tracking fixes arrive. Test BOTH a cold tracking state and an already-running SafeWalk/background location task. Cold capture must now begin through native location foreground-service ownership without React resume. Any wait for unlock/resume is a release blocker.
7. Unlock and resume, then restart the app with the incident OPEN. Verify safety controls reconcile the same ID, no new incident/duplicate fanout, no forced emergency screen, and continuing location updates.
8. Open safety controls, select I'm safe, confirm, and verify RESOLVED, terminal timeline event, stopped emergency capture, ended/revoked tracking access and retained evidence/delivery history. Simulate one failed resolve request: capture must continue until server acceptance.

## Other paths and regressions

Repeat with manual in-app SOS: subdued countdown, cancel works, activation uses the same lifecycle, success returns home with safety controls. Repeat explicit SafeWalk escalation with SILENT configured; earlier private route stays private. Let a separate SafeWalk miss its arrival without confirming escalation: it must remain non-emergency.

Test offline/reconnect and a queued native trigger across process restart; its saved mode must survive. Repeated activation while OPEN must reuse the same incident without duplicate notification intent. Test notification permission denied and user-modified notification channels: record limitations honestly and confirm no unsupported promise in settings.

Finally resolve all test incidents, disable Silent SOS, restart, and repeat manual, locked notification and operational voice activation in STANDARD. Confirm normal service notification behavior, OPEN -> RESOLVED lifecycle, tracking, Command Center, recipients and Delivery Confirmation. Record PASS/FAIL/BLOCKED for each step with evidence references. All required cases need physical proof before production approval.

## ADB evidence collection for this candidate

The existing test sequence above remains required. No connected hardware was found by `adb devices -l` during preparation; none of these physical acceptance cases has been marked PASS.

ENDPOINT GATE: acceptance APK configuration is stopped. At HEAD 680b052a18b8ad8c0d0d17933bab1499020b4f57, EAS preview is staging with no URL; production retains its existing production URL. The trust registry remains empty and no approved staging endpoint is configured. Supply an explicitly approved controlled HTTPS API endpoint before producing or installing the acceptance APK. Localhost, emulator addresses, tunnels, and invented hosts are excluded.

```powershell
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb devices -l
$opaDevices = @(& $adb devices | Select-String '^([^\s]+)\s+device
& $adb -s $serial shell getprop ro.build.version.release
& $adb -s $serial shell getprop ro.product.cpu.abilist
# This artifact requires arm64-v8a in the ABI list.
$apk = 'REPLACE_WITH_REVIEWED_ACCEPTANCE_APK_PATH'
Get-FileHash -Algorithm SHA256 -LiteralPath $apk
& $adb -s $serial install -r $apk
# Do not uninstall an existing differently signed app automatically; use a designated test profile/device.

$evidence = Join-Path $env:TEMP ('opa-silent-sos-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $evidence | Out-Null
# Run this capture in a separate PowerShell window; stop it with Ctrl+C after the case.
& $adb -s $serial logcat -v threadtime -T 1 'OpaProtectionService:I' 'OpaProtectionHeadless:I' 'ReactNativeJS:I' 'ActivityManager:I' 'AndroidRuntime:E' '*:S' | Tee-Object -FilePath (Join-Path $evidence 'logcat.txt')
```

Before triggering, open/sign in/configure the app normally, verify there is no active incident or location task, then lock it. The SOS action itself must never launch an Activity.

```powershell
& $adb -s $serial shell input keyevent KEYCODE_SLEEP
& $adb -s $serial shell dumpsys power | Select-String 'mWakefulness'
& $adb -s $serial shell dumpsys window | Select-String 'mShowingLockscreen|mDreamingLockscreen|mCurrentFocus'
& $adb -s $serial shell dumpsys activity activities | Select-String 'mResumedActivity|topResumedActivity'
& $adb -s $serial shell dumpsys activity services com.opasafety.app | Out-File (Join-Path $evidence 'services-before.txt')
# Activate through the actual notification SOS action while still locked, or the configured voice phrase while dark.
# Do not simulate this by opening the SOS Activity or sending a synthetic JS event.
& $adb -s $serial shell dumpsys activity services com.opasafety.app | Out-File (Join-Path $evidence 'services-after.txt')
& $adb -s $serial shell dumpsys activity activities | Select-String 'mResumedActivity|topResumedActivity'
```

| Evidence | Exact marker / check |
| --- | --- |
| Silent mode enabled | `[OPA-SOS] MODE_SAVED activationMode=SILENT` is emitted only after the native durable setting write succeeds. Also verify the explicit settings switch after app restart. |
| Native notification activation | `Native notification SOS trigger received.` |
| Frozen silent request | `[OPA-SOS] REQUEST mode=SILENT source=LOCK_SCREEN` or `source=VOICE` |
| Authoritative incident activation | `[OPA-HEADLESS] activation result=ACTIVATED`; verify the owner-scoped server incident is OPEN and its atomic `ACTIVATION_RECORDED` event has the expected mode/source. Voice uses `[voice-protection] activation result: INCIDENT_ACTIVATED`. A request marker alone is not proof of creation. |
| Durable tracking retry obligation | `[OPA-TRACKING] OBLIGATION_DURABLE` before native trigger ACK |
| Native location FGS accepted | `[OPA-TRACKING] LOCATION_FGS=true`; corroborate the protection service's microphone plus location foreground-service types in the service dump |
| Capture began without resume | `[OPA-TRACKING] STARTED_WITHOUT_RESUME` or `RECONCILED_WITHOUT_RESUME`, plus `background capture OWNS this session` and fresh records |
| SQLite batch write | `[OPA-TRACKING] LOCATION_BATCH_DURABLE count=` |
| Command Center / activationMode=SILENT | Correlate the same incident in the controlled operator UI with owner-scoped OPEN status and ACTIVATION_RECORDED payload activationMode=SILENT. Local logcat alone cannot prove server visibility. |
| Backend flush acknowledged | `[journey-background] BGREPLAY SENT session=`; corroborate fresh server records and Command Center visibility. `EMPTY`, `LEASE_BUSY`, or an HTTP error is not proof of delivery. |
| Later app resume adoption | `[OPA-TRACKING] RESUME_ADOPTED`; if the JS process restarted, the existing registered background task is adopted without another location registration. Verify the same incident/session and no second tracker. |
| I'm Safe accepted | `[OPA-TRACKING] USER_SAFE_RESOLVED`, native `LOCATION_FGS=false`, and `background capture stopped`; corroborate RESOLVED and ended/revoked server tracking access |

Keep the display locked for at least two capture intervals. Disconnect networking after activation, observe durable batch markers, reconnect, and require `BGREPLAY SENT` and corresponding server fixes before unlocking. Repeated SOS must retain one live incident/session and one capture registration. A refused FGS must produce `BOOTSTRAP_DEFERRED`/`RECONCILIATION_DEFERRED` and retain the obligation; it must not be reported as tracking success.

For process recovery, record `adb shell pidof com.opasafety.app` before and after a real OS process restart. `adb shell am kill com.opasafety.app` may leave an active foreground service alive; an unchanged PID does not test process death. Do not substitute force-stop: Android force-stop deliberately disables background restart until the user launches the app. Test OS restart on an appropriate controlled handset and record the actual PID change, service recreation, same durable incident/session, and new location writes before any Activity resumes.

Logs/service dumps can contain operational identifiers. Keep raw evidence in the controlled test evidence location, not in a commit or public report. The original `evidence-SOS-001-logcat.txt` has not been overwritten.
 | ForEach-Object { $_.Matches[0].Groups[1].Value })
if ($opaDevices.Count -ne 1) { throw 'Connect exactly one authorized test device and verify its serial before continuing.' }
$serial = $opaDevices[0]
& $adb -s $serial shell getprop ro.build.version.release
& $adb -s $serial shell getprop ro.product.cpu.abilist
# This artifact requires arm64-v8a in the ABI list.
$apk = 'REPLACE_WITH_REVIEWED_ACCEPTANCE_APK_PATH'
Get-FileHash -Algorithm SHA256 -LiteralPath $apk
& $adb -s $serial install -r $apk
# Do not uninstall an existing differently signed app automatically; use a designated test profile/device.

$evidence = Join-Path $env:TEMP ('opa-silent-sos-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $evidence | Out-Null
# Run this capture in a separate PowerShell window; stop it with Ctrl+C after the case.
& $adb -s $serial logcat -v threadtime -T 1 'OpaProtectionService:I' 'OpaProtectionHeadless:I' 'ReactNativeJS:I' 'ActivityManager:I' 'AndroidRuntime:E' '*:S' | Tee-Object -FilePath (Join-Path $evidence 'logcat.txt')
```

Before triggering, open/sign in/configure the app normally, verify there is no active incident or location task, then lock it. The SOS action itself must never launch an Activity.

```powershell
& $adb -s $serial shell input keyevent KEYCODE_SLEEP
& $adb -s $serial shell dumpsys power | Select-String 'mWakefulness'
& $adb -s $serial shell dumpsys window | Select-String 'mShowingLockscreen|mDreamingLockscreen|mCurrentFocus'
& $adb -s $serial shell dumpsys activity activities | Select-String 'mResumedActivity|topResumedActivity'
& $adb -s $serial shell dumpsys activity services com.opasafety.app | Out-File (Join-Path $evidence 'services-before.txt')
# Activate through the actual notification SOS action while still locked, or the configured voice phrase while dark.
# Do not simulate this by opening the SOS Activity or sending a synthetic JS event.
& $adb -s $serial shell dumpsys activity services com.opasafety.app | Out-File (Join-Path $evidence 'services-after.txt')
& $adb -s $serial shell dumpsys activity activities | Select-String 'mResumedActivity|topResumedActivity'
```

| Evidence | Exact marker / check |
| --- | --- |
| Native notification activation | `Native notification SOS trigger received.` |
| Frozen silent request | `[OPA-SOS] REQUEST mode=SILENT source=LOCK_SCREEN` or `source=VOICE` |
| Authoritative incident activation | `[OPA-HEADLESS] activation result=ACTIVATED`; verify the owner-scoped server incident is OPEN and its atomic `ACTIVATION_RECORDED` event has the expected mode/source. Voice uses `[voice-protection] activation result: INCIDENT_ACTIVATED`. A request marker alone is not proof of creation. |
| Durable tracking retry obligation | `[OPA-TRACKING] OBLIGATION_DURABLE` before native trigger ACK |
| Native location FGS accepted | `[OPA-TRACKING] LOCATION_FGS=true`; corroborate the protection service's microphone plus location foreground-service types in the service dump |
| Capture began without resume | `[OPA-TRACKING] STARTED_WITHOUT_RESUME` or `RECONCILED_WITHOUT_RESUME`, plus `background capture OWNS this session` and fresh records |
| SQLite batch write | `[OPA-TRACKING] LOCATION_BATCH_DURABLE count=` |
| Backend flush acknowledged | `[journey-background] BGREPLAY SENT session=`; corroborate fresh server records and Command Center visibility. `EMPTY`, `LEASE_BUSY`, or an HTTP error is not proof of delivery. |
| Later app resume adoption | `[OPA-TRACKING] RESUME_ADOPTED`; if the JS process restarted, the existing registered background task is adopted without another location registration. Verify the same incident/session and no second tracker. |
| I'm Safe accepted | `[OPA-TRACKING] USER_SAFE_RESOLVED`, native `LOCATION_FGS=false`, and `background capture stopped`; corroborate RESOLVED and ended/revoked server tracking access |

Keep the display locked for at least two capture intervals. Disconnect networking after activation, observe durable batch markers, reconnect, and require `BGREPLAY SENT` and corresponding server fixes before unlocking. Repeated SOS must retain one live incident/session and one capture registration. A refused FGS must produce `BOOTSTRAP_DEFERRED`/`RECONCILIATION_DEFERRED` and retain the obligation; it must not be reported as tracking success.

For process recovery, record `adb shell pidof com.opasafety.app` before and after a real OS process restart. `adb shell am kill com.opasafety.app` may leave an active foreground service alive; an unchanged PID does not test process death. Do not substitute force-stop: Android force-stop deliberately disables background restart until the user launches the app. Test OS restart on an appropriate controlled handset and record the actual PID change, service recreation, same durable incident/session, and new location writes before any Activity resumes.

Logs/service dumps can contain operational identifiers. Keep raw evidence in the controlled test evidence location, not in a commit or public report. The original `evidence-SOS-001-logcat.txt` has not been overwritten.
