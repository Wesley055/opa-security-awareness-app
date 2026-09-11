// Read-only graph and license inventory. The audit command writes evidence only.
/* global __dirname, process, console */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
const baseline = JSON.parse(execFileSync('git', ['show', 'HEAD:package-lock.json'], { cwd: root, encoding: 'utf8' }));
const additions = Object.entries(lock.packages).filter(([p]) => !baseline.packages[p]);
const changes = Object.entries(lock.packages).filter(([p, v]) => baseline.packages[p] && baseline.packages[p].version !== v.version);
const visited = new Map();
function walk(name, from = root) {
  const entry = require.resolve(name, { paths: [from] });
  let directory = path.dirname(entry);
  while (!fs.existsSync(path.join(directory, 'package.json'))) directory = path.dirname(directory);
  // ESM entrypoints can have an internal package manifest; find the named package.
  let p = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  while (p.name !== name) { directory = path.dirname(directory); p = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))); }
  const key = `${p.name}@${p.version}`;
  if (visited.has(key)) return;
  visited.set(key, { name: p.name, version: p.version, license: p.license ?? 'UNDECLARED', path: path.relative(root, directory) });
  for (const dependency of Object.keys(p.dependencies ?? {})) walkPackage(dependency, directory);
}
function walkPackage(name, from) {
  let directory = from;
  while (true) {
    const manifest = path.join(directory, 'node_modules', name, 'package.json');
    if (fs.existsSync(manifest)) {
      const p = JSON.parse(fs.readFileSync(manifest));
      const key = `${p.name}@${p.version}`;
      if (visited.has(key)) return;
      visited.set(key, {name:p.name, version:p.version, license:p.license ?? 'UNDECLARED', path:path.relative(root, path.dirname(manifest))});
      for (const dependency of Object.keys(p.dependencies ?? {})) walkPackage(dependency, path.dirname(manifest));
      return;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw Error(`Unresolved ${name}`);
    directory = parent;
  }
}
walk('openid-client'); walk('@node-saml/node-saml');
const npm = process.env.npm_execpath;
if (!npm) throw Error('Run with npm exec -- node apps/api/scripts/sso-dependency-report.cjs');
const audit = spawnSync(process.execPath, [npm, 'audit', '--json'], {cwd:root, encoding:'utf8', maxBuffer:20*1024*1024});
const report = JSON.parse(audit.stdout);
const output = { auditExitCode: audit.status, totals: report.metadata, ssoFindings: Object.fromEntries(Object.entries(report.vulnerabilities ?? {}).filter(([name]) => [...visited.values()].some(p => p.name === name))), licenses: [...visited.values()], added: additions.map(([p,v])=>({path:p,version:v.version})), changedExistingVersions: changes.map(([p,v])=>({path:p,before:baseline.packages[p].version,after:v.version})) };
const evidence = path.join(root, 'docs/security/sso-dependency-evidence.json');
fs.mkdirSync(path.dirname(evidence), {recursive:true});
fs.writeFileSync(evidence, JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
