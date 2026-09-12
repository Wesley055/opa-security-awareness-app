# OPA dependency release-hardening report

Repository: C:\Projects\OPA. Branch: integration/institutional-security. Baseline HEAD: 3ae25962fae46103408b0e0d180bcc8dca4a9069.
Generated: 2026-09-11T21:05:51.531Z. No commit, push, merge, or deployment performed.

AUDIT COMMAND: node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" audit --json (authoritative repository root). The audit gate is npm run dependencies:audit, which fails at high or critical.

TOTAL FINDINGS: 37 before; 4 after.

CRITICAL: 1 before; 0 after.

HIGH: 18 before; 0 after.

MODERATE: 14 before; 4 after.

LOW: 4 before; 0 after.

The raw audit exit code remains 1 for the four moderate entries; the high/critical gate passes. CI pins npm 11.17.0 and verifies npm ls --all before the audit and regression checks.

## Critical finding

CRITICAL PACKAGE: tar 6.2.1.

CRITICAL ADVISORY: [GHSA-23hp-3jrh-7fpw / CVE-2026-59873](https://github.com/advisories/GHSA-23hp-3jrh-7fpw). Severity remains CRITICAL.

DEPENDENCY CHAIN: root workspace -> @opa/api -> bcrypt 5.1.1 -> @mapbox/node-pre-gyp 1.0.11 -> tar 6.2.1.

AFFECTED WORKSPACE: apps/api.

DIRECT OR TRANSITIVE: transitive.

PRODUCTION ARTIFACT: baseline lock marks the chain as production dependencies; final assembled artifact has no tar or node-pre-gyp. Baseline deployed artifact was not available for inspection.

RUNTIME REACHABILITY: authentication, activation, password reset, enrollment, and SSO call bcrypt.hash/compare. bcrypt loads node-pre-gyp.find to locate the native binary; archive extraction occurs in node-pre-gyp/lib/install.js, not these request paths. Source search found no OPA tar extraction usage.

CLASSIFICATION: B. BUILD/INSTALL/CI-ONLY vulnerable execution, with baseline production package inclusion. This classification does not lower advisory severity.

FIXED VERSION: upstream tar 7.5.19 fixes the critical advisory; other reported tar ranges extend through 7.5.20. The chosen fix removes the whole vulnerable installer chain.

MINIMAL REMEDIATION: [bcrypt 6.0.0](https://github.com/kelektiv/node.bcrypt.js/releases/tag/v6.0.0), replacing node-pre-gyp with bundled prebuilds/node-gyp-build. No tar override or package-content patch.

BREAKING CHANGE RISK: bcrypt major native-install change. Existing bcrypt 5 hash verification, wrong-password rejection, new hash generation, native artifact loading, and API/SSO tests provide compatibility evidence. Windows Node 26.5.0 was tested locally; the configured Linux Node 22 CI job has not been run remotely.


## High and critical inventory

The linked JSON records every baseline HIGH/CRITICAL package instance, vulnerable version, directness, dependency chains, workspace, dev/production graph flags, final artifact inclusion, advisory URLs/ranges, fixed versions, compatibility risks, and runtime assessment. Parent advisories are expanded through their vulnerable children. Package-manager classifications are not treated as exploitability proof.

[Full instance and advisory inventory](dependency-disposition.json). [Baseline audit](dependency-audit-before.json). [Final audit](dependency-audit-after.json).

| Package | Baseline version(s) | Severity | Exposure classification | Final status |
| --- | --- | --- | --- | --- |
| @mapbox/node-pre-gyp | 1.0.11 | high | B: BUILD/INSTALL | none |
| @nestjs/cli | 10.4.9 | high | B: BUILD/CI-ONLY | none |
| @nestjs/platform-express | 10.4.22 | high | A: PRODUCTION-REACHABLE | moderate |
| @prisma/config | 6.19.3 | high | B: configuration tooling | none |
| africastalking | 0.7.9 | high | E: vulnerable functionality needs per-advisory proof; runtime library reachable | none |
| axios | 1.13.5 | high | E: vulnerable functionality needs per-advisory proof; runtime library reachable | none |
| bcrypt | 5.1.1 | high | B for inherited tar advisory; bcrypt itself runtime | none |
| brace-expansion | 1.1.16, 5.0.7, 2.1.2 | high | B/C: build/test tooling; baseline installer copy also shipped | none |
| browserslist | 4.28.5 | high | B: BUILD/CI-ONLY | none |
| deepmerge-ts | 7.1.5 | high | B: configuration tooling; installed artifact inclusion checked separately | none |
| fast-xml-parser | 5.10.0 | high | E: requires further input-reachability proof | none |
| glob | 10.4.5 | high | B: BUILD/CI-ONLY | none |
| js-yaml | 3.15.0, 4.1.0, 4.3.0 | high | E for runtime dump; B/C for tooling | none |
| lodash | 4.17.23, 4.17.21 | high | E: requires per-function input proof | none |
| multer | 2.0.2 | high | A: PRODUCTION-REACHABLE | none |
| picomatch | 4.0.1 | high | B: BUILD/CI-ONLY | none |
| prisma | 6.19.3 | high | B: build/migration tooling | none |
| tar | 6.2.1 | critical | B: BUILD/INSTALL | none |
| tmp | 0.0.33 | high | C: DEV-ONLY | none |

## Remediation and overrides

Direct parent changes: bcrypt 5.1.1 -> 6.0.0; africastalking 0.7.9 -> 0.8.3. The SDK parent supplies fixed Axios/lodash. Its real request-form and response contracts were tested through an in-process Axios adapter; no SMS was sent.
Compatible leaf updates cover brace-expansion (each existing major), browserslist, fast-xml-parser and js-yaml. Additional exact overrides cover pinned Nest/Prisma tooling, multipart and HTTP parsers, Joi, and file-type. Each new override maps to an audit finding; none changes the four existing SSO overrides.
Nest 10.4.22 is the latest published Nest 10 platform version in the captured upstream listing; Prisma 6.19.3 is the latest Prisma 6 version in its listing. Framework/ORM major upgrades were avoided. [deepmerge-ts 8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) changes Map merging and types: OPA does not define a custom Prisma config or use that Map behavior; record/circular checks and Prisma generation/migrations exercise the supported OPA usage. file-type 21 retains the fileTypeFromBuffer API used by Nest and is checked with the real Nest validator.
Override compatibility coverage: persisted bcrypt hashes; real Nest FileInterceptor valid/oversize/unexpected/truncated multipart; YAML document serialization; lodash configuration merge; Prisma deepmerge; glob/picomatch; tmpNameSync; real SDK form/response validation; Nest file-type recognition; Express JSON/form parsing and size enforcement; AJV schema validation; and a real webpack fixture compilation. Prisma, build, tree and artifact checks complement these tests.

FILES CHANGED: package.json; apps/api/package.json; package-lock.json; .github/workflows/main_opa-api-production.yml; apps/api/test/sso/fixtures.ts; new dependency-security-regression.cjs and dependency-disposition.cjs under apps/api/scripts; dependency evidence/report files under docs/security. Existing .gitignore changes and other preexisting untracked files belong to the user and were preserved.

PACKAGE FILES CHANGED: root package.json and apps/api/package.json.

LOCKFILE CHANGED: YES, authoritative root lock only. Root/API workspace layout and artifact assembly algorithm preserved.

DEPENDENCY DRIFT: 101 added/removed/version-or-integrity records enumerated in dependency-disposition.json. Updates reviewed as security target closure: native installer replacement, SDK HTTP/validation dependencies, parser/tokenizer dependencies, browser target data, webpack lexer dependencies, and debug/ms relocations required by the HTTP parser versions. No unchanged-version integrity replacement or package removal is accepted without review. Same-path version downgrades: 0.

SSO PINS PRESERVED: true.

CLEAN INSTALL: PASS.

DEPENDENCY TREE: PASS.

FOCUSED TESTS: PASS (12 tests); see dependency-focused.log.

FULL API: PASS {"failed":0,"passed":911,"total":911}; see dependency-api-tests-final.log. OPA_ENVIRONMENT=development applies to mocked tests, not runtime deployment configuration.

WEBSITE: NOT RUN; independent workspace/lockfile unaffected by this root API-only dependency graph.

MOBILE: NOT RUN; independent workspace/lockfile unaffected by this root API-only dependency graph.

POSTGRES: full run FAIL {"failed":4,"passed":208,"total":212}; isolated retry PASS {"failed":0,"passed":14,"total":14}; all failed suites covered by successful retry: true. Guarded _test database, PostgreSQL 16.14, 35 real migrations. See dependency-postgres-final.log and dependency-postgres-isolated.log. Original failures were cleanup-hook timeouts and a temporary localhost database connection failure, before assertions; no timeout or runtime logic was changed.

PRISMA: validate PASS; generate PASS.

TYPESCRIPT: PASS.

BUILDS: PASS.

LINT: PASS; changed CJS scripts and SSO fixture; workflow YAML parsed separately.

DIFF CHECK: PASS.

PRODUCTION ARTIFACT: PASS; 292 packages; lock SHA-256 7be52eec344de78954dd17fa2477556babd6fa79c2ff7bcb97c494e10ecb7a6d. Runtime smoke verification: PASS.


## Remaining advisory and temporary disposition

REMAINING CRITICAL FINDINGS: 0.

REMAINING HIGH FINDINGS: 0.

TEMPORARY DISPOSITION DEP-NEST-SSE-2026: Four moderate package entries (@nestjs/core, @nestjs/platform-express, @nestjs/swagger, @nestjs/testing) represent one upstream issue: [GHSA-36xv-jgw5-4q75 / CVE-2026-35515](https://github.com/advisories/GHSA-36xv-jgw5-4q75).
Affected functionality: Nest SseStream interpolates untrusted SSE message type/id fields. Source search of apps/api/src found no @Sse, SseStream, text/event-stream or EventSource usage. Class D for the currently reviewed source; severity remains MODERATE. Core/platform/Swagger ship in the artifact; @nestjs/testing is development-only.
No fixed Nest 10 release was found. Upstream first fixed version is 11.1.18, requiring coordinated Nest framework/peer migration. Do not override only @nestjs/core across a major. Track a tested migration to >=11.1.18 before adding SSE. Re-review on any SSE implementation, Nest dependency change, or by 2026-10-11, whichever occurs first. Responsible role: API maintainers/security release owner (assignment requires project ownership, not assumed acceptance). This is documented residual exposure, not a silent audit exclusion.

## Security regression and release decision

No runtime security source or staging/migration guard changed. The SSO test fixture now isolates its typed public configuration from developer environment strings, matching the existing enrollment-test pattern. Existing signed OIDC/SAML verification, PII crypto, tenant isolation, Delivery Confirmation, SafeWalk, Silent SOS, Command Center, Super Admin and staging-policy suites are included in API/PostgreSQL validation; their actual pass/fail results above control readiness.
Initial failures are retained in local logs: missing OPA_ENVIRONMENT caused 12 provider unit failures; developer environment values contaminated SSO settings; one delivery transaction-start timeout occurred. Explicit test environment/fixture isolation addressed the first two. No runtime guard or transaction timeout was relaxed. Final logs record re-execution.
DEPLOYED PRODUCTION BUILD: UNKNOWN. No authenticated deployed lockfile/SBOM or deployment inventory was available. Local branch state is not evidence of what Azure currently runs. No deployment was attempted.

SAFE TO COMMIT: YES, scoped dependency change and evidence only.

SAFE TO PROCEED TO STAGING PROVISIONING: YES from this source dependency perspective; existing staging provisioning safeguards still apply.

SAFE FOR PRODUCTION RELEASE FROM DEPENDENCY PERSPECTIVE: NO. The Node 22/Linux CI artifact remains unexecuted, the moderate Nest disposition needs release-owner review, and the currently deployed build inventory remains unverified.


Machine-readable exit codes: [dependency-validation.json](dependency-validation.json). Logs are local evidence (the repository ignores *.log).
