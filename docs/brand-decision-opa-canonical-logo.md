# OPA permanent brand decision and source inventory

> Current status: see the Implementation update at the end. Earlier inventory/remediation-plan sections are retained as historical evidence; they do not describe the post-implementation asset state.

Decision ID: BRAND-001  
Status: ACCEPTED — permanent product decision  
Decision owner: OPA product owner, explicit instruction dated 2026-09-18  
Inventory date: 2026-09-18  
Repository inspected: C:\Projects\OPA  
Branch: integration/institutional-security  
HEAD: 53600cebf5118ce6e16440a4a69c2305ae34496e

## Permanent decision

The canonical OPA corporate and product logo is the ORIGINAL OPA mark: orange/red location pin, teal signal elements, dark navy container.

- Pin: #FF5A36.
- Teal elements: #17C9B2, with the existing source geometry and opacity.
- Navy container and pin aperture: #0B1F3A.
- Preserve the original geometry, proportions and identity.
- The blue chevron/A launcher mark is RETIRED across all OPA surfaces.
- The newer white/Steel website treatment is NOT a replacement corporate logo and is retired as the default OPA identity.
- Project Elite remains the design system. It does not redefine, recolor or replace the OPA logo.

This applies permanently to Android, Google Play, iOS, App Store, website, Command Center, shared branding, Figma and corporate materials. Historical references describing logo selection as undecided, or approving the white marketing treatment, are superseded by this decision. In particular, the logo-related wording in docs/TODO.md, docs/REGISTRATIONS.md and apps/website/PROJECT-ELITE-REVIEW.md is not authority to choose a different mark. Those files remain untouched in this inventory step.

## Source of truth

Authoritative existing master selected for future derivatives:

- Repository path: apps/website/public/opa-logo-mark.svg
- Absolute path: C:\Projects\OPA\apps\website\public\opa-logo-mark.svg
- Format: SVG vector; width 64, height 64, viewBox 0 0 64 64.
- Size: 569 bytes.
- SHA-256: 21385afffabe494c700f21d7e70ef75fe912fca01d6949fc27bf343745acee3b
- History: commit 5c6ab8aeadaf522b040d7b997a0f50a05d686a75, 2026-07-24, "Website: add OPA logo mark, favicon, and careers page with founding Business Development Lead role".
- Rationale: editable, resolution-independent original geometry and colors; higher-quality generation source than any resized PNG, screenshot or packaged launcher resource. The 64-unit artboard does not limit export resolution.
- apps/website/src/app/icon.svg is byte-identical to this master, including SHA-256.
- apps/website/public/opa-logo-horizontal.svg is the related vector lockup, 220 x 64, 1118 bytes, SHA-256 e927ba778c4475160ad3e5a8c4f3cd7bcef6641c6e0ff91a3769289ef363b798. Its mark matches the master; its navy wordmark is drawn as paths.
- apps/website/src/components/brand/Logo.tsx duplicates the original mark geometry inline. It is a rendering implementation, not a separate design authority.

No higher-quality original vector master, .fig, .ai, .eps or .psd source was found in the inspected non-dependency tree. The public SVG is designated the source of truth by this record; it has not been moved, rewritten or regenerated.

## Scope, method and evidence limits

This is an inventory of the current working tree, including uncommitted production source, ignored native output and local release artifacts. "Production source" identifies application code/assets rather than proving that the exact working tree is currently deployed. No Play Console, App Store Connect or remote Figma inspection occurred, and no live website deployment was certified.

Read-only checks included Git status/history/tracked-file enumeration, recursive asset-extension and name searches including ignored files, source reference searches, SVG/XML/config inspection, raster inspection, image metadata, SHA-256 hashes and read-only ZIP-entry hashes for AAB/APKs. Dependency directories, Git internals and installed tooling were excluded as brand authorities. Initial broad enumeration encountered access-denied directories under artifacts/staging-runner-hardening-lint/{bin,pyflakes,pyflakes-3.4.0.dist-info}; these third-party tooling directories were excluded from later searches.

Native mipmaps are PRESENT but NOT COMMITTED in this checkout. git ls-files lists no apps/mobile-app/android/app/src/main/res files; apps/mobile-app/.gitignore ignores /android and /ios; git check-ignore confirms the native launcher exclusion. No native resource history was returned by the reachable-history path search. Do not describe these files as committed native assets without checking the actual release checkout.

No product files were edited during inventory. This decision record is the sole authorized repository addition. SMS implementation is paused; existing tracked modifications and untracked SMS files are preserved in place, without stash, stage, commit, reset or clean.

## Production source inventory: retired blue chevron/A

### Expo assets

All paths below are relative to C:\Projects\OPA\apps\mobile-app.

| Path | Dimensions | Observed content / source use |
| --- | --- | --- |
| assets/icon.png | 1024 x 1024 | Blue chevron on pale blue construction-grid background; app.json expo.icon, including the configured iOS default |
| assets/android-icon-foreground.png | 512 x 512 | Blue chevron foreground; app.json android.adaptiveIcon.foregroundImage |
| assets/android-icon-monochrome.png | 432 x 432 | Chevron silhouette; app.json android.adaptiveIcon.monochromeImage |
| assets/android-icon-background.png | 512 x 512 | Pale blue construction-grid companion background, not a standalone logo; adaptiveIcon.backgroundImage |
| assets/favicon.png | 48 x 48 | Blue chevron; app.json web.favicon |
| assets/splash-icon.png | 1024 x 1024 | Generic gray construction-grid placeholder, NOT the canonical mark and NOT the white OPA pin treatment |

Asset hashes:

| Asset | SHA-256 |
| --- | --- |
| icon.png | 119462bb78eb240a65c869fc067ee599639b3cb5a41953f25c07b17d2a8c7e0f |
| android-icon-foreground.png | 9e3d0315a33c6799de601dd34cd8bf8cc3a8d16f3bf75592baec2ceb7240b391 |
| android-icon-monochrome.png | 6371fc2c12e33ad2215a86c281db3d682a81bebe7c957a842c13b8bf00cceb83 |
| android-icon-background.png | fb139c2dee362ebf2070e23b96da6fc0d43f8492de38b8af1fd7223e19b5861d |
| favicon.png | a4e030697a7571b3e95d31860e4da55d2f98e5e861e2b55e414f45a8556828ba |
| splash-icon.png | 5f4c0a732b6325bf4071d9124d2ae67e037cb24fcc9c482ef82bea742109a3b8 |

apps/mobile-app/app.json lines 8 and 15–20 select the retired family; the adaptive backgroundColor is #E6F4FE. Line 35 selects the blue web favicon. app.config.ts contains no icon override. The untracked root app.json contains an empty expo object and is not the mobile branding authority.

### Native Android resources, ignored local output

Base: apps/mobile-app/android/app/src/main/res/

The complete density set is mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi. Every filename in the following table exists in EACH corresponding mipmap-density directory (25 raster files total).

| Relative path pattern | Classification | Pixel sizes in density order |
| --- | --- | --- |
| mipmap-{density}/ic_launcher.webp | Retired blue chevron legacy square icon | 48, 72, 96, 144, 192 square |
| mipmap-{density}/ic_launcher_foreground.webp | Retired blue chevron adaptive foreground | 108, 162, 216, 324, 432 square |
| mipmap-{density}/ic_launcher_monochrome.webp | Retired chevron themed-icon silhouette | 108, 162, 216, 324, 432 square |
| mipmap-{density}/ic_launcher_background.webp | Retired icon family's pale blue background | 108, 162, 216, 324, 432 square |
| mipmap-{density}/ic_launcher_round.webp | Legacy round family; inspected xxxhdpi image is a blank pale blue circle, not a visible chevron | 48, 72, 96, 144, 192 square |

Wiring and additional affected resources:

- mipmap-anydpi-v26/ic_launcher.xml
- mipmap-anydpi-v26/ic_launcher_round.xml
- Both adaptive XMLs reference @mipmap/ic_launcher_background, @mipmap/ic_launcher_foreground and @mipmap/ic_launcher_monochrome.
- apps/mobile-app/android/app/src/main/AndroidManifest.xml line 20 references @mipmap/ic_launcher and @mipmap/ic_launcher_round.
- values/colors.xml contains iconBackground #E6F4FE and splashscreen_background #FFFFFF.
- drawable/ic_launcher_background.xml is actually a splash layer-list referring to splashscreen_background and splashscreen_logo.
- drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/splashscreen_logo.png contains generated splash resources; the inspected xxxhdpi resource is the generic construction-grid placeholder.
- values/styles.xml participates in native splash/theme presentation and must be audited with the above resources in later remediation.

Generated replicas also exist under apps/mobile-app/.expo/web/cache/production/images/android-* and android/app/build/intermediates/{packaged_res,merged_res}/debug/. These are cache/build output, not additional masters. A debug APK exists at android/app/build/outputs/apk/debug/app-debug.apk; its branding was not separately certified in this audit.

### Saved release artifacts

| Artifact | SHA-256 | Confirmed branding evidence |
| --- | --- | --- |
| OPA-vc8-production.aab | bd929d46fba0de44b672bfc748876a18197a69d943dcee7d034490196efd1509 | All 25 base/res/mipmap-{density}-v4/ic_launcher*.webp files match the corresponding local native resources byte-for-byte |
| evidence-local/OPA-vc8-cdf1d4c.apk | 00d678de86a153d4e02946f09bff4f23d72655544969163b17f853f83b515adc | All 25 obfuscated launcher-family raster entries match those same native resources byte-for-byte |
| evidence-local/OPA-schema-v1-1bcc3ff-versionCode1.apk | 4ea903b551b71c5a57b6bd2245e72a7a9aa550ae6129277a988422dcfc2d6035 | Same 25 matching launcher-family entries |

AAB adaptive definitions are base/res/mipmap-anydpi-v26/ic_launcher.xml and ic_launcher_round.xml. The xxxhdpi splash PNG also matches the local generic placeholder in each inspected archive.

Exact APK raster entry mapping, shared by the two saved APKs (density order mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi):

- Legacy square: res/d2.webp, res/MO.webp, res/qs.webp, res/Sn.webp, res/sK.webp.
- Foreground: res/Nt.webp, res/13.webp, res/9Q.webp, res/iE.webp, res/5c.webp.
- Monochrome: res/_l.webp, res/mJ.webp, res/Yu.webp, res/ae.webp, res/IG.webp.
- Background: res/At.webp, res/4k.webp, res/By.webp, res/BZ.webp, res/gS.webp.
- Round: res/yw.webp, res/fq.webp, res/u5.webp, res/j_.webp, res/-6.webp.
- Matching xxxhdpi splash: res/S7.png.

docs/OPA-NIGERIA-PLAY-VC8-PRODUCTION-VALIDATION-2026-08-26.md describes vc8 as Google Play Internal Testing using the production API. That is not evidence that vc8 is the current public production-track release. No separate Play listing icon export, feature graphic master or fastlane listing asset set was found.

## Production source inventory: white website treatment

There is no separate white OPA SVG/PNG master in the production source discovered here. The white mark is produced by CSS overriding the canonical inline SVG.

- apps/website/src/app/(site)/marketing.css:612–624 changes the logo container to Steel, teal strokes and orange/red pin to white, and aperture to Carbon.
- apps/website/src/components/layout/Navbar.tsx:16–18 renders LogoMark inside .m-brand.
- apps/website/src/components/layout/Footer.tsx:10–12 renders the same treatment.
- apps/website/src/app/(site)/layout.tsx supplies the marketing body class and shared Navbar/Footer.
- Therefore every route served through that site layout inherits it: /, /about, /careers, /contact, /hospitals, /privacy, /terms, /delete-account, /platform, /command-center, /shield, /industries, /trust and /i/[token] where the shared layout is rendered. The public /command-center marketing page is distinct from the operational /operator console.
- apps/website/e2e/browser/marketing.spec.ts:206–209 explicitly asserts a white pin. This test must be revised with the later branding fix.
- apps/website/PROJECT-ELITE-REVIEW.md records the old white/Steel decision, now superseded by BRAND-001.

No blue chevron use was found in website or Command Center source. No white pin override was found in operational console CSS.

## Production source inventory: canonical original

| Location | Current use |
| --- | --- |
| apps/website/public/opa-logo-mark.svg | Selected canonical master; directly available public asset |
| apps/website/public/opa-logo-horizontal.svg | Original mark plus vector OPA wordmark; no in-repository consumer found |
| apps/website/src/app/icon.svg | Byte-identical canonical browser icon, shared at app root |
| apps/website/src/components/brand/Logo.tsx | Canonical inline implementation; final colors depend on consumer CSS |
| apps/website/src/app/(console)/super-admin/login/page.tsx:7 | Original mark, size 40 |
| apps/website/src/app/(console)/super-admin/(protected)/layout.tsx:44 | Original mark, size 36, inherited by protected Super Admin pages |

The Navbar/Footer use canonical geometry but are classified as WHITE at runtime due to the marketing CSS, not as correctly branded renders.

Additional findings:

- apps/website/src/app/favicon.ico is NOT confirmed canonical. Its embedded 256 x 256 PNG was inspected and is a white Vercel triangle on black. The ICO also contains 16, 32 and 48 pixel entries. SHA-256: 2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932. Correct it later to prevent browser-dependent identity mismatch; do not assume icon.svg eliminates all uses of favicon.ico.
- apps/website/public/{file,globe,next,vercel,window}.svg are template/helper assets, not alternate OPA marks.
- The operator Command Center header in apps/website/src/app/(console)/operator/(protected)/layout.tsx uses textual OPA, not one of the three image marks. Text-only identity is not evidence of the retired white pin mark.
- Mobile auth/home pages likewise use textual OPA (app/index.tsx and app/(auth)/{activate,login,register,forgot-password,reset-password}.tsx), rather than a canonical image logo.
- No canonical original mark was found among the mobile PNGs or native launcher resources.

## iOS, shared assets, Figma, corporate documents and copies

- iOS: no generated apps/mobile-app/ios tree, AppIcon.appiconset, .xcassets or .ipa found in the inspected tree. The configured shared expo.icon points at the retired blue assets/icon.png. This is source configuration evidence, not evidence of a shipped iOS build.
- Shared branding: the web SVGs and Logo.tsx above are the existing brand implementations. No separate branding package/master under packages was found.
- Figma: no local .fig asset, Figma logo export, concrete figma.com file reference or Code Connect logo mapping was found in the inspected application/docs/scripts/packages/agent references. docs/command-center-implementation-inventory.md describes Project Elite/Figma synchronization as pending. Remote Figma content remains unverified.
- Corporate documents: no .pdf, .docx, .pptx, .ai, .eps or .psd brand/document source was found in the inspected non-dependency filesystem. Corporate Markdown references exist; docs/REGISTRATIONS.md and docs/TODO.md have obsolete "logo undecided" language superseded above. External corporate materials remain unverified.
- Historical baseline copies: artifacts/staging-baseline-attribution/20260914/baseline/apps/website/{public/opa-logo-mark.svg,public/opa-logo-horizontal.svg,src/app/icon.svg,src/components/brand/Logo.tsx} and baseline/apps/mobile-app/assets contain snapshot copies, not independent masters.
- Review build copies: build/website-content-review-20260917 contains website source/public copies, compiled output and screenshots. apps/website/.next/dev contains generated browser icon/favicon output. These do not establish a new logo authority.
- apps/website/e2e-artifacts and build/.../e2e-artifacts contain rendered evidence/screenshots, not authoritative artwork. Preserve historical evidence; refresh current validation output only during later authorized remediation.

## Asset-generation and change-control policy

1. All OPA logo derivatives must be generated deterministically from the selected SVG master. Preserve geometry and the canonical color values for full-color assets. Do not redraw, trace screenshots, use generative image tools, substitute chevrons, recolor via design-system CSS or upscale an old low-resolution icon as a new master.
2. Store reproducible generation instructions, generator/tool versions, dimensions, target surface, source hash and output hashes alongside future generated assets. A central export manifest must enumerate Android, Play, iOS/App Store, web/console, Figma and corporate outputs.
3. Platform masks, safe zones, scaling and background extensions are technical adaptations of the original mark. They must not remove the recognizable pin/teal identity. Preserve the navy container identity; platform clipping must not crop essential artwork.
4. Android themed monochrome is a platform-specific mask derived from the ORIGINAL geometry. System tinting is an allowed platform rendering behavior, not permission to adopt the white marketing logo or blue chevron as a corporate master. Verify legibility of the pin and signal elements in light/dark themed launchers.
5. No store listing, app, website, Command Center, Figma library or corporate template may independently change the logo. Any future logo decision requires an explicit product-owner decision superseding BRAND-001 and a coordinated inventory/migration of every affected surface.
6. Project Elite tokens may change surrounding interface presentation. Logo colors and geometry must remain protected from global/scoped style overrides.
7. Before an authorized release, require side-by-side validation of the store icon, installed launcher (legacy/adaptive/round/themed), splash, web favicon/header/footer, console and iOS outputs against this master. Add appropriate source-hash/asset-reference checks and a focused visual branding regression check in the later implementation. These checks are policy requirements, not claimed to be implemented now.
8. Keep historical release bundles and evidence immutable. Create new derivative assets/builds in a separately authorized remediation step; never silently patch signed archives or reuse an old bundle as corrected evidence.

## Exact remediation plan — not executed

### Google Play

1. Inspect the current main listing, localized/custom listings and any icon experiments in Play Console for com.opasafety.app. Record which icon is live/pending on each relevant surface; local assets cannot establish that state.
2. Prepare a Play listing export from the canonical SVG: 512 x 512, 32-bit PNG, maximum 1024 KB, complying with Play masking/full-square artwork rules. Preserve the original navy/orange/teal identity and avoid double-baked platform rounding/shadows.
3. Replace any noncanonical listing icon; if a listing already has the original, retain it and compare it with the corrected installed app icon. Inspect feature graphics/screenshots for obsolete logo depictions and correct only affected material.
4. Fix the Android source/packaged launcher separately. A store listing icon does not replace the installed launcher, and a new app bundle does not by itself replace the listing icon.
5. Verify the eventual Play-delivered installation and listing together before clearing the brand release blocker. This record authorizes no upload, submission, rollout or versionCode change.

### Android

1. Replace apps/mobile-app/assets/icon.png and android-icon-{foreground,background,monochrome}.png with canonical derivatives; replace the blue web favicon as part of the shared mobile asset family.
2. Set the intended adaptive navy background in app.json and remove the construction-grid background treatment through coordinated asset/config changes.
3. Correct the generic splash source/configuration and native splash outputs to the original mark where OPA branding appears.
4. Regenerate or deliberately update the complete 25-file mipmap family, both adaptive XMLs and affected colors/splash resources in the actual release build pipeline. Fix the blank legacy round icon. Do not hand-fix ignored local mipmaps and assume a future EAS build will retain the change.
5. Confirm manifest icon/roundIcon references and inspect the final AAB/APK resources, then test square/circle/squircle masks and Android themed icons on installed builds.
6. Reconcile release checkout provenance before generating: current app.json has versionCode 19, ignored native build.gradle has versionCode 9, saved bundle is named vc8. This drift is recorded only; app name, version, versionCode, package ID and build files remain unchanged.
7. Preserve existing SMS, native functionality and unrelated work. No Android generation or build was run in this step.

### Later iOS / App Store

Replace the shared Expo blue icon input with the canonical master-derived app icon; explicitly inspect the generated iOS asset catalog and archive when those exist. Validate all required platform icon variants and App Store presentation against the same master, including any appearance variants, without independent redesign. Audit App Store screenshots/listing assets when available. No iOS generation, build, upload or store change is authorized by this record.

### Later website / Command Center

- Remove the four marketing logo CSS overrides at marketing.css:613–624 so Navbar/Footer render the original palette; retain Project Elite for surrounding UI.
- Revise the white-fill assertion in e2e/browser/marketing.spec.ts and validate header/footer colors on every inherited public route.
- Replace the Vercel favicon.ico with a canonical export and verify icon.svg/favicon precedence and browser caching.
- Preserve Super Admin's already-canonical mark and prevent future console/theme CSS from recoloring it.
- Where a logo is introduced or standardized in text-only operator screens, reuse the protected canonical shared brand implementation. Do not treat the white marketing pin as the Command Center logo.
- Consolidate duplicate mark implementations through a later reviewed source-of-truth/generation mechanism; do not silently fork geometry.

### Later Figma / corporate materials

Locate the actual remote Figma library and corporate template sources, inventory their mark instances, replace retired marks with the canonical master and attach BRAND-001/source hash to the library/export policy. Continue Project Elite work around that logo. No remote Figma or corporate-document edits were made.

## Remaining ambiguity and release status

There is NO ambiguity about the permanent product decision or the selected in-repository master.

Outstanding evidence gaps:

- Current Google Play listing graphics, experiments, active tracks and their delivered build versions are unverified.
- Current deployed website/Command Center state is not inferred from this dirty working tree.
- Remote Figma, external corporate sources and App Store assets were not available in this filesystem inventory.
- The actual upcoming release checkout/native-generation process must be checked because local native resources are ignored and version settings differ.
- Other density round-icon pixels, smaller ICO frames and the local debug APK were not separately visually certified. They are in scope for the later artifact/device validation, not grounds to claim this blocker resolved.

Brand remediation remains a release blocker. This inventory and permanent decision record do not constitute remediation, store approval or deployment.

## Reference specifications checked 2026-09-18

- [Google Play preview assets and listing icon requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-GB)
- [Google Play icon design specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications)
- [Android adaptive and monochrome icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)

## Preservation checkpoint

Before writing this record, a read-only SHA-256 aggregate covered 3,028 files outside node_modules, .git, .next, .expo, build, artifacts, e2e-artifacts and test-results; no read errors occurred. Sorted entries were absolute forward-slash paths plus a space plus each file's SHA-256, joined with LF. Aggregate: 383562a01738b1d013debf25ac2e063a15369e943a2ae0ec34a3b672beab89a7. Recheck this aggregate excluding this newly added record to verify pre-existing work is unchanged.

Git index SHA-256 before this record: fcf01b09b1d7cdd7b888231694caff4003a984e326f7756ff1de52e104c19e75.

Existing SMS work under apps/api/src/modules/sms-ingress, related test/docs files and all other working-tree changes remain in place. No staging, commit, push, deployment, SMS edit, asset edit, app rename or versionCode change is part of BRAND-001.

## Implementation update — 2026-09-18 (supersedes inventory status above)

Canonical source/assets are reconciled. Android release resources compile successfully with versionCode 20, versionName 1.0.0 and label OPA. A signed installable APK/AAB release candidate has NOT been produced; physical acceptance is NOT complete. No store/deployment action was performed.

The current local release signing configuration is the pre-existing debug signing configuration. A production build also requires an approved signed OPA_ENDPOINT_POLICY_FILE and successful production endpoint verification. No approved production endpoint-policy file was found in the inspected local release inputs. The owner was asked for the approved release build/signing setup and policy path. These gates were not bypassed. Gradle resource validation used development classification and is not evidence of a production-configured app binary. Do not submit its resource-only outputs.

### Current outcomes

- RETIRED: blue chevron. Four Expo source rasters and fifteen native glyph rasters were replaced: 19 direct retired-mark source occurrences before, zero in the controlled current source family after. Six companion background files, five blank round resources, and six generic splash source/native files were also reconciled. Old vc8/versionCode1 archives and historical cache/evidence copies remain immutable; they are not corrected candidates.
- SUPERSEDED TREATMENT: white-only alternative website logo. One CSS treatment comprising four rules affected Navbar and Footer across the public site. Those four recoloring rules are removed; zero remaining treatment occurrences in current consumer CSS. The obsolete white-fill browser expectation now requires canonical orange/red. The legitimate Android monochrome mask is distinct from this retired treatment.
- Standard launcher: canonical pin and teal elements on navy, all five densities.
- Adaptive: canonical geometry on a navy layer; foreground and monochrome maximum nontrivial-alpha radius 20.76dp within the 33dp safe radius. Circle, rounded-square and squircle previews were inspected.
- Round: every density contains measured orange/red and teal pixels; the previous blank round resource is corrected.
- Monochrome: same pin/signal geometry with a transparent aperture, neutral white mask for OS tinting. It is not a replacement corporate mark.
- Splash: canonical image replaces the placeholder in the existing native splash canvas. No startup logic or theme behavior changed.
- Name difference remains intentional and unchanged: installed label OPA versus user-reported Play title OPA — Emergency Safety. No independent evidence required a label change.
- Expo app.json and native build.gradle now both specify versionCode 20; version 1.0.0 and package com.opasafety.app remain unchanged.
- Play: artifacts/brand/google-play/opa-emergency-safety-play-icon-512.png; 512 x 512 RGBA, 20121 bytes; SHA-256 91c8159deb156e5eb957740589bfe4e4ee457aa1c927286b2fdcbf72c3574a86.
- Website: original colors restored in Navbar/Footer; Elite layout, typography, navigation, content and accessibility preserved.
- Command Center: existing canonical Super Admin logos retained; shared browser favicon corrected. Text-only operator identity and all behavior remain unchanged.
- iOS: shared 1024 x 1024 icon.png is opaque RGB without an alpha channel. Native iOS/App Store verification remains pending; no Apple resources touched.
- Favicons: Expo 48px blue favicon and the website Vercel ICO replaced. ICO contains canonical 16, 32, 48 and 256px PNG frames. The existing canonical icon.svg remains byte-identical to the master.

### Permanent generation and drift enforcement

Run from the repository root after installing the locked website dependencies:

```powershell
npm run brand:generate
npm run brand:check
node --test scripts/brand-assets.test.cjs
```

scripts/brand-assets.cjs uses sharp 0.34.5 and the immutable canonical source hash. It deterministically exports the current asset family and writes docs/brand-assets.json. The check verifies the registered bytes, source hash, inline path/palette agreement, Expo identity references and prohibited marketing logo recoloring. It is a lightweight source/export guard, not a classifier capable of finding arbitrary newly invented drawings. Product review must reject unregistered independent logos.

apps/mobile-app/assets/brand/android-res contains 32 portable native brand resources. The asset-only with-canonical-brand plugin verifies their registered hashes before copying only the named image/XML resources during a future normal Expo generation. This task did not run Expo prebuild. The plugin does not edit services, permissions, manifests, lifecycle code or native source. Local native Android remains ignored; preserve the portable resources and generator in any later approved commit. Do not rely on ignored local mipmaps alone.

### Validation results

| Check | Result / limit |
| --- | --- |
| Canonical source SHA-256 | Verified unchanged: 21385afffabe494c700f21d7e70ef75fe912fca01d6949fc27bf343745acee3b |
| Brand consistency | All 75 mappings verified; no fragile screenshot-diff dependency |
| Native plugin tests | 2 passed: only 32 registered resources copied; drift rejected before any copy |
| Mobile TypeScript | Passed before and after |
| Standard mobile tests | 30 suites / 272 tests passed |
| Android-preset tests | All 30 suites attempted; 25 passed, 5 failed; 253 tests passed, 19 failed |
| Website lint | Final pass; pre-change error in incident-detail.tsx was independently changed during this run, not fixed by brand work |
| Website TypeScript | Passed before and after |
| Website unit tests | 43 files / 209 tests passed |
| Website production compiler | Passed with local development/fixture environment classification; no deployment |
| Marketing/brand browser checks | 8 passed across desktop, small Android, tablet and mobile-manager; checks include Super Admin and served favicon bytes |
| Android standalone AAPT2 compile/link | Passed for complete portable resource set; resource-only validation package |
| Gradle :app:processReleaseResources | Passed: 121 tasks, including existing-project release manifest/resource processing |
| Linked Gradle resource evidence | All 25 launcher WebP files match corrected native source bytes; merged manifest versionCode 20 / versionName 1.0.0 |
| Complete signed APK/AAB | BLOCKED on approved production endpoint-policy and release signing/build inputs; not produced |
| Physical Android acceptance | NOT PERFORMED |

Android-preset failures are in files unchanged from the pre-change source checkpoint: safewalk-ui.spec.ts expects mixed-case button text while Android renders uppercase (1 failure); voice-activation-coordinator.spec.ts (10), headless-sos-activation.spec.ts (2) and sos-activation-coordinator.spec.ts (4) lack the native OpaProtection module in the harness; silent-sos.spec.ts (2) has an incomplete emergencyTrackingNative mock. The full Android-preset baseline was not run before edits, so attribution is based on unchanged source/test hashes and non-brand failure stacks, not an invented pre-change run. The crashing UI suite was rerun separately and all other 29 suites were run without changing or skipping assertions. No harness/emergency fixes were mixed into branding.

Initial JBR 21 Gradle attempts failed on local Unix-domain/loopback sockets. Installed JDK 22 with a short task-specific temporary path resolved that issue. Offline validation then lacked React Native/Hermes release AARs; retry with public dependency downloads passed. No repository toolchain/security settings were changed to achieve this.

Evidence: artifacts/brand/validation/{before-checks.json,after-checks.json,android-preset-split.json,asset-validation.json,brand-plugin-tests.log,website-build.log,website-browser.log,android-resources-online.log,linked-resource-proof.json,gradle-package-badging.txt}. Resource-only brand-resources.ap_ is NOT an APK acceptance candidate.

### Exact remaining candidate and Google Play steps

1. Supply the approved production endpoint-policy file and release build/signing environment. Keep the existing production environment verification and signing controls; do not replace them with development classification/debug signing.
2. In that approved environment, verify the source hash and run brand:check plus the native plugin tests. Build an actual versionCode 20, version 1.0.0 candidate without destructive prebuild or native emergency changes. EAS/local release inputs must include the canonical master, manifest and portable resources. If any normal generation is used later, independently verify preservation of the proven emergency native configuration.
3. Inspect the completed AAB/APK identity, signing certificate, resources, application label and production endpoint classification. Hash the actual binary and record its source provenance. Do not reuse the old vc8/versionCode1 archives or a development-classified test package.
4. Complete the physical checklist below and resolve/review the Android-preset harness gaps before treating the release as accepted.
5. In a separately authorized Play action, inspect main/localized/custom listings and icon experiments. Use the generated Play 512 export wherever the wrong mark remains; retain any already-canonical listing icon. Review feature graphics/screenshots for obsolete branding. Preserve the listing title unless independently required otherwise.
6. Only after candidate/device acceptance and explicit submission authorization, upload the correctly signed versionCode 20 AAB, complete the relevant release/review fields and submit through the approved track. Verify the delivered install and listing together. No submission or appeal occurred in this task.

### Physical Android acceptance checklist (all pending)

Use the approved signed candidate and test distribution/device; do not uninstall the existing app merely to work around a signing mismatch.

1. Record device model, OS, launcher, candidate SHA-256 and signing certificate. Install through the approved testing path, then run adb shell dumpsys package com.opasafety.app and confirm versionCode=20 and versionName=1.0.0.
2. Confirm the launcher shows the original orange/red pin plus teal elements on navy; label stays OPA. Capture a launcher screenshot.
3. Verify legacy round and adaptive circle/rounded-square/squircle presentation on supported launchers; no blank circle, distortion or clipping. Enable themed icons where supported and verify the original pin/signal silhouette.
4. Launch and cold-relaunch the app. Verify canonical splash and absence of the chevron/generic placeholder in controlled presentation. Record any launcher icon caching behavior rather than misidentifying an old installed version as accepted.
5. Using the approved emergency acceptance scenario/account, verify foreground SOS creates/uses the expected incident and preserves tracking/feedback.
6. Repeat the proven lock-screen/background voice SOS acceptance scenario; verify trigger ownership, location/tracking and expected incident behavior.
7. Verify the notification emergency action and foreground-service presentation still work.
8. Verify I'm Safe / closure, authoritative terminal state, and expected tracking/service cleanup. Do not infer emergency correctness from icon compilation or Jest alone.
9. Compare the eventual Play-delivered installation against the Play listing icon/title and record acceptance evidence. Physical and store acceptance remain open until executed.

### Final production mapping

Every row below derives from apps/website/public/opa-logo-mark.svg at the pinned hash above. The full machine-readable mapping is docs/brand-assets.json. Native rows are resource-validated, not physically accepted; store/iOS rows are prepared, not submitted.

| Surface | Canonical source | Generated asset / implementation | Dimensions | SHA-256 | Status |
| --- | --- | --- | --- | --- | --- |
| Expo Android / iOS shared opaque RGB source | canonical SVG | apps/mobile-app/assets/icon.png | 1024 x 1024 | bec4803930772c8eda12fa6f95ae12d9a499e96c85f091f31dd93cd71857e76d | generated |
| Android adaptive foreground | canonical SVG | apps/mobile-app/assets/android-icon-foreground.png | 432 x 432 | f604e467714c750427476609c737ba998dd066d057a0f8caa60dedb2916ee15d | generated |
| Android adaptive navy background | canonical SVG | apps/mobile-app/assets/android-icon-background.png | 432 x 432 | cde38b3b9ffea10f342c7ff61f1fd78769a37a63d9045d474b5fab0579e874b1 | generated |
| Android themed monochrome | canonical SVG | apps/mobile-app/assets/android-icon-monochrome.png | 432 x 432 | aa23c23c2f4cbc8d2ddb55eeeb35d79df976e5e14b345467dcc0ea9c35b0ed3c | generated |
| Shared splash | canonical SVG | apps/mobile-app/assets/splash-icon.png | 1024 x 1024 | 2243f114f2e8a52ac9338b13955407aa1f18788b335d34ddaca102ef61e65b4e | generated |
| Expo web favicon | canonical SVG | apps/mobile-app/assets/favicon.png | 48 x 48 | 00be0520e7656dde24e386631e658ea3583f0911e2add3c5a9116d0050df4ac8 | generated |
| Google Play listing | canonical SVG | artifacts/brand/google-play/opa-emergency-safety-play-icon-512.png | 512 x 512 | 91c8159deb156e5eb957740589bfe4e4ee457aa1c927286b2fdcbf72c3574a86 | generated |
| Website / Command Center browser icon | canonical SVG | apps/website/src/app/icon.svg | 64 x 64 vector | 21385afffabe494c700f21d7e70ef75fe912fca01d6949fc27bf343745acee3b | generated |
| Website / Command Center favicon | canonical SVG | apps/website/src/app/favicon.ico | 16, 32, 48, 256 square | 9ef5f3e587ddf4ad3ffd3a4bd830939cfd4745500c4b5c808e09daebd5da0f30 | generated |
| Android standard (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-mdpi/ic_launcher.webp | 48 x 48 | da59eef8a3911d572ab00aa5736444c26ed3ecaf0f7e8242bf5401a5ebc47e4f | generated |
| Android standard | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-mdpi/ic_launcher.webp | 48 x 48 | da59eef8a3911d572ab00aa5736444c26ed3ecaf0f7e8242bf5401a5ebc47e4f | native resource; device acceptance pending |
| Android round (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-mdpi/ic_launcher_round.webp | 48 x 48 | 90dc623d33b5ddc03eef82f0fa12c620923bb4f6c38b501044bde838cc457677 | generated |
| Android round | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.webp | 48 x 48 | 90dc623d33b5ddc03eef82f0fa12c620923bb4f6c38b501044bde838cc457677 | native resource; device acceptance pending |
| Android foreground (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-mdpi/ic_launcher_foreground.webp | 108 x 108 | 32f466bfc4d18edbc46eaef88edf183ad03b403e4be99a8d7576599b52b1cb13 | generated |
| Android foreground | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp | 108 x 108 | 32f466bfc4d18edbc46eaef88edf183ad03b403e4be99a8d7576599b52b1cb13 | native resource; device acceptance pending |
| Android background (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-mdpi/ic_launcher_background.webp | 108 x 108 | a288e68b00fd1d0752cc121e474584aeefaffb4fe623ea39e97aaa99c99ed02a | generated |
| Android background | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-mdpi/ic_launcher_background.webp | 108 x 108 | a288e68b00fd1d0752cc121e474584aeefaffb4fe623ea39e97aaa99c99ed02a | native resource; device acceptance pending |
| Android monochrome (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-mdpi/ic_launcher_monochrome.webp | 108 x 108 | bcaa6b50f7416408521e2362c3db60ab384d3dcfe6dabb72e11fc1ff87de2fbf | generated |
| Android monochrome | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-mdpi/ic_launcher_monochrome.webp | 108 x 108 | bcaa6b50f7416408521e2362c3db60ab384d3dcfe6dabb72e11fc1ff87de2fbf | native resource; device acceptance pending |
| Android splash (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/drawable-mdpi/splashscreen_logo.png | 288 x 288 | bb7f282affae33c388998d0ddf3d276a87681c9b3da5ff275de541bf7120ceac | generated |
| Android splash | canonical SVG | apps/mobile-app/android/app/src/main/res/drawable-mdpi/splashscreen_logo.png | 288 x 288 | bb7f282affae33c388998d0ddf3d276a87681c9b3da5ff275de541bf7120ceac | native resource; device acceptance pending |
| Android standard (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-hdpi/ic_launcher.webp | 72 x 72 | 8ba021f7f0bd569651d511d5d22edacb962a7fac8c162402a74660cb5c59abd4 | generated |
| Android standard | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-hdpi/ic_launcher.webp | 72 x 72 | 8ba021f7f0bd569651d511d5d22edacb962a7fac8c162402a74660cb5c59abd4 | native resource; device acceptance pending |
| Android round (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-hdpi/ic_launcher_round.webp | 72 x 72 | cd5f03e053e935c2810527f9c870a3a495d82750722b083cec3eb1c2dc109210 | generated |
| Android round | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.webp | 72 x 72 | cd5f03e053e935c2810527f9c870a3a495d82750722b083cec3eb1c2dc109210 | native resource; device acceptance pending |
| Android foreground (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-hdpi/ic_launcher_foreground.webp | 162 x 162 | 01385d1e3e44f398fd93f0bb5e81ebcb3bcf1fdd8d02b9fbd421e20551b37fba | generated |
| Android foreground | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.webp | 162 x 162 | 01385d1e3e44f398fd93f0bb5e81ebcb3bcf1fdd8d02b9fbd421e20551b37fba | native resource; device acceptance pending |
| Android background (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-hdpi/ic_launcher_background.webp | 162 x 162 | 63b6c72a2c73d62a794e0b59297265d4de62e901c2e42d4523dc0d21e772473a | generated |
| Android background | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-hdpi/ic_launcher_background.webp | 162 x 162 | 63b6c72a2c73d62a794e0b59297265d4de62e901c2e42d4523dc0d21e772473a | native resource; device acceptance pending |
| Android monochrome (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-hdpi/ic_launcher_monochrome.webp | 162 x 162 | cf132b9cedc16324dfe98dd82e2c0f166b0f1d67d8f3fe3a55d57afd64cd15a1 | generated |
| Android monochrome | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-hdpi/ic_launcher_monochrome.webp | 162 x 162 | cf132b9cedc16324dfe98dd82e2c0f166b0f1d67d8f3fe3a55d57afd64cd15a1 | native resource; device acceptance pending |
| Android splash (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/drawable-hdpi/splashscreen_logo.png | 432 x 432 | d8d4b320a827ef41dd2d48da15e1221608f7f820ae0d3aa6afb2ccd65e2e4ee9 | generated |
| Android splash | canonical SVG | apps/mobile-app/android/app/src/main/res/drawable-hdpi/splashscreen_logo.png | 432 x 432 | d8d4b320a827ef41dd2d48da15e1221608f7f820ae0d3aa6afb2ccd65e2e4ee9 | native resource; device acceptance pending |
| Android standard (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xhdpi/ic_launcher.webp | 96 x 96 | 5833be4947c5d1aeca09e02c0922d2fbb1236ae17a14e042af91cb8d7004f399 | generated |
| Android standard | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xhdpi/ic_launcher.webp | 96 x 96 | 5833be4947c5d1aeca09e02c0922d2fbb1236ae17a14e042af91cb8d7004f399 | native resource; device acceptance pending |
| Android round (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xhdpi/ic_launcher_round.webp | 96 x 96 | 786429308cfa4fb597405cb937de44a27173f6729b9946fcd181c31a2e3c7ec7 | generated |
| Android round | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.webp | 96 x 96 | 786429308cfa4fb597405cb937de44a27173f6729b9946fcd181c31a2e3c7ec7 | native resource; device acceptance pending |
| Android foreground (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xhdpi/ic_launcher_foreground.webp | 216 x 216 | db588da6bd305b20ccc31335d4503477aa3870a93a24eb7601439703133e593e | generated |
| Android foreground | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.webp | 216 x 216 | db588da6bd305b20ccc31335d4503477aa3870a93a24eb7601439703133e593e | native resource; device acceptance pending |
| Android background (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xhdpi/ic_launcher_background.webp | 216 x 216 | d0f8fd2f74a60aef0e7c17616ba4f68ff696a4fb9035b2f09289ef725eabfdc6 | generated |
| Android background | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xhdpi/ic_launcher_background.webp | 216 x 216 | d0f8fd2f74a60aef0e7c17616ba4f68ff696a4fb9035b2f09289ef725eabfdc6 | native resource; device acceptance pending |
| Android monochrome (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xhdpi/ic_launcher_monochrome.webp | 216 x 216 | 54fb1b28eefc60ed3d0b0bdda47d405d0094b7c90cee16d5fe2bf3182643a89b | generated |
| Android monochrome | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xhdpi/ic_launcher_monochrome.webp | 216 x 216 | 54fb1b28eefc60ed3d0b0bdda47d405d0094b7c90cee16d5fe2bf3182643a89b | native resource; device acceptance pending |
| Android splash (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/drawable-xhdpi/splashscreen_logo.png | 576 x 576 | 7289ede2b919cd2902391337266439016f9cf4f637baac50524dda00b3289c9c | generated |
| Android splash | canonical SVG | apps/mobile-app/android/app/src/main/res/drawable-xhdpi/splashscreen_logo.png | 576 x 576 | 7289ede2b919cd2902391337266439016f9cf4f637baac50524dda00b3289c9c | native resource; device acceptance pending |
| Android standard (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxhdpi/ic_launcher.webp | 144 x 144 | d0e37d76bc7392da63df067a6137745c907644c932640b5d10368e3ede27d554 | generated |
| Android standard | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.webp | 144 x 144 | d0e37d76bc7392da63df067a6137745c907644c932640b5d10368e3ede27d554 | native resource; device acceptance pending |
| Android round (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxhdpi/ic_launcher_round.webp | 144 x 144 | d6f8c98aa1ee0dbfed588787d9693dfe7e66f0a8170769235b9991c3b0efe314 | generated |
| Android round | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.webp | 144 x 144 | d6f8c98aa1ee0dbfed588787d9693dfe7e66f0a8170769235b9991c3b0efe314 | native resource; device acceptance pending |
| Android foreground (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxhdpi/ic_launcher_foreground.webp | 324 x 324 | c8169f57b91a349c6fc34a0f78043893b3f76d5bdb1801fb67c8362d8b199ebb | generated |
| Android foreground | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp | 324 x 324 | c8169f57b91a349c6fc34a0f78043893b3f76d5bdb1801fb67c8362d8b199ebb | native resource; device acceptance pending |
| Android background (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxhdpi/ic_launcher_background.webp | 324 x 324 | d1e058694aa88aae3d433f35360514c2646a7dc3b8577e08cf9a752eacd0014f | generated |
| Android background | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_background.webp | 324 x 324 | d1e058694aa88aae3d433f35360514c2646a7dc3b8577e08cf9a752eacd0014f | native resource; device acceptance pending |
| Android monochrome (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxhdpi/ic_launcher_monochrome.webp | 324 x 324 | 1692f3ee472d6b83aba5b467d27143aa265259f177a651506c67be5f7c65c8cb | generated |
| Android monochrome | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_monochrome.webp | 324 x 324 | 1692f3ee472d6b83aba5b467d27143aa265259f177a651506c67be5f7c65c8cb | native resource; device acceptance pending |
| Android splash (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/drawable-xxhdpi/splashscreen_logo.png | 864 x 864 | 863d1c773fe974be46f4008960ea94bfedd4650fca8ed8b475a8e071ef6d5f53 | generated |
| Android splash | canonical SVG | apps/mobile-app/android/app/src/main/res/drawable-xxhdpi/splashscreen_logo.png | 864 x 864 | 863d1c773fe974be46f4008960ea94bfedd4650fca8ed8b475a8e071ef6d5f53 | native resource; device acceptance pending |
| Android standard (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxxhdpi/ic_launcher.webp | 192 x 192 | c7bd6312709ae7b3016c8f22b4b2f3c9249e31eea68aa29096599e12a2c9f630 | generated |
| Android standard | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp | 192 x 192 | c7bd6312709ae7b3016c8f22b4b2f3c9249e31eea68aa29096599e12a2c9f630 | native resource; device acceptance pending |
| Android round (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxxhdpi/ic_launcher_round.webp | 192 x 192 | 58a4f3e6cd573e3a8bf77c861ce5bb52ca4f1ddf85d9f0d22c6437777542d57d | generated |
| Android round | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp | 192 x 192 | 58a4f3e6cd573e3a8bf77c861ce5bb52ca4f1ddf85d9f0d22c6437777542d57d | native resource; device acceptance pending |
| Android foreground (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxxhdpi/ic_launcher_foreground.webp | 432 x 432 | 2986fb680149f202cdd5ee8114529d9bd3a6313ac864432b2210b42c8b19fcb6 | generated |
| Android foreground | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp | 432 x 432 | 2986fb680149f202cdd5ee8114529d9bd3a6313ac864432b2210b42c8b19fcb6 | native resource; device acceptance pending |
| Android background (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxxhdpi/ic_launcher_background.webp | 432 x 432 | 3c8d37cb3256d35247175f6ddc975b1278bc372ad4e1416ad5767ceba09f34c5 | generated |
| Android background | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_background.webp | 432 x 432 | 3c8d37cb3256d35247175f6ddc975b1278bc372ad4e1416ad5767ceba09f34c5 | native resource; device acceptance pending |
| Android monochrome (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-xxxhdpi/ic_launcher_monochrome.webp | 432 x 432 | d34792910613a6ca6456a8f1a80698903b5b7de84571d07e3d879b8b31908367 | generated |
| Android monochrome | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.webp | 432 x 432 | d34792910613a6ca6456a8f1a80698903b5b7de84571d07e3d879b8b31908367 | native resource; device acceptance pending |
| Android splash (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/drawable-xxxhdpi/splashscreen_logo.png | 1152 x 1152 | 1841b58cc8498925d189c1b40f00d655eacc6d1f1ddb295ff43a470ccfe1d348 | generated |
| Android splash | canonical SVG | apps/mobile-app/android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png | 1152 x 1152 | 1841b58cc8498925d189c1b40f00d655eacc6d1f1ddb295ff43a470ccfe1d348 | native resource; device acceptance pending |
| Android adaptive wiring (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-anydpi-v26/ic_launcher.xml | 108dp layers | 4bab3c59768636d72264d7db9321872f9325713beb66797b7dbfe41c11d90320 | generated |
| Android adaptive wiring | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml | 108dp layers | 4bab3c59768636d72264d7db9321872f9325713beb66797b7dbfe41c11d90320 | native resource; device acceptance pending |
| Android adaptive wiring (portable native source) | canonical SVG | apps/mobile-app/assets/brand/android-res/mipmap-anydpi-v26/ic_launcher_round.xml | 108dp layers | 4bab3c59768636d72264d7db9321872f9325713beb66797b7dbfe41c11d90320 | generated |
| Android adaptive wiring | canonical SVG | apps/mobile-app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml | 108dp layers | 4bab3c59768636d72264d7db9321872f9325713beb66797b7dbfe41c11d90320 | native resource; device acceptance pending |
| Website Navbar/Footer and Super Admin | canonical SVG | apps/website/src/components/brand/Logo.tsx | 64 x 64 viewBox; consumer size | 50bd3af5cd8c8cd7205365a444da93f0757b124db3e02efe9aff970868e206f4 | canonical existing implementation |
| Shared horizontal lockup | canonical SVG | apps/website/public/opa-logo-horizontal.svg | 220 x 64 vector | e927ba778c4475160ad3e5a8c4f3cd7bcef6641c6e0ff91a3769289ef363b798 | canonical existing implementation |

Navbar/Footer display Logo.tsx at 34px; Super Admin login at 40px and shell at 36px. Their geometry remains a 64-unit vector viewBox. Marketing CSS is presentation code and no longer overrides its colors.

### Preservation and change attribution

The pre-change checkpoint is artifacts/brand/validation/before-files.json. It covers source/native files and the Git index, excluding dependencies, build/caches and historical artifacts. Exact brand-attributed file changes are recorded in artifacts/brand/changed-files.json. Backend, SMS, mobile service/module source, manifest, app_name and Git index hashes are checked against it. Independently occurring incident-detail.tsx and openvpn.log changes are recorded separately and were not reverted or incorporated as brand fixes.

Nothing staged. Nothing committed. Nothing pushed. Nothing deployed. Nothing submitted.
