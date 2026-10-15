const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./contract.cjs'),cutover=require('./cutover.cjs');
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-owner-release-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pair=crypto.generateKeyPairSync('ed25519'),keys={production:{owner:pair.publicKey.export({format:'pem',type:'spki'})}};
 const m={version:1,environment:'production',purpose:'release',releaseId:'owner-release',approvedByReference:'founder-directive',executorSHA256:require('./executor.cjs').fingerprint(),appResourceId:cutover.APP,approvedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+72*3600000).toISOString(),executionTimeoutSeconds:14400,artifacts:{},forward:C.FORWARD,rollbackAcceptedSchemas:[42]};
 for(const name of ['api','apiManifest','runtimeAuthorization','custody','migrationArtifact','backup','rollbackApi','rollbackManifest','rollbackAuthorization']){const bytes=Buffer.from(name+' synthetic artifact');fs.writeFileSync(path.join(dir,name),bytes);m.artifacts[name]={path:name,sha256:C.hash(bytes)}}
 const archive=path.join(__dirname,'../../artifacts/launch-unified-release-621f96556892/opa-migration-unified-linux.tar.gz'),migration=require('./migration-archive.cjs').read(archive);
 fs.copyFileSync(archive,path.join(dir,'migrationArtifact'));m.artifacts.migrationArtifact.sha256=migration.archiveSha256;m.migrationManifestSHA256=migration.manifestSha256;
 m.migration={build:migration.manifest.build,purpose:'migration',approvalId:m.releaseId,approvedAt:m.approvedAt,expiresAt:m.expiresAt,executionTimeoutSeconds:m.executionTimeoutSeconds,resources:{app:{id:cutover.APP}},artifactSha256:m.migrationManifestSHA256,backupSha256:m.artifacts.backup.sha256};
 const file=path.join(dir,'release.signed.json');
 const sign=()=>{const bytes=Buffer.from(JSON.stringify(m));fs.writeFileSync(file,JSON.stringify({keyId:'owner',payload:bytes.toString('base64'),signature:crypto.sign(null,bytes,pair.privateKey).toString('base64')}))};
 sign();return {dir,m,file,keys,sign};
}
test('one signed owner manifest verifies every exact artifact and seven SQL hashes',t=>{
 const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys});assert.equal(r.manifest.releaseId,'owner-release');assert.equal(Object.keys(r.files).length,9);
 fs.appendFileSync(path.join(f.dir,'api'),'modified');assert.throws(()=>cutover.verify(f.file,{keys:f.keys}),/TAMPERED/);
});
test('unsigned, expired, cross-resource and altered-SQL manifests are rejected',t=>{
 const f=fixture(t);
 for(const change of [m=>m.expiresAt='2000-01-01T00:00:00Z',m=>m.appResourceId+='wrong',m=>m.forward={...C.FORWARD,[Object.keys(C.FORWARD)[0]]:'0'.repeat(64)}]){
  const original=structuredClone(f.m);change(f.m);f.sign();assert.throws(()=>cutover.verify(f.file,{keys:f.keys}));Object.assign(f.m,original);
 }
 f.sign();const e=JSON.parse(fs.readFileSync(f.file));e.signature='AAAA';fs.writeFileSync(f.file,JSON.stringify(e));assert.throws(()=>cutover.verify(f.file,{keys:f.keys}));
});
function adapters(calls,fail) {return Object.fromEntries(['verify','recovery','enterMaintenance','allowReadOnlyStartup','activate','migrate','cleanup','verifyCleanup','publishRuntime','deploy','health'].map(name=>[name,async(r,rollback)=>{calls.push(name+(typeof rollback==='boolean'?':'+rollback:''));if(name===fail&&rollback!==true)throw Error('TEST_STAGE_FAILURE')}]))}
test('single approval drives complete cutover and mandatory privilege cleanup',async t=>{
 const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[];const result=await cutover.execute(r,{adapters:adapters(calls)});
 assert.equal(result.status,'deployment-phase-complete');assert.equal(result.cleanupRequired,false);assert(calls.indexOf('cleanup')<calls.indexOf('deploy:false'));
});
test('migration failure still cleans privilege and never deploys',async t=>{
 const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[];
 await assert.rejects(()=>cutover.execute(r,{adapters:adapters(calls,'migrate')}));
 assert(calls.includes('cleanup'));assert(calls.includes('verifyCleanup'));assert(!calls.some(c=>c.startsWith('deploy')));
});
test('failed recovery readiness cannot activate migration identity',async t=>{
 const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[];
 await assert.rejects(()=>cutover.execute(r,{adapters:adapters(calls,'recovery')}));assert(!calls.includes('activate'));
});
test('cleanup verification failure prevents deployment',async t=>{
 const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[];
 await assert.rejects(()=>cutover.execute(r,{adapters:adapters(calls,'verifyCleanup')}));assert(!calls.some(c=>c.startsWith('deploy')));
});
test('failed deployment restores the exact approved durable fallback without another approval',async t=>{
 const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[];
 await assert.rejects(()=>cutover.execute(r,{adapters:adapters(calls,'deploy')}),e=>e.receipt.status==='rolled-back');
 assert(calls.includes('publishRuntime:true'));assert(calls.includes('deploy:true'));assert(calls.includes('health:true'));
});
test('expiry while migration is completing permits cleanup but blocks new deployment',async t=>{
 const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[];let clock=Date.now();r.manifest.expiresAt=new Date(clock+1000).toISOString();
 const a=adapters(calls);a.migrate=async()=>{calls.push('migrate');clock+=2000};
 await assert.rejects(()=>cutover.execute(r,{adapters:a,now:()=>clock}),/RELEASE_ADMISSION_EXPIRED/);
 assert(calls.includes('cleanup'));assert(calls.includes('verifyCleanup'));assert(!calls.includes('deploy:false'));
});

test('privilege restoration is independently checked even when cleanup reports failure',async t=>{const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[];await assert.rejects(()=>cutover.execute(r,{adapters:adapters(calls,'cleanup')}));assert(calls.includes('verifyCleanup'));assert(!calls.includes('deploy:false'));});

test('signed owner approval cannot admit altered executor code',t=>{const f=fixture(t);f.m.executorSHA256='0'.repeat(64);f.sign();assert.throws(()=>cutover.verify(f.file,{keys:f.keys}),/RELEASE_EXECUTOR_DRIFT/)});

test('database phase returns schema42 proof and never starts application deployment',async t=>{const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[],a=adapters(calls);a.migrate=async()=>({activeMigrations:42});const receipt=await cutover.execute(r,{adapters:a,migrationOnly:true});assert.equal(receipt.status,'migration-phase-complete');assert.equal(receipt.activeMigrations,42);assert.equal(receipt.cleanupRequired,false);assert(!calls.some(n=>n.startsWith('deploy')||n.startsWith('publishRuntime')))});
test('operator deployment phase requires matching completed database phase and cleanup proof',async t=>{const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys});for(const changes of [{activeMigrations:35},{cleanupRequired:true},{manifestSHA256:'0'.repeat(64)},{status:'failed'}]){const proof={manifestSHA256:r.sha256,status:'migration-phase-complete',activeMigrations:42,cleanupRequired:false,...changes};await assert.rejects(()=>cutover.execute(r,{adapters:adapters([]),databaseReceipt:proof}),/VERIFIED_DATABASE_PHASE_REQUIRED/)}});
test('operator deployment survives loss of application-host connection and rolls back independently',async t=>{const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[],a=adapters(calls,'deploy');a.prepareDeployment=async()=>calls.push('public-artifacts-verified');const proof={manifestSHA256:r.sha256,status:'migration-phase-complete',activeMigrations:42,cleanupRequired:false,maintenanceRequired:true,steps:[{name:'allow-fenced-api-startup',status:'passed'}]};await assert.rejects(()=>cutover.execute(r,{adapters:a,databaseReceipt:proof}),e=>e.receipt.status==='rolled-back');assert(calls.includes('deploy:true'));assert(calls.includes('health:true'));assert(!calls.includes('activate'));assert(!calls.includes('migrate'))});

test('no migration is admitted without a maintenance implementation',async t=>{const f=fixture(t),r=cutover.verify(f.file,{keys:f.keys}),calls=[],a=adapters(calls);delete a.enterMaintenance;await assert.rejects(()=>cutover.execute(r,{adapters:a}));assert(!calls.includes('activate'));});
