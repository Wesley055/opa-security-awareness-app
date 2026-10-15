'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),zlib=require('node:zlib');
const archive=require('./migration-archive.cjs'),C=require('./contract.cjs'),{APP}=require('./cutover.cjs'),{prepare}=require('./prepare-runtime.cjs');
const accepted=path.join(__dirname,'../../artifacts/launch-unified-release-621f96556892/opa-migration-unified-linux.tar.gz');
test('accepted archive extracts with exact inventory, 35-to-42 SQL graph and executable modes',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'opa-archive-test-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const a=archive.extract(accepted,parent);assert.equal(a.archiveSha256,'413ef2502bc6b84e80874107306f9f5fbad11f5eb820ed32abb8b46ef739ffaf');
 assert.equal(Object.keys(a.manifest.baseline).length,35);assert.equal(Object.keys(a.manifest.candidate).length,42);
 for(const [n,h] of Object.entries(a.manifest.files))assert.equal(C.hash(fs.readFileSync(path.join(a.root,n))),h);
 if(process.platform!=='win32')for(const [n,mode] of a.modes)assert.equal(fs.statSync(path.join(a.root,n)).mode&0o777,mode);
});
test('archive rejects traversal, links, duplicate inventory and altered bytes before extraction',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-archive-reject-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const original=zlib.gunzipSync(fs.readFileSync(accepted));
 const checksum=h=>{h.fill(32,148,156);const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,'ascii')};
 for(const mutation of [b=>{b.fill(0,0,100);b.write('../escape');checksum(b.subarray(0,512))},b=>{b[156]=50;checksum(b.subarray(0,512))},b=>{b[512]^=1}]){
  const b=Buffer.from(original);mutation(b);const file=path.join(dir,'bad.gz');fs.writeFileSync(file,zlib.gzipSync(b));assert.throws(()=>archive.extract(file,dir));assert.deepEqual(fs.readdirSync(dir),['bad.gz']);
 }
});
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-runtime-plan-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const now=Date.now(),pair=crypto.generateKeyPairSync('ed25519'),keys={production:{test:pair.publicKey.export({type:'spki',format:'pem'})}},write=(n,v)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(v));
 fs.writeFileSync(path.join(dir,'api.zip'),'exact approved test artifact');write('manifest.json',{version:1,build:'unified-test',files:{}});
 write('capture.json',{capturedAt:new Date(now).toISOString(),resourceId:APP,policy:{resources:{app:{id:APP},database:{role:C.RUNTIME}},settings:{},secrets:{}}});
 const old={version:2,environment:'production',purpose:'runtime-custody',issuedAt:new Date(now-1000).toISOString(),sequence:7,resourceId:APP,activeAuthorizations:{old:'a'.repeat(64)},revokedAuthorizationIds:['revoked-old-runtime'],revokedAuthorityFingerprints:['b'.repeat(64)]};
 const sign=()=>{const b=Buffer.from(JSON.stringify(old));write('custody.json',{keyId:'test',payload:b.toString('base64'),signature:crypto.sign(null,b,pair.privateKey).toString('base64')})};sign();
 const plan={authorizationId:'unified-runtime-test-0001',keyId:'test',build:'unified-test',api:'api.zip',manifest:'manifest.json',configurationCapture:'capture.json',currentCustody:'custody.json',currentCustodySHA256:C.hash(fs.readFileSync(path.join(dir,'custody.json'))),apiSHA256:C.hash(fs.readFileSync(path.join(dir,'api.zip'))),manifestSHA256:C.hash(fs.readFileSync(path.join(dir,'manifest.json')))};
 return {dir,now,keys,old,plan,sign,write,run(){write('plan.json',plan);return prepare(path.join(dir,'plan.json'),path.join(dir,'out'),{keys,now})}};
}
test('runtime preparation binds exact build and advances custody preserving history',t=>{
 const f=fixture(t),r=f.run(),s=JSON.parse(fs.readFileSync(r.outputs['runtime-custody'].path));assert.equal(s.sequence,8);assert.equal(s.activeAuthorizations.old,'a'.repeat(64));assert.deepEqual(s.revokedAuthorizationIds,f.old.revokedAuthorizationIds);assert.deepEqual(s.revokedAuthorityFingerprints,f.old.revokedAuthorityFingerprints);assert.equal(r.keyAccessed,false);
});
test('runtime preparation rejects artifact drift, tampered custody, revocation and missing initialization proof',t=>{
 for(const mutate of [f=>f.plan.apiSHA256='0'.repeat(64),f=>{f.write('custody.json',{});f.plan.currentCustodySHA256=C.hash(fs.readFileSync(path.join(f.dir,'custody.json')))},f=>{f.old.revokedAuthorizationIds.push(f.plan.authorizationId);f.sign();f.plan.currentCustodySHA256=C.hash(fs.readFileSync(path.join(f.dir,'custody.json')))},f=>{delete f.plan.currentCustody;delete f.plan.currentCustodySHA256}]){const f=fixture(t);mutate(f);assert.throws(()=>f.run());assert.equal(fs.existsSync(path.join(f.dir,'out')),false)}
});

test('owner payload preparation fails closed without verified migration bindings',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-owner-prepare-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'plan.json'),out=path.join(dir,'owner.json');fs.writeFileSync(file,JSON.stringify({releaseId:'test-release'}));assert.throws(()=>require('./prepare-release.cjs').prepare(file,out),/VERIFIED_MIGRATION_BINDINGS_REQUIRED/);assert.equal(fs.existsSync(out),false)});
