# Silent SOS Android build — verified host configuration

Repository: `C:\Projects\OPA`, branch `integration/institutional-security`. No source files were moved. No commit, push, merge, or deployment was performed.

## Isolated causes

1. **JBR/Windows user-TEMP Unix-domain-socket rendezvous failure.** Android Studio JBR 21.0.10 fails in a standalone `Selector.open()` with `IOException: Unable to establish loopback connection`, caused by `SocketException: Invalid argument: connect`. This reproduces without Gradle or OPA. Identical elevated runs give:

   | Socket directory | Result |
   | --- | --- |
   | Default TEMP (`C:\Users\MOHAMM~1.WES\AppData\Local\Temp`) | FAIL |
   | Explicit `C:\Users\mohammed.WESLEYWEST\AppData\Local\Temp` | FAIL |
   | `C:\opa-sos-tmp` | PASS |
   | `C:\opa-sos-tmp\mohammed.WESLEYWEST\AppData\Local\Temp` | PASS |

   The failure is specific to this host's user-TEMP socket handling, **not simply a path-length limit or the 8.3 alias**. The underlying Windows directory/kernel cause was not independently determined. The verified minimum workaround is `-Djdk.net.unixdomain.tmpdir=C:\opa-sos-tmp`; changing `java.io.tmpdir`, source layout, or application code is unnecessary. The property is supplied through `JAVA_TOOL_OPTIONS` so Gradle's launcher and forked JVMs agree.

2. **SDK discovery was unset.** After the socket fix, Gradle compiled its plugins and reported `SDK location not found`. The existing SDK is `C:\Users\mohammed.WESLEYWEST\AppData\Local\Android\Sdk`; setting `ANDROID_HOME` resolved discovery. Gradle installed the required CMake 3.22.1 using the SDK's already accepted license.

3. **Unbounded native compilation exhausted host memory.** LLVM reported `out of memory`; Windows also rejected Gradle cache writes with `Insufficient system resources`. Limiting Gradle to two workers alone did not limit Ninja's independent C++ parallelism. A disposable init script assigns CMake compilation/linking to a one-job Ninja pool per native build. With two Gradle workers and an ARM64 engineering target, compilation and APK assembly completed successfully.

These are host/build-environment issues. The cold tracking changes are separate application defects and do not serve as host workarounds.

## Reproducible build

Run in PowerShell in the Android project. Use a dedicated writable socket directory on Windows CI; do not put sockets in this host's affected user TEMP directory. Keep these environment settings scoped to the build job.

```powershell
Set-Location 'C:\Projects\OPA\apps\mobile-app\android'
New-Item -ItemType Directory -Force 'C:\opa-sos-tmp' | Out-Null
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:\opa-sos-tmp'
$env:ANDROID_HOME = 'C:\Users\mohammed.WESLEYWEST\AppData\Local\Android\Sdk'
$env:OPA_ENVIRONMENT = 'development'
Remove-Item Env:OPA_API_BASE_URL,Env:OPA_API_URL,Env:EAS_BUILD_PROFILE -ErrorAction SilentlyContinue
$opaInit = Join-Path $env:TEMP 'opa-native-one-job.init.gradle'
@"
gradle.beforeProject { project ->
    ['com.android.application', 'com.android.library'].each { pluginId ->
        project.plugins.withId(pluginId) {
            project.android.defaultConfig.externalNativeBuild.cmake.arguments.addAll([
                '-DCMAKE_JOB_POOLS=opa_native=1',
                '-DCMAKE_JOB_POOL_COMPILE=opa_native',
                '-DCMAKE_JOB_POOL_LINK=opa_native'
            ])
        }
    }
}
"@ | Set-Content -Encoding utf8 $opaInit
.\gradlew.bat :opa-protection:testDebugUnitTest :app:assembleDebug --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a --init-script $opaInit
if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
```

Current HEAD: `680b052a18b8ad8c0d0d17933bab1499020b4f57`. Revalidated on 2026-09-11: **BUILD SUCCESSFUL in 2m 12s**, 249 actionable tasks (16 executed, 233 up-to-date). The default standalone Java probe failed again and the single socket-directory property passed again. The latest foreground-service manifest permissions are included. OPA Kotlin tests: **65 passed, zero failures/errors**. The app, protection module, Expo dependencies, Java/Kotlin, and ARM64 C++ compilation completed. This proves ARM64, not the other three default ABIs.

Debug APK: `C:\Projects\OPA\apps\mobile-app\android\app\build\outputs\apk\debug\app-debug.apk`.

The ordinary debug APK requires Metro. A standalone release APK must embed JavaScript and a reviewed `OPA_API_BASE_URL`; the existing release signing configuration uses the development key and is for controlled acceptance only. Build success is not physical acceptance or production release approval.

Raw build evidence from this task: `%TEMP%\opa-native-baseline.log`, `%TEMP%\opa-native-one-job.log`, `%TEMP%\opa-native-arm64.log`. The first two include failed/interrupted attempts; the final ARM64 log contains the successful build.

## Acceptance endpoint gate — current status

Acceptance APK configuration remains **STOPPED**. At the current staging-safeguard HEAD, EAS preview is explicitly staging and contains no API URL. Production retains its existing production URL. The trust registry is intentionally empty. No approved staging endpoint has been configured, and no production endpoint was used for this engineering build. No staging or production configuration was changed.

The prior localhost-configured attempt was interrupted before APK production and is not acceptance evidence. This run explicitly used development classification with OPA_API_BASE_URL/OPA_API_URL/EAS_BUILD_PROFILE removed from the build process. The new debug APK requires Metro and must not be described as a standalone acceptance APK.

Current build log: %TEMP%\opa-sos-resumed-native.log. APK SHA256: B599D105B85CBE1C207D96631FF6EFC7714E83007E3EAAC13FB5712166FE1C02. Native test force-execution log: %TEMP%\opa-sos-resumed-native-tests.log (consult the implementation report for its final result).

Before standalone acceptance assembly, provision and approve isolated staging, establish real trust bindings and verify the controlled HTTPS endpoint through the committed configuration preflight. Do not substitute production, localhost, emulator addresses, tunnels or invented hosts.
