"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const C=require('./contract.cjs'),{toolLock,walk}=require('./build-artifact.cjs'),{verifyArtifact}=require('./run.cjs');
test('Node22 isolated locked install carries CLI/engines and detects artifact tampering',{skip:process.env.OPA_ARTIFACT_INSTALL_TEST!=='1',timeout:360000},()=>{
  assert.equal(process.versions.node.split('.')[0],'22');
  const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-artifact-proof-'));
  try{
    const source=fs.readFileSync(path.join(root,'package-lock.json')),g=toolLock(JSON.parse(source),JSON.parse(fs.readFileSync(path.join(root,'package.json'))));
    fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(g.manifest));fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify(g.lock));
    const before=C.hash(fs.readFileSync(path.join(dir,'package-lock.json')));
    const npm=process.env.OPA_TEST_NPM_CLI || path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
    const env={PATH:process.env.PATH,HOME:dir,TEMP:dir,TMP:dir,SystemRoot:process.env.SystemRoot,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'};
    for(const args of [['ci','--ignore-scripts','--no-audit','--no-fund'],['rebuild','@prisma/engines']]){
      const r=cp.spawnSync(process.execPath,[npm,...args],{cwd:dir,env,stdio:'pipe',timeout:180000});
      if(r.status!==0){const text=r.stderr?.toString() || '';console.log(JSON.stringify({npmStage:args[0],code:text.match(/npm error code ([A-Z0-9_]+)/)?.[1] || 'UNKNOWN',missing:[...text.matchAll(/Missing: ([a-zA-Z0-9@/_.-]+) from lock file/g)].map(m=>m[1])}));}
      assert.equal(r.status,0,'Locked isolated npm operation; raw output withheld');
    }
    assert.equal(C.hash(fs.readFileSync(path.join(dir,'package-lock.json'))),before);
    const r=cp.spawnSync(process.execPath,[path.join(dir,'node_modules/prisma/build/index.js'),'--version'],{cwd:dir,env,stdio:'pipe',timeout:60000});
    assert.equal(r.status,0);assert.match(r.stdout.toString(),/prisma\s+: 6\.19\.3/);
    fs.cpSync(path.join(root,'apps/api/prisma'),path.join(dir,'apps/api/prisma'),{recursive:true});
    const candidate={};for(const n of fs.readdirSync(path.join(dir,'apps/api/prisma/migrations')))if(fs.existsSync(path.join(dir,'apps/api/prisma/migrations',n,'migration.sql')))candidate[n]=C.hash(fs.readFileSync(path.join(dir,'apps/api/prisma/migrations',n,'migration.sql')));
    const baseline=Object.fromEntries(Object.entries(candidate).filter(([n])=>!Object.hasOwn(C.FORWARD,n)));
    const manifest={version:1,build:'a'.repeat(40),baselineBuild:C.BASE,baseline,candidate,forward:C.FORWARD,sourceLockSha256:C.hash(source),prisma:'6.19.3',nodeMajor:22,platform:process.platform,arch:process.arch,executionReady:true,files:walk(dir)};
    fs.writeFileSync(path.join(dir,'migration-artifact.json'),JSON.stringify(manifest));
    assert(verifyArtifact(dir).manifestSha256);
    fs.writeFileSync(path.join(dir,'unapproved-file'),'test');assert.throws(()=>verifyArtifact(dir),/ARTIFACT_TAMPERED/);fs.unlinkSync(path.join(dir,'unapproved-file'));
    const sqlFile=path.join(dir,'apps/api/prisma/migrations',Object.keys(C.FORWARD)[0],'migration.sql'),sql=fs.readFileSync(sqlFile);
    fs.appendFileSync(sqlFile,'\n-- tampered');assert.throws(()=>verifyArtifact(dir),/ARTIFACT_TAMPERED/);fs.writeFileSync(sqlFile,sql);
    fs.symlinkSync(path.join(root,'package.json'),path.join(dir,'outside-link'));assert.throws(()=>verifyArtifact(dir),/ARTIFACT_SYMLINK/);fs.unlinkSync(path.join(dir,'outside-link'));
    assert(!fs.existsSync(path.join(dir,'node_modules/@nestjs/core')));
    console.log(JSON.stringify({proof:'isolated-node22-artifact',prisma:'6.19.3',packages:Object.keys(g.lock.packages).length-1,files:Object.keys(manifest.files).length,lockUnchanged:true,tamperRejected:true}));
  }finally{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
