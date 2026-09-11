# Silent SOS candidate — verification checkpoint

Verified on 2026-09-11 in C:\Projects\OPA, branch integration/institutional-security.

CURRENT HEAD: 680b052a18b8ad8c0d0d17933bab1499020b4f57 (unchanged).
CANDIDATE FILE COUNT: 53 (38 modified, 15 untracked).
NEW FILES ADDED THIS RESUME: 0.
UNRELATED FILES TOUCHED: 0. All 19 excluded files match the saved SHA256 inventory: 17 pre-existing unrelated files, one old logcat artifact and one historical staging design document. Index remains empty.

## Outcome and limitations

The native Android build blocker is resolved on this host. The isolated candidate already implements cold emergency tracking through the existing native protection service and headless worker. This resume verified that implementation, added the requested post-persistence mode log marker in the existing silent-sos.ts file, and refreshed these three candidate documents. No additional candidate files, migrations or staging modifications were introduced.

Cold tracking no longer has a software dependency on Activity/React foreground resume. Ten focused cold-path tests pass inside the full mobile suite. This is software evidence with mocked Android/location boundaries; it is not physical proof of locked-screen service eligibility, location delivery, process recreation, OEM behavior or silence. Those release gates remain outstanding.

No authorized device appeared in adb devices -l. No physical acceptance case was executed. No approved staging endpoint exists in the local configuration. Preview remains explicitly staging with no API URL, and the trust registry remains empty. No acceptance APK was configured against production or an invented endpoint.

## Native build proof

ANDROID BUILD ROOT CAUSE: Host-only JBR 21.0.10 / Windows user-TEMP Unix-domain-socket rendezvous failure. A standalone Selector.open probe fails with Unable to establish loopback connection / Invalid argument: connect without Gradle or OPA. The same probe passes with only -Djdk.net.unixdomain.tmpdir=C:\opa-sos-tmp. This is not proven to be a simple path-length or short-name issue; the deeper Windows directory/kernel cause remains unestablished.

WORKAROUND: Build-job JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\opa-sos-tmp; JAVA_HOME=C:\Program Files\Android\Android Studio\jbr; ANDROID_HOME=C:\Users\mohammed.WESLEYWEST\AppData\Local\Android\Sdk. The existing disposable Gradle init script restricts Ninja compilation/linking to a one-job pool, with --max-workers=2, to avoid this host's separate memory/resource exhaustion. Repository sources were not moved and no source workaround was used.

ANDROID NATIVE BUILD: PASS, :opa-protection:testDebugUnitTest :app:assembleDebug, ARM64 debug, BUILD SUCCESSFUL in 2m 12s; 249 tasks, 16 executed and 233 up-to-date. The merged app manifest includes FOREGROUND_SERVICE_MICROPHONE, FOREGROUND_SERVICE_LOCATION and OpaProtectionService microphone|location types. Other ABIs are not claimed.

NATIVE TESTS: PASS on a separate forced --rerun-tasks invocation: 65 tests, 11 suites, zero failures/errors; BUILD SUCCESSFUL in 10m 2s, all 53 tasks executed. No emulator/instrumentation/hardware tests were run.

Build logs: %TEMP%\opa-sos-resumed-native.log and %TEMP%\opa-sos-resumed-native-tests.log.
Debug APK: C:\Projects\OPA\apps\mobile-app\android\app\build\outputs\apk\debug\app-debug.apk.
SHA256: B599D105B85CBE1C207D96631FF6EFC7714E83007E3EAAC13FB5712166FE1C02.
This installable development debug artifact requires Metro. It is not a standalone acceptance APK or production release artifact.

## Authoritative cold lifecycle

1. Existing ACTION_SOS / voice trigger captures activation mode into the native durable FIFO without opening an Activity.
2. The authenticated headless activation uses the existing incident orchestrator. A locationless locked/voice activation obtains the authoritative OPEN incident and canonical journey session without inventing coordinates. Existing transaction locks and one-live-incident invariants remain.
3. The opaque incident tracking obligation is saved in native AtomicFile storage before exact trigger ACK. Capture failure cannot trigger another incident activation merely to retry tracking.
4. The existing protection service promotes to microphone/location foreground ownership only after permission checks. The canonical Expo background task starts without foreground UI, prompts or a second location service. Missing permissions or refused promotion leaves a retry obligation and does not falsely report active capture.
5. Background location batches enter the existing SQLite durable queue before leased backend replay. Existing tenant authentication, queue/replay and privacy boundaries remain.
6. Native periodic wake / process reconciliation reads the durable incident reference and an owner-scoped authoritative incident response. It adopts existing capture or starts the same canonical session. Authentication epochs fence late responses after account changes.
7. Duplicate wake/retrigger and later resume reuse the incident/session and registered task. Accepted I'm Safe resolution stops emergency ownership/capture and server tracking access; failed resolution keeps tracking eligible.

Existing protection/voice eligibility, background location permissions and Android service restrictions remain prerequisites. Force-stop is not equivalent to OS process recovery and cannot be represented as supported background restart. Continuous cold capture on target OS/OEM combinations still requires the preserved physical protocol.

## Executed validation

| Check | Result |
| --- | --- |
| Full mobile including final mode marker | PASS: 271 tests, 30 suites |
| Cold emergency tracking | PASS: 10 tests within full mobile suite |
| Headless SOS, locked/background ownership, voice | PASS within full mobile suite |
| Full API | PASS: 911 tests, 96 suites |
| PostgreSQL | PASS: 145 tests, 14 suites, local guarded opa_test / PostgreSQL 16.14; all 35 migrations verified |
| Incident concurrency/locationless canonical session, SafeWalk, delivery, tenant/PII | PASS in unit/integration suites above |
| Website / Command Center relevant regressions | PASS: 136 tests, 36 files |
| Native JVM tests | PASS: 65 tests, 11 suites, forced execution |
| Android ARM64 debug assembly | PASS |
| API TypeScript and Nest build | PASS |
| Mobile TypeScript | PASS after final mode marker |
| Mobile Android JS export | PASS after final mode marker: 1,174 modules, 3.11 MB Hermes bundle, index-e00e42873839fcfb9292acfb61287f42.hbc; %TEMP%\opa-sos-resumed-export-final |
| API changed-file lint | PASS: 9 TypeScript files |
| Mobile changed-file lint | PASS: 32 TypeScript/TSX files, zero warnings, run from mobile workspace |
| git diff --check | PASS; final scope/diff check executed after documentation update |
| Physical device / live Command Center/provider E2E | NOT EXECUTED |

API, mobile and PostgreSQL machine-readable results are in %TEMP%\opa-sos-resumed-api.json, %TEMP%\opa-sos-resumed-mobile-final.json and %TEMP%\opa-sos-resumed-postgres.json. A first mobile lint invocation from the API directory ignored files outside its base; it is not counted as validation. The corrected mobile-workspace invocation linted all 32 files with --max-warnings 0 successfully.

## Acceptance preparation and readiness

The original locked/dark physical sequence is preserved in silent-sos-device-acceptance.md, with ADB inventory/install/logcat/service-state commands and exact runtime markers. MODE_SAVED activationMode=SILENT is emitted only after native preference persistence. OPEN status, activationMode=SILENT audit provenance, Command Center visibility, fresh server fixes and RESOLVED must be corroborated server-side; logcat alone does not prove them. No known handset serial was invented.

APP RESUME REQUIRED: NO in the implemented software path; physical verification pending.
INCIDENT CREATION / LOCATION TRACKING / DURABLE QUEUE: software regressions PASS, on-device E2E unverified.
VOICE SOS / LOCK-SCREEN SOS / SAFEWALK REGRESSION: software PASS, physical checks pending.
PHYSICAL DEVICE TEST REQUIRED: YES.
INSTALLABLE APK READY: engineering debug YES; approved standalone acceptance NO.
SAFE TO COMMIT: YES as a reviewed software candidate, not as a production acceptance claim. No commit was performed or is authorized by this report.
SAFE FOR CONTROLLED INSTITUTIONAL E2E: NO until approved isolated staging and its verified endpoint/trust bindings plus an authorized handset are available.
SAFE FOR PRODUCTION SILENT SOS CLAIM: NO until physical and controlled end-to-end acceptance passes.

No commit, push, merge, deployment, production data change, trust binding population or unrelated cleanup was performed.

## Candidate inventory

- apps/api/src/modules/emergency-detection/dto/trigger-request.dto.ts
- apps/api/src/modules/emergency-detection/emergency-detection.service.ts
- apps/api/src/modules/incident-orchestrator/dto/create-incident-request.dto.ts
- apps/api/src/modules/incident-orchestrator/incident-orchestrator.service.spec.ts
- apps/api/src/modules/incident-orchestrator/incident-orchestrator.service.ts
- apps/api/src/modules/incidents/incidents.service.ts
- apps/api/test/int/locationless-incident.int-spec.ts
- apps/mobile-app/app/_layout.tsx
- apps/mobile-app/app/index.tsx
- apps/mobile-app/app/safewalk.tsx
- apps/mobile-app/app/sos.tsx
- apps/mobile-app/modules/opa-protection/android/src/main/AndroidManifest.xml
- apps/mobile-app/modules/opa-protection/android/src/main/java/com/opasafety/protection/OpaProtectionModule.kt
- apps/mobile-app/modules/opa-protection/android/src/main/java/com/opasafety/protection/OpaProtectionService.kt
- apps/mobile-app/modules/opa-protection/android/src/main/java/com/opasafety/protection/ProtectionTriggerBridgePayload.kt
- apps/mobile-app/modules/opa-protection/android/src/main/java/com/opasafety/protection/ProtectionTriggerBus.kt
- apps/mobile-app/modules/opa-protection/android/src/main/java/com/opasafety/protection/ProtectionTriggerPersistenceCodec.kt
- apps/mobile-app/modules/opa-protection/index.ts
- apps/mobile-app/src/services/headless-sos-activation.spec.ts
- apps/mobile-app/src/services/headless-sos-activation.ts
- apps/mobile-app/src/services/headless-sos-worker.spec.ts
- apps/mobile-app/src/services/headless-sos-worker.ts
- apps/mobile-app/src/services/headless-voice-location.spec.ts
- apps/mobile-app/src/services/journey-background-task.ts
- apps/mobile-app/src/services/journey-tracker.ts
- apps/mobile-app/src/services/locked-background-trigger-ownership.spec.ts
- apps/mobile-app/src/services/opa-protection-trigger-processor.ts
- apps/mobile-app/src/services/safewalk.spec.ts
- apps/mobile-app/src/services/safewalk.ts
- apps/mobile-app/src/services/sos-activation-coordinator.spec.ts
- apps/mobile-app/src/services/sos-activation-coordinator.ts
- apps/mobile-app/src/services/sos-protection-service.ts
- apps/mobile-app/src/services/voice-activation-coordinator.spec.ts
- apps/mobile-app/src/services/voice-activation-coordinator.ts
- apps/mobile-app/src/services/voice-protection-service.ts
- apps/mobile-app/src/services/voice-trigger-provider.ts
- apps/mobile-app/src/store/activeIncidentStore.ts
- apps/mobile-app/src/store/authStore.ts
- apps/api/src/modules/emergency-detection/silent-sos.spec.ts
- apps/api/src/modules/incident-orchestrator/silent-sos.orchestrator.spec.ts
- apps/mobile-app/modules/opa-protection/android/src/main/java/com/opasafety/protection/ProtectionActivationModeStore.kt
- apps/mobile-app/modules/opa-protection/android/src/main/java/com/opasafety/protection/ProtectionTrackingStore.kt
- apps/mobile-app/modules/opa-protection/android/src/test/java/com/opasafety/protection/ProtectionSilentSosTest.kt
- apps/mobile-app/src/services/auth-session-epoch.ts
- apps/mobile-app/src/services/cold-emergency-tracking.spec.ts
- apps/mobile-app/src/services/emergency-tracking-native.ts
- apps/mobile-app/src/services/emergency-tracking.ts
- apps/mobile-app/src/services/silent-sos-ui.spec.ts
- apps/mobile-app/src/services/silent-sos.spec.ts
- apps/mobile-app/src/services/silent-sos.ts
- docs/silent-sos-build-host.md
- docs/silent-sos-device-acceptance.md
- docs/silent-sos-implementation-report.md
