// Keep the monorepo workspace layout and lock graph in the deployable artifact.
/* global __dirname, process, console */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const destination = path.resolve(root, process.argv[2] ?? 'deploy');
if (!destination.startsWith(root + path.sep) || fs.existsSync(destination)) throw Error('Destination must be a new directory inside the repository');
const npm = process.env.npm_execpath;
if (!npm) throw Error('Run this script through npm');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const lockBytes = fs.readFileSync(path.join(root,'package-lock.json'));
if (!fs.existsSync(path.join(root,'apps/api/dist/main.js'))) throw Error('Build API first; expected dist/main.js entrypoint');
const expected = JSON.parse(lockBytes);
for (const relative of ['package.json','package-lock.json','apps/api/package.json','apps/api/dist','apps/api/prisma','packages/environment-policy']) {
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.cpSync(path.join(root, relative),target,{recursive:true});
}
execFileSync(process.execPath,[npm,'ci','--omit=dev','--no-audit','--no-fund'],{cwd:destination,stdio:'inherit'});
// Use the already-tested build-time CLI; generation targets artifact node_modules.
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'generate','--schema',path.join(destination,'apps/api/prisma/schema.prisma')],{cwd:destination,stdio:'inherit'});
if (hash(fs.readFileSync(path.join(destination,'package-lock.json'))) !== hash(lockBytes)) throw Error('Artifact lockfile changed');
const installed = JSON.parse(fs.readFileSync(path.join(destination,'node_modules/.package-lock.json')));
let count = 0;
for (const [relative,pkg] of Object.entries(installed.packages)) {
  if (pkg.link) continue;
  const locked = expected.packages[relative];
  if (!locked || pkg.version !== locked.version || pkg.integrity !== locked.integrity) throw Error(`Artifact drift: ${relative}`);
  const tested = JSON.parse(fs.readFileSync(path.join(root,relative,'package.json')));
  if (tested.version !== pkg.version) throw Error(`Artifact was not tested: ${relative}`);
  count++;
}
fs.writeFileSync(path.join(destination,'dependency-proof.json'),JSON.stringify({lockSha256:hash(lockBytes),packagesVerified:count,node:process.version},null,2)+'\n');
console.log(`Artifact graph verified: ${count} packages; lock ${hash(lockBytes)}`);
