/* global __dirname, console */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const before = JSON.parse(cp.execFileSync('git', ['-c', 'safe.directory=C:/Projects/OPA', 'show', '3ae25962fae46103408b0e0d180bcc8dca4a9069:package-lock.json'], { cwd: root }));
const after = read('package-lock.json');
const audit = read('docs/security/dependency-audit-before.json');
const current = read('docs/security/dependency-audit-after.json');
const artifactPath = path.join(root, 'evidence-local/dependency-hardening-final/node_modules/.package-lock.json');
const artifact = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath)) : null;
function resolve(from, name) {
  let dir = from;
  for (;;) {
    const candidate = (dir ? dir + '/' : '') + 'node_modules/' + name;
    if (before.packages[candidate]) return candidate;
    if (!dir) return null;
    const parent = path.posix.dirname(dir);
    dir = parent === '.' ? '' : parent;
  }
}
const chains = new Map();
for (const workspace of ['', 'apps/api']) {
  const manifest = before.packages[workspace];
  for (const [kind, deps] of Object.entries({runtime: manifest.dependencies, dev: manifest.devDependencies})) {
    for (const name of Object.keys(deps ?? {})) {
      const first = resolve(workspace, name);
      if (!first) continue;
      const queue = [[first, [(workspace || 'root') + ' (' + kind + ')']]];
      const seen = new Set();
      while (queue.length) {
        const [p, trail] = queue.shift();
        if (seen.has(p)) continue;
        seen.add(p);
        const pkg = before.packages[p];
        const chain = [...trail, p + '@' + pkg.version];
        if (!chains.has(p)) chains.set(p, []);
        chains.get(p).push(chain.join(' -> '));
        for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
          const target = resolve(p, dependency);
          if (target) queue.push([target, chain]);
        }
      }
    }
  }
}
function advisories(name, visited = new Set()) {
  if (visited.has(name)) return [];
  visited.add(name);
  return (audit.vulnerabilities[name]?.via ?? []).flatMap(v => typeof v === 'string' ? advisories(v, visited) : [v]);
}
const assessments = {
  tar: ['B: BUILD/INSTALL', 'bcrypt install -> node-pre-gyp/lib/install.js -> tar.extract. bcrypt runtime calls node-pre-gyp.find only; no OPA archive extraction call found. Baseline lock includes tar in production dependencies; deployed inventory unavailable.', 'bcrypt 6.0.0 removes chain; critical alone fixed in tar 7.5.19, other reported tar ranges extend through 7.5.20; parent removal avoids all of them.', 'Major bcrypt upgrade; verify persisted hashes and native artifact binding.'],
  bcrypt: ['B for inherited tar advisory; bcrypt itself runtime', 'Auth, activation, enrollment, password reset and SSO call hash/compare. These do not invoke tar extraction.', '6.0.0', 'Major native installer change; public bcrypt5 fixture and API tests.'],
  '@mapbox/node-pre-gyp': ['B: BUILD/INSTALL', 'Installer extracts native binary; runtime find locates binary without extraction.', 'Removed through bcrypt 6.0.0', 'Parent major; no tar override.'],
  multer: ['A: PRODUCTION-REACHABLE', 'EvidenceController FileInterceptor consumes authenticated incident upload multipart data; size cap does not by itself prevent parser DoS.', '2.3.0', 'Same-major scoped override; Nest 10.4.22 pins 2.0.2; valid, oversized, unexpected and truncated uploads tested.'],
  '@nestjs/platform-express': ['A: PRODUCTION-REACHABLE', 'Evidence upload uses its Multer interceptor; Nest adapter also serves API.', 'Scoped multer 2.3.0 override; parent remains 10.4.22', 'Avoid Nest framework major; retain moderate/low inherited findings for explicit review.'],
  africastalking: ['E: vulnerable functionality needs per-advisory proof; runtime library reachable', 'SmsProvider lazy-loads SDK then SMS.send. Outbound destination is SDK-defined, recipients/messages flow to SDK. No blanket exploitability claim for Axios advisories.', '0.8.3 brings axios 1.18.1 and lodash 4.18.1', 'Pre-1.0 minor is potentially breaking; real SDK mocked-transport regression plus provider tests.'],
  axios: ['E: vulnerable functionality needs per-advisory proof; runtime library reachable', 'Africa Talking SMS uses axios with fixed HTTPS endpoint and form data. No inbound arbitrary URL API found in SmsProvider.', '1.18.0 minimum for listed advisories; resolved 1.18.1 via SDK parent', 'Parent 0.8.3 potentially breaking; no Axios override.'],
  'fast-xml-parser': ['E: requires further input-reachability proof', 'Azure storage SDK dependency; evidence storage uses Azure. Not the SSO XML parser. Malicious XML response path not demonstrated.', '5.10.1 minimum; resolved compatible 5.11.1', 'Same-major update; entities/strnum changes are parser dependency closure.'],
  'js-yaml': ['E for runtime dump; B/C for tooling', 'SwaggerModule uses dump for generated OpenAPI YAML, not arbitrary YAML load. Test/coverage tooling also loads YAML. Vulnerable input path not established.', '3.15.2 / 4.3.2', 'Same-major updates and scoped Swagger 4.3.2 override.'],
  lodash: ['E: requires per-function input proof', 'Nest config/Swagger and SMS SDK load lodash. Runtime package use is established; exploit of affected functions is not.', '4.18.1 (verified fixed resolved version)', 'Same-major exact overrides for pinned Nest parents; SDK parent supplies fixed version.'],
  'deepmerge-ts': ['B: configuration tooling; installed artifact inclusion checked separately', 'Prisma config dynamically imports deepmerge for c12 configuration. OPA has no prisma.config file or runtime deepmerge import; API uses generated Prisma client.', '8.0.0', 'Major override: Map merging/type changes; OPA uses schema config, not custom Map merge. Config record/circular regression plus Prisma validate/generate/migrations.'],
  '@prisma/config': ['B: configuration tooling', 'Prisma CLI configuration loader; may ship through optional Prisma client peer dependency. Package presence does not prove request reachability.', 'Scoped deepmerge-ts 8.0.0 override', 'Retain Prisma 6.19.3; generation and PostgreSQL tests required.'],
  prisma: ['B: build/migration tooling', 'CLI generates client during build/artifact assembly. API executes generated client. Production lock may include CLI through optional peer.', 'Scoped deepmerge-ts 8.0.0 override', 'No Prisma major/schema migration change.'],
  '@nestjs/cli': ['B: BUILD/CI-ONLY', 'nest build compiler and scaffolding dependencies. CLI is devDependency; artifact presence verified separately.', 'Scoped glob 10.5.0, picomatch 4.0.4 and tmp 0.2.7 fixes', 'Avoid Nest CLI 12 major; other lower-severity tooling findings remain separately recorded.'],
  glob: ['B: BUILD/CI-ONLY', 'Nest CLI pins glob; affected CLI command execution option not found in OPA scripts.', '10.5.0', 'Same-major exact parent override. Jest glob 7 copies are not in reported affected range.'],
  picomatch: ['B: BUILD/CI-ONLY', 'Angular devkit under Nest CLI uses glob matching; no API runtime import found.', '4.0.4', 'Patch scoped override. Unaffected v2 copies retained.'],
  tmp: ['C: DEV-ONLY', 'Nest CLI -> inquirer -> external-editor -> tmp.tmpNameSync. Build does not invoke interactive external editor.', '0.2.7 (0.2.6 introduced GHSA-7c78-jf6q-g5cm)', 'Pre-1.0 minor override; tmpNameSync compatibility test.'],
  browserslist: ['B: BUILD/CI-ONLY', 'Compiler/webpack browser target data; dev dependency graph.', '4.28.7 minimum; resolved 4.28.9', 'Same-major; associated browser databases are reviewed update closure.'],
  'brace-expansion': ['B/C: build/test tooling; baseline installer copy also shipped', 'Glob/minimatch in lint/test/build tools; baseline rimraf installer copy is removed with bcrypt installer. No OPA runtime pattern API found.', '1.1.18 / 2.1.4 / 5.0.9', 'Compatible per-major updates; no forced single-major override.'],
};
const rows = Object.values(audit.vulnerabilities).filter(v => ['high', 'critical'].includes(v.severity)).map(v => {
 const assessment = assessments[v.name];
 return { package: v.name, severity: v.severity, direct: v.isDirect, affectedWorkspace: 'apps/api (root also contains development tooling)', instances: v.nodes.map(p => ({ path: p, vulnerableVersion: before.packages[p]?.version, baselineDevOnly: before.packages[p]?.dev === true, baselineProductionGraph: before.packages[p]?.dev !== true, chains: chains.get(p) ?? [], currentVersionAtPath: after.packages[p]?.version ?? 'removed/relocated', currentArtifactVersion: artifact?.packages[p]?.version ?? (artifact ? 'absent' : 'NOT VERIFIED') })), advisories: advisories(v.name).map(a => ({url:a.url,title:a.title,severity:a.severity,affectedRange:a.range})), classification: assessment[0], reachability: assessment[1], fixedVersionAndRemediation: assessment[2], compatibilityAndRisk: assessment[3], remainingSeverity: current.vulnerabilities[v.name]?.severity ?? 'none', deployedProductionStatus: 'UNKNOWN: no deployed lockfile/SBOM or authenticated deployment inventory available' };
});
const drift = [];
for (const p of new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])) {
 const a = before.packages[p], b = after.packages[p];
 if (!a || !b || a.version !== b.version || a.integrity !== b.integrity) drift.push({path:p,before:a?.version ?? null,after:b?.version ?? null,integrityChanged:!!a && !!b && a.integrity!==b.integrity});
}
const output = {baselineHead:'3ae25962fae46103408b0e0d180bcc8dca4a9069',baselineTotals:audit.metadata.vulnerabilities,currentTotals:current.metadata.vulnerabilities,artifactVerified:!!artifact,highCritical:rows,remainingFindings:current.vulnerabilities,drift};
fs.writeFileSync(path.join(root,'docs/security/dependency-disposition.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({before:output.baselineTotals,after:output.currentTotals,findings:rows.length,driftEntries:drift.length,artifactVerified:!!artifact},null,2));

// Preserve severities; four remaining package entries share one upstream advisory.
const validationFile = path.join(root, 'docs/security/dependency-validation.json');
const validation = fs.existsSync(validationFile) ? JSON.parse(fs.readFileSync(validationFile, 'utf8').replace(/^\uFEFF/, '')) : {};
const semver = require('semver');
const downgrades = drift.filter(d => d.before && d.after && semver.valid(d.before) && semver.valid(d.after) && semver.lt(d.after, d.before));
const pins = ['jose', 'oauth4webapi', 'xml-crypto', '@xmldom/xmldom', 'openid-client', '@node-saml/node-saml'];
const preservedSsoPins = pins.every(n => before.packages['node_modules/' + n]?.version === after.packages['node_modules/' + n]?.version);
const proofFile = path.join(root, 'evidence-local/dependency-hardening-final/dependency-proof.json');
const proof = fs.existsSync(proofFile) ? JSON.parse(fs.readFileSync(proofFile)) : null;
const validationSuccessful = key => key === 'postgres' ? validation.postgres === 0 || validation.postgresRecheckCoversFailures === true : validation[key] === 0;
const pass = key => validation[key] === 0 ? 'PASS' : validation[key] === undefined ? 'NOT EXECUTED / NOT RECORDED' : 'FAIL';
const lines = [
 '# OPA dependency release-hardening report',
 '',
 'Repository: C:\\Projects\\OPA. Branch: integration/institutional-security. Baseline HEAD: 3ae25962fae46103408b0e0d180bcc8dca4a9069.',
 'Generated: ' + new Date().toISOString() + '. No commit, push, merge, or deployment performed.',
 '',
 'AUDIT COMMAND: node "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" audit --json (authoritative repository root). The audit gate is npm run dependencies:audit, which fails at high or critical.',
 'TOTAL FINDINGS: ' + audit.metadata.vulnerabilities.total + ' before; ' + current.metadata.vulnerabilities.total + ' after.',
 'CRITICAL: 1 before; ' + current.metadata.vulnerabilities.critical + ' after.',
 'HIGH: 18 before; ' + current.metadata.vulnerabilities.high + ' after.',
 'MODERATE: 14 before; ' + current.metadata.vulnerabilities.moderate + ' after.',
 'LOW: 4 before; ' + current.metadata.vulnerabilities.low + ' after.',
 'The raw audit exit code remains 1 for the four moderate entries; the high/critical gate passes. CI pins npm 11.17.0 and verifies npm ls --all before the audit and regression checks.',
 '',
 '## Critical finding',
 '',
 'CRITICAL PACKAGE: tar 6.2.1.',
 'CRITICAL ADVISORY: [GHSA-23hp-3jrh-7fpw / CVE-2026-59873](https://github.com/advisories/GHSA-23hp-3jrh-7fpw). Severity remains CRITICAL.',
 'DEPENDENCY CHAIN: root workspace -> @opa/api -> bcrypt 5.1.1 -> @mapbox/node-pre-gyp 1.0.11 -> tar 6.2.1.',
 'AFFECTED WORKSPACE: apps/api.',
 'DIRECT OR TRANSITIVE: transitive.',
 'PRODUCTION ARTIFACT: baseline lock marks the chain as production dependencies; final assembled artifact has no tar or node-pre-gyp. Baseline deployed artifact was not available for inspection.',
 'RUNTIME REACHABILITY: authentication, activation, password reset, enrollment, and SSO call bcrypt.hash/compare. bcrypt loads node-pre-gyp.find to locate the native binary; archive extraction occurs in node-pre-gyp/lib/install.js, not these request paths. Source search found no OPA tar extraction usage.',
 'CLASSIFICATION: B. BUILD/INSTALL/CI-ONLY vulnerable execution, with baseline production package inclusion. This classification does not lower advisory severity.',
 'FIXED VERSION: upstream tar 7.5.19 fixes the critical advisory; other reported tar ranges extend through 7.5.20. The chosen fix removes the whole vulnerable installer chain.',
 'MINIMAL REMEDIATION: [bcrypt 6.0.0](https://github.com/kelektiv/node.bcrypt.js/releases/tag/v6.0.0), replacing node-pre-gyp with bundled prebuilds/node-gyp-build. No tar override or package-content patch.',
 'BREAKING CHANGE RISK: bcrypt major native-install change. Existing bcrypt 5 hash verification, wrong-password rejection, new hash generation, native artifact loading, and API/SSO tests provide compatibility evidence. Windows Node 26.5.0 was tested locally; the configured Linux Node 22 CI job has not been run remotely.',
 '',
 '## High and critical inventory',
 '',
 'The linked JSON records every baseline HIGH/CRITICAL package instance, vulnerable version, directness, dependency chains, workspace, dev/production graph flags, final artifact inclusion, advisory URLs/ranges, fixed versions, compatibility risks, and runtime assessment. Parent advisories are expanded through their vulnerable children. Package-manager classifications are not treated as exploitability proof.',
 '',
 '[Full instance and advisory inventory](dependency-disposition.json). [Baseline audit](dependency-audit-before.json). [Final audit](dependency-audit-after.json).',
 '',
 '| Package | Baseline version(s) | Severity | Exposure classification | Final status |',
 '| --- | --- | --- | --- | --- |',
 ...rows.map(r => '| ' + r.package + ' | ' + [...new Set(r.instances.map(i => i.vulnerableVersion))].join(', ') + ' | ' + r.severity + ' | ' + r.classification + ' | ' + r.remainingSeverity + ' |'),
 '',
 '## Remediation and overrides',
 '',
 'Direct parent changes: bcrypt 5.1.1 -> 6.0.0; africastalking 0.7.9 -> 0.8.3. The SDK parent supplies fixed Axios/lodash. Its real request-form and response contracts were tested through an in-process Axios adapter; no SMS was sent.',
 'Compatible leaf updates cover brace-expansion (each existing major), browserslist, fast-xml-parser and js-yaml. Additional exact overrides cover pinned Nest/Prisma tooling, multipart and HTTP parsers, Joi, and file-type. Each new override maps to an audit finding; none changes the four existing SSO overrides.',
 'Nest 10.4.22 is the latest published Nest 10 platform version in the captured upstream listing; Prisma 6.19.3 is the latest Prisma 6 version in its listing. Framework/ORM major upgrades were avoided. [deepmerge-ts 8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) changes Map merging and types: OPA does not define a custom Prisma config or use that Map behavior; record/circular checks and Prisma generation/migrations exercise the supported OPA usage. file-type 21 retains the fileTypeFromBuffer API used by Nest and is checked with the real Nest validator.',
 'Override compatibility coverage: persisted bcrypt hashes; real Nest FileInterceptor valid/oversize/unexpected/truncated multipart; YAML document serialization; lodash configuration merge; Prisma deepmerge; glob/picomatch; tmpNameSync; real SDK form/response validation; Nest file-type recognition; Express JSON/form parsing and size enforcement; AJV schema validation; and a real webpack fixture compilation. Prisma, build, tree and artifact checks complement these tests.',
 '',
 'FILES CHANGED: package.json; apps/api/package.json; package-lock.json; .github/workflows/main_opa-api-production.yml; apps/api/test/sso/fixtures.ts; new dependency-security-regression.cjs and dependency-disposition.cjs under apps/api/scripts; dependency evidence/report files under docs/security. Existing .gitignore changes and other preexisting untracked files belong to the user and were preserved.',
 'PACKAGE FILES CHANGED: root package.json and apps/api/package.json.',
 'LOCKFILE CHANGED: YES, authoritative root lock only. Root/API workspace layout and artifact assembly algorithm preserved.',
 'DEPENDENCY DRIFT: ' + drift.length + ' added/removed/version-or-integrity records enumerated in dependency-disposition.json. Updates reviewed as security target closure: native installer replacement, SDK HTTP/validation dependencies, parser/tokenizer dependencies, browser target data, webpack lexer dependencies, and debug/ms relocations required by the HTTP parser versions. No unchanged-version integrity replacement or package removal is accepted without review. Same-path version downgrades: ' + downgrades.length + '.',
 'SSO PINS PRESERVED: ' + preservedSsoPins + '.',
 'CLEAN INSTALL: ' + pass('ci') + '.',
 'DEPENDENCY TREE: ' + pass('tree') + '.',
 'FOCUSED TESTS: ' + pass('focused') + ' (' + validation.focusedTests + ' tests); see dependency-focused.log.',
 'FULL API: ' + pass('api') + ' ' + JSON.stringify(validation.apiCounts) + '; see dependency-api-tests-final.log. OPA_ENVIRONMENT=development applies to mocked tests, not runtime deployment configuration.',
 'WEBSITE: NOT RUN; independent workspace/lockfile unaffected by this root API-only dependency graph.',
 'MOBILE: NOT RUN; independent workspace/lockfile unaffected by this root API-only dependency graph.',
 'POSTGRES: full run ' + pass('postgres') + ' ' + JSON.stringify(validation.postgresCounts) + '; isolated retry ' + pass('postgresRecheck') + ' ' + JSON.stringify(validation.postgresRecheckCounts) + '; all failed suites covered by successful retry: ' + validation.postgresRecheckCoversFailures + '. Guarded _test database, PostgreSQL 16.14, 35 real migrations. See dependency-postgres-final.log and dependency-postgres-isolated.log. Original failures were cleanup-hook timeouts and a temporary localhost database connection failure, before assertions; no timeout or runtime logic was changed.',
 'PRISMA: validate ' + pass('prismaValidate') + '; generate ' + pass('prismaGenerate') + '.',
 'TYPESCRIPT: ' + pass('typescript') + '.',
 'BUILDS: ' + pass('build') + '.',
 'LINT: ' + pass('lint') + '; changed CJS scripts and SSO fixture; workflow YAML parsed separately.',
 'DIFF CHECK: ' + pass('diffCheck') + '.',
 'PRODUCTION ARTIFACT: ' + pass('artifact') + '; ' + (proof ? proof.packagesVerified + ' packages; lock SHA-256 ' + proof.lockSha256 : 'proof not available') + '. Runtime smoke verification: ' + pass('artifactRuntime') + '.',
 '',
 '## Remaining advisory and temporary disposition',
 '',
 'REMAINING CRITICAL FINDINGS: ' + current.metadata.vulnerabilities.critical + '.',
 'REMAINING HIGH FINDINGS: ' + current.metadata.vulnerabilities.high + '.',
 'TEMPORARY DISPOSITION DEP-NEST-SSE-2026: Four moderate package entries (@nestjs/core, @nestjs/platform-express, @nestjs/swagger, @nestjs/testing) represent one upstream issue: [GHSA-36xv-jgw5-4q75 / CVE-2026-35515](https://github.com/advisories/GHSA-36xv-jgw5-4q75).',
 'Affected functionality: Nest SseStream interpolates untrusted SSE message type/id fields. Source search of apps/api/src found no @Sse, SseStream, text/event-stream or EventSource usage. Class D for the currently reviewed source; severity remains MODERATE. Core/platform/Swagger ship in the artifact; @nestjs/testing is development-only.',
 'No fixed Nest 10 release was found. Upstream first fixed version is 11.1.18, requiring coordinated Nest framework/peer migration. Do not override only @nestjs/core across a major. Track a tested migration to >=11.1.18 before adding SSE. Re-review on any SSE implementation, Nest dependency change, or by 2026-10-11, whichever occurs first. Responsible role: API maintainers/security release owner (assignment requires project ownership, not assumed acceptance). This is documented residual exposure, not a silent audit exclusion.',
 '',
 '## Security regression and release decision',
 '',
 'No runtime security source or staging/migration guard changed. The SSO test fixture now isolates its typed public configuration from developer environment strings, matching the existing enrollment-test pattern. Existing signed OIDC/SAML verification, PII crypto, tenant isolation, Delivery Confirmation, SafeWalk, Silent SOS, Command Center, Super Admin and staging-policy suites are included in API/PostgreSQL validation; their actual pass/fail results above control readiness.',
 'Initial failures are retained in local logs: missing OPA_ENVIRONMENT caused 12 provider unit failures; developer environment values contaminated SSO settings; one delivery transaction-start timeout occurred. Explicit test environment/fixture isolation addressed the first two. No runtime guard or transaction timeout was relaxed. Final logs record re-execution.',
 'DEPLOYED PRODUCTION BUILD: UNKNOWN. No authenticated deployed lockfile/SBOM or deployment inventory was available. Local branch state is not evidence of what Azure currently runs. No deployment was attempted.',
 'SAFE TO COMMIT: ' + (['ci','tree','focused','api','postgres','prismaValidate','prismaGenerate','typescript','build','lint','diffCheck','artifact','artifactRuntime'].every(validationSuccessful) && !downgrades.length && preservedSsoPins ? 'YES, scoped dependency change and evidence only' : 'NO until all recorded validation failures/unexecuted checks are resolved') + '.',
 'SAFE TO PROCEED TO STAGING PROVISIONING: ' + (['ci','tree','focused','api','postgres','build','artifact','artifactRuntime'].every(validationSuccessful) ? 'YES from this source dependency perspective; existing staging provisioning safeguards still apply' : 'NO until validation completes') + '.',
 'SAFE FOR PRODUCTION RELEASE FROM DEPENDENCY PERSPECTIVE: NO. The Node 22/Linux CI artifact remains unexecuted, the moderate Nest disposition needs release-owner review, and the currently deployed build inventory remains unverified.',
 '',
 'Machine-readable exit codes: [dependency-validation.json](dependency-validation.json). Logs are local evidence (the repository ignores *.log).',
];
fs.writeFileSync(path.join(root,'docs/security/dependency-release-hardening.md'),lines.flatMap(line => /^[A-Z][A-Z /-]+:/.test(line) ? [line, ''] : [line]).join('\n')+'\n');
