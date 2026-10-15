'use strict';
// Linux-only local packaging. Reuses the locked API assembler and migration graph.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const C=require('./contract.cjs'),{toolLock,walk}=require('./build-artifact.cjs');
function main() {
 const root=path.resolve(__dirname,'../..'),[output,snapshotFile]=process.argv.slice(2),snapshot=JSON.parse(fs.readFileSync(snapshotFile));
 C.requireThat(process.platform==='linux'&&process.versions.node.split('.')[0]==='22'&&process.env.npm_execpath,'LINUX_NODE22_NPM_REQUIRED');
 C.requireThat(!fs.existsSync(output),'NEW_PACKAGE_OUTPUT');fs.mkdirSync(output,{recursive:true});
 const env={PATH:process.env.PATH,HOME:process.env.HOME,npm_execpath:process.env.npm_execpath,PRISMA_SKIP_POSTINSTALL_GENERATE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:5432/opa_packaging_test'};
 const invoke=(script,args,cwd=root)=>cp.execFileSync(process.execPath,[script,...args],{cwd,env,stdio:'inherit',timeout:600000});
 const lockBytes=fs.readFileSync(path.join(root,'package-lock.json'));
 invoke(path.join(root,'apps/api/scripts/assemble-production.cjs'),['deploy']);
 const migration=path.join(output,'migration'),graph=toolLock(JSON.parse(lockBytes),JSON.parse(fs.readFileSync(path.join(root,'package.json'))));
 fs.mkdirSync(migration);
 for(const relative of ['ops/production','packages/environment-policy','apps/api/prisma']){fs.mkdirSync(path.dirname(path.join(migration,relative)),{recursive:true});fs.cpSync(path.join(root,relative),path.join(migration,relative),{recursive:true})}
 fs.writeFileSync(path.join(migration,'package.json'),JSON.stringify(graph.manifest,null,2));
 fs.writeFileSync(path.join(migration,'package-lock.json'),JSON.stringify(graph.lock,null,2));
 invoke(process.env.npm_execpath,['ci','--ignore-scripts','--no-audit','--no-fund'],migration);
 invoke(process.env.npm_execpath,['rebuild','@prisma/engines'],migration);
 invoke(path.join(migration,'node_modules/prisma/build/index.js'),['--version'],migration);
 const candidate={};
 for(const n of fs.readdirSync(path.join(migration,'apps/api/prisma/migrations'))){const file=path.join(migration,'apps/api/prisma/migrations',n,'migration.sql');if(fs.existsSync(file))candidate[n]=C.hash(fs.readFileSync(file))}
 C.requireThat(Object.keys(candidate).length===42&&Object.keys(snapshot.baseline).length===35&&
  Object.entries({...snapshot.baseline,...C.FORWARD}).every(([n,h])=>candidate[n]===h),'ACCEPTED_SQL_UNCHANGED');
 const manifest={version:1,build:snapshot.sourceSnapshotSHA1,sourceRevision:snapshot.sourceRevision,sourceSnapshotSHA256:snapshot.sourceSnapshotSHA256,
  baselineBuild:C.BASE,baseline:snapshot.baseline,candidate,forward:C.FORWARD,sourceLockSha256:C.hash(lockBytes),
  sourcePackageSha256:C.hash(fs.readFileSync(path.join(root,'package.json'))),prisma:'6.19.3',nodeMajor:22,platform:'linux',arch:process.arch,executionReady:true,files:walk(migration)};
 fs.writeFileSync(path.join(migration,'migration-artifact.json'),JSON.stringify(manifest,null,2));
 require('./run.cjs').verifyArtifact(migration);
 cp.execFileSync('tar',['-czf',path.join(output,'api-production-linux.tar.gz'),'-C',path.join(root,'deploy'),'.'],{stdio:'inherit'});
 const names=[...Object.keys(manifest.files),'migration-artifact.json'].sort();
 cp.execFileSync('tar',['--format=ustar','--no-recursion','-czf',path.join(output,'migration-runner-linux.tar.gz'),'-C',migration,'--null','-T','-'],{input:names.join('\0')+'\0',stdio:['pipe','inherit','inherit']});
 const checked=require('./migration-archive.cjs').read(path.join(output,'migration-runner-linux.tar.gz'));
 C.requireThat(checked.manifestSha256===C.hash(fs.readFileSync(path.join(migration,'migration-artifact.json'))),'PACKAGED_ARCHIVE_CONTRACT');
 fs.writeFileSync(path.join(output,'packaging-receipt.json'),JSON.stringify({apiTarSHA256:C.hash(fs.readFileSync(path.join(output,'api-production-linux.tar.gz'))),
  migrationTarSHA256:C.hash(fs.readFileSync(path.join(output,'migration-runner-linux.tar.gz'))),migrationManifestSHA256:C.hash(fs.readFileSync(path.join(migration,'migration-artifact.json'))),
  source:snapshot,forward:C.FORWARD,productionModified:false},null,2));
 C.requireThat(C.hash(fs.readFileSync(path.join(root,'package-lock.json')))===C.hash(lockBytes),'SOURCE_LOCK_CHANGED');
}
if(require.main===module){try{main()}catch(e){console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'LOCAL_RELEASE_PACKAGING_FAILED');process.exitCode=1}}
