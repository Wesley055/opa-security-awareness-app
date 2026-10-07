"use strict";
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const {BASE,FORWARD,hash,requireThat} = require('./contract.cjs');
const SOURCE = ['ops/production','packages/environment-policy','apps/api/prisma'];
function git(root, args) {
  return cp.execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,...args], {stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
}
// Preserve the reviewed lock entries, including nested resolution, without the API
// application or its unrelated dependencies. npm ci validates this lock graph.
function toolLock(lock, sourcePackage = {}) {
  const packages = {}, queue = ['node_modules/prisma','node_modules/pg'];
  function resolve(from, name) {
    let base = from;
    while (base) {
      const candidate = base + '/node_modules/' + name;
      if (lock.packages[candidate]) return candidate;
      base = base.substring(0,base.lastIndexOf('/node_modules/'));
    }
    const root = 'node_modules/' + name;
    requireThat(lock.packages[root], 'DEPENDENCY_MISSING'); return root;
  }
  for (let i=0;i<queue.length;i++) {
    const key = queue[i]; if (packages[key]) continue;
    const item = lock.packages[key];
    requireThat(item && !item.link && item.integrity && item.resolved?.startsWith('https://registry.npmjs.org/'), 'DEPENDENCY_SOURCE');
    const copy = {...item}; delete copy.dev; delete copy.devOptional; delete copy.optional;
    packages[key] = copy;
    for (const name of Object.keys({...item.dependencies,...item.optionalDependencies})) queue.push(resolve(key,name));
    for (const name of Object.keys(item.peerDependencies || {})) {
      if (!item.peerDependenciesMeta?.[name]?.optional) queue.push(resolve(key,name));
      else {
        // npm ci still validates an optional peer that exists in the reviewed
        // resolution graph (notably Prisma's TypeScript peer).
        try { queue.push(resolve(key,name)); } catch { /* absent optional peer */ }
      }
    }
  }
  requireThat(packages['node_modules/prisma'].version === '6.19.3', 'PRISMA_VERSION');
  const manifest = {name:'opa-production-migration-artifact',version:'1.0.0',private:true,dependencies:{prisma:'6.19.3',pg:packages['node_modules/pg'].version}};
  const selected=new Set(Object.keys(packages).map(k=>k.slice(k.lastIndexOf('node_modules/')+'node_modules/'.length)));
  // Carry the original override semantics for selected packages. Omitting the
  // reviewed @prisma/config override makes npm request deepmerge-ts 7 again.
  const overrides=Object.fromEntries(Object.entries(sourcePackage.overrides || {}).filter(([name])=>selected.has(name)));
  if(Object.keys(overrides).length)manifest.overrides=overrides;
  return {manifest,lock:{name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{'':manifest,...packages}}};
}
function walk(root, dir='', result={}) {
  for (const item of fs.readdirSync(path.join(root,dir), {withFileTypes:true})) {
    const relative = (dir ? dir+'/' : '')+item.name;
    if (item.isSymbolicLink()) {
      const real=fs.realpathSync(path.join(root,relative));
      requireThat(real.startsWith(path.resolve(root)+path.sep) && fs.statSync(real).isFile(),'ARTIFACT_SYMLINK');
      result[relative]=hash('symlink:'+fs.readlinkSync(path.join(root,relative)).replaceAll('\\','/'));
    } else if (item.isDirectory()) walk(root,relative,result);
    else if (item.isFile()) result[relative] = hash(fs.readFileSync(path.join(root,relative)));
    else throw Error('ARTIFACT_SPECIAL_FILE');
  }
  return result;
}
function build(root, destination, sha, install=true) {
  requireThat(/^[a-f0-9]{40}$/.test(sha || ''), 'CANDIDATE_SHA');
  requireThat(git(root,['rev-parse','HEAD']).toString().trim() === sha, 'CANDIDATE_HEAD');
  requireThat(!git(root,['status','--porcelain','--untracked-files=all','--',...SOURCE,'package-lock.json','package.json']).length, 'SOURCE_DIRTY');
  destination = path.resolve(destination);
  requireThat(!fs.existsSync(destination) && destination !== path.resolve(root), 'NEW_DESTINATION_REQUIRED');
  const names = git(root,['ls-tree','-r','--name-only',sha,'--',...SOURCE]).toString().trim().split('\n');
  const modes=git(root,['ls-tree','-r',sha,'--',...SOURCE]).toString().trim().split('\n');
  requireThat(modes.every(line=>/^100(?:644|755) blob /.test(line)),'SOURCE_SPECIAL_FILE');
  requireThat(['ops/production/run.cjs','ops/production/inspect.cjs','packages/environment-policy/trusted-signers.json','apps/api/prisma/schema.prisma'].every(n=>names.includes(n)), 'COMMITTED_TOOLING_REQUIRED');
  fs.mkdirSync(destination,{recursive:true});
  for (const name of names) {
    requireThat(!name.includes('..') && SOURCE.some(s=>name.startsWith(s+'/')), 'SOURCE_PATH');
    const target = path.join(destination,name); fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,git(root,['show',`${sha}:${name}`]));
  }
  const candidate = {};
  for (const name of fs.readdirSync(path.join(destination,'apps/api/prisma/migrations'))) {
    const file = path.join(destination,'apps/api/prisma/migrations',name,'migration.sql');
    if (fs.existsSync(file)) candidate[name] = hash(fs.readFileSync(file));
  }
  const baseline = {};
  for (const file of git(root,['ls-tree','-r','--name-only',BASE,'--','apps/api/prisma/migrations']).toString().trim().split('\n')) {
    if (file.endsWith('/migration.sql')) baseline[file.split('/').at(-2)] = hash(git(root,['show',`${BASE}:${file}`]));
  }
  requireThat(Object.keys(baseline).length === 35 && Object.keys(candidate).length === 42, 'MIGRATION_SET');
  requireThat(Object.entries(baseline).every(([n,h])=>candidate[n]===h) && Object.entries(FORWARD).every(([n,h])=>candidate[n]===h), 'MIGRATION_HASH');
  const lockBytes = git(root,['show',`${sha}:package-lock.json`]);
  const sourcePackageBytes=git(root,['show',`${sha}:package.json`]);
  const graph = toolLock(JSON.parse(lockBytes),JSON.parse(sourcePackageBytes));
  fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify(graph.manifest,null,2)+'\n');
  fs.writeFileSync(path.join(destination,'package-lock.json'),JSON.stringify(graph.lock,null,2)+'\n');
  if (install) {
    requireThat(process.env.npm_execpath && process.versions.node.split('.')[0] === '22', 'NODE22_NPM_REQUIRED');
    // Builder must have no production credentials or signing material. Do not
    // inherit caller environment into npm lifecycle or Prisma child processes.
    const env = {PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,TEMP:process.env.TEMP,TMP:process.env.TMP,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'};
    for (const args of [['ci','--ignore-scripts','--no-audit','--no-fund'],['rebuild','@prisma/engines']]) {
      const result = cp.spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd:destination,env,stdio:'pipe',timeout:300000});
      requireThat(!result.error && result.status === 0, 'ARTIFACT_INSTALL_FAILED');
    }
    const result = cp.spawnSync(process.execPath,[path.join(destination,'node_modules/prisma/build/index.js'),'--version'],{cwd:destination,env,stdio:'pipe',timeout:60000});
    requireThat(result.status === 0 && /prisma\s+: 6\.19\.3/.test(result.stdout.toString()), 'ARTIFACT_ENGINE_REQUIRED');
  }
  // Executable and engine bytes are covered, as well as every candidate SQL file.
  const files = walk(destination);
  const manifest = {version:1,build:sha,baselineBuild:BASE,baseline,candidate,forward:FORWARD,sourceLockSha256:hash(lockBytes),sourcePackageSha256:hash(sourcePackageBytes),prisma:'6.19.3',nodeMajor:22,platform:process.platform,arch:process.arch,executionReady:install,files};
  fs.writeFileSync(path.join(destination,'migration-artifact.json'),JSON.stringify(manifest,null,2)+'\n');
  return {build:sha,manifestSha256:hash(fs.readFileSync(path.join(destination,'migration-artifact.json'))),executionReady:install};
}
if (require.main === module) {
  try {
    const [sha,destination] = process.argv.slice(2);
    requireThat(process.argv.length===4,'BUILD_ARGUMENTS');
    console.log(JSON.stringify(build(path.resolve(__dirname,'../..'),destination,sha)));
  } catch { console.error('MIGRATION_ARTIFACT_BUILD_REJECTED'); process.exitCode=1; }
}
module.exports = {toolLock,walk,build};
