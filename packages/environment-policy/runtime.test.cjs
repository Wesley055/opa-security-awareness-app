const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {accept,retrieve,inventory,sha}=require('./runtime.cjs');
const {verifyEnvelope,validateApi}=require('./index.cjs');
const {fixture}=require('./fixtures.cjs');
const {refresh,resume}=require('./runtime.cjs');
function setup(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opa-runtime-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'main.js'),'// exact approved fixture\n');
 const pair=crypto.generateKeyPairSync('ed25519'),keys={production:{fixture:pair.publicKey.export({type:"spki",format:"pem"})}};
 const sign=p=>{const b=Buffer.from(JSON.stringify(p));return{keyId:'fixture',payload:b.toString('base64'),signature:crypto.sign(null,b,pair.privateKey).toString('base64')}};
 const {env,p,bind}=fixture('production');p.expiresAt='2026-10-14T05:46:42Z';
 const manifest=Buffer.from(JSON.stringify({version:1,build:p.build,files:inventory(root)}));
 const a={version:2,environment:'production',purpose:'runtime-api',issuedAt:'2026-10-13T00:00:00Z',authorizationId:'fixture_authorization_001',minimumCustodySequence:1,authorityFingerprint:sha(pair.publicKey.export({type:'spki',format:'der'})),manifestSHA256:sha(manifest),policy:p};
 const s={version:2,environment:'production',purpose:'runtime-custody',issuedAt:a.issuedAt,sequence:1,resourceId:p.resources.app.id,revokedAuthorizationIds:[],revokedAuthorityFingerprints:[],activeAuthorizations:{[a.authorizationId]:sha(Buffer.from(JSON.stringify(a)))}};
 const run=(now=Date.parse('2026-10-15T00:00:00Z'))=>accept(sign(a),sign(s),manifest,root,keys,now);
 return{root,keys,sign,env,p,bind,manifest,a,s,run};
}
test('approved API accepts before and after deployment expiry with exact config',t=>{
 const f=setup(t);for(const date of ['2026-10-13T01:00:00Z','2026-10-15T00:00:00Z','2036-10-15T00:00:00Z'])assert.equal(validateApi(f.env,f.run(Date.parse(date))).build,f.p.build);
});
test('repeat admission models recycle and multiple scale-out instances after expiry',t=>{const f=setup(t);for(let i=0;i<5;i++)assert.equal(f.run().build,f.p.build)});
test('fresh child processes independently admit the same approved artifact after expiry',t=>{
 const f=setup(t),cp=require('node:child_process');
 const input=JSON.stringify({envelope:f.sign(f.a),state:f.sign(f.s),manifest:f.manifest.toString(),root:f.root,keys:f.keys,env:f.env});
 const code=`const fs=require('node:fs'),x=JSON.parse(fs.readFileSync(0,'utf8'));const p=require(${JSON.stringify(require.resolve('./runtime.cjs'))}).accept(x.envelope,x.state,Buffer.from(x.manifest),x.root,x.keys,Date.parse('2030-01-01T00:00:00Z'));require(${JSON.stringify(require.resolve('./index.cjs'))}).validateApi(x.env,p);process.stdout.write(p.build);`;
 for(let i=0;i<3;i++){const r=cp.spawnSync(process.execPath,['-e',code],{input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,f.p.build)}
});
for(const [name,change] of Object.entries({
 'modified build':f=>fs.appendFileSync(path.join(f.root,'main.js'),'altered'),
 'added executable':f=>fs.writeFileSync(path.join(f.root,'injected.js'),'altered'),
 'removed artifact':f=>fs.unlinkSync(path.join(f.root,'main.js')),
 'revoked authorization':f=>f.s.revokedAuthorizationIds.push(f.a.authorizationId),
 'revoked authority':f=>f.s.revokedAuthorityFingerprints.push(f.a.authorityFingerprint),
 'unapproved authorization':f=>f.s.activeAuthorizations={},
 'custody rollback below signed floor':f=>f.s.sequence=0,
 'unauthorized custody resource':f=>f.s.resourceId+='wrong',
 'future issuance':f=>f.a.issuedAt='2099-01-01T00:00:00Z',
 'missing custody':f=>{for(const k of Object.keys(f.s))delete f.s[k]},
}))test(name+' rejected',t=>{const f=setup(t);change(f);assert.throws(()=>f.run())});
test('tampered signature rejected',t=>{const f=setup(t),e=f.sign(f.a);e.signature=Buffer.alloc(64).toString('base64');assert.throws(()=>accept(e,f.sign(f.s),f.manifest,f.root,f.keys))});
test('unsigned, unknown signing authority and tampered custody are rejected',t=>{
 const f=setup(t),e=f.sign(f.a),state=f.sign(f.s);
 for(const bad of [{...e,signature:''},{...e,keyId:'unknown'}])assert.throws(()=>accept(bad,state,f.manifest,f.root,f.keys));
 state.signature='AAAA';assert.throws(()=>accept(e,state,f.manifest,f.root,f.keys));
});
test('tampered manifest and nonproduction environment are rejected',t=>{
 const f=setup(t);assert.throws(()=>accept(f.sign(f.a),f.sign(f.s),Buffer.from('{}'),f.root,f.keys));
 assert.throws(()=>validateApi({...f.env,OPA_ENVIRONMENT:'staging'},f.run()));
});
test('unexpired deployment approval alone cannot authorize durable runtime',t=>{
 const f=setup(t);assert.throws(()=>accept(f.sign({...f.p,expiresAt:'2099-01-01T00:00:00Z'}),f.sign(f.s),f.manifest,f.root,f.keys));
});
test('unauthorized resource, secret, setting and build rejected by existing preflight',t=>{
 const f=setup(t),p=f.run();for(const change of [e=>e.OPA_BUILD_SHA+='x',e=>e.OPA_DEPLOYMENT_RESOURCE_ID+='x',e=>e.JWT_ACCESS_SECRET+='x',e=>e.OPA_API_ORIGIN='https://wrong.test']){const env={...f.env};change(env);assert.throws(()=>validateApi(env,p))}
});
test('runtime authorization cannot be a deployment or migration approval',t=>{
 const f=setup(t);for(const purpose of ['api','migration','deployment'])assert.throws(()=>verifyEnvelope(f.sign(f.a),'production',purpose,f.keys));
});
test('expired deployment and migration signatures fail closed',t=>{
 const f=setup(t);for(const purpose of ['api','migration','deployment'])assert.throws(()=>verifyEnvelope(f.sign({...f.p,purpose,expiresAt:'2000-01-01T00:00:00Z'}),'production',purpose,f.keys));
});
test('fresh authoritative Key Vault custody uses managed identity and exact signed resource',async t=>{
 const f=setup(t),calls=[];f.env.IDENTITY_ENDPOINT='http://127.0.0.1:8081/msi/token';f.env.IDENTITY_HEADER='synthetic';
 f.a.policy.resources.vault.secretOrigin='https://fixtureproduction.vault.azure.net';f.s.activeAuthorizations[f.a.authorizationId]=sha(Buffer.from(JSON.stringify(f.a)));
 const request=async(url,options)=>{calls.push({url:String(url),options});return calls.length===1?{ok:true,json:async()=>({access_token:'synthetic-token'})}:{ok:true,json:async()=>({value:JSON.stringify(f.sign(f.s))})}};
 const b=await retrieve(f.sign(f.a),f.env,f.keys,f.manifest,request);assert.equal(JSON.parse(b).keyId,'fixture');
 assert.equal(calls[1].url,'https://fixtureproduction.vault.azure.net/secrets/opa-api-runtime-custody?api-version=7.4');assert.equal(calls[1].options.redirect,'error');assert.equal(calls[1].options.cache,'no-store');
});
test('authoritative custody outage, invalid identity endpoint and revoked current state fail closed',async t=>{
 const f=setup(t);f.env.IDENTITY_ENDPOINT='http://127.0.0.1:8081/msi/token';f.env.IDENTITY_HEADER='synthetic';
 f.a.policy.resources.vault.secretOrigin='https://fixtureproduction.vault.azure.net';f.s.activeAuthorizations[f.a.authorizationId]=sha(Buffer.from(JSON.stringify(f.a)));
 await assert.rejects(()=>retrieve(f.sign(f.a),f.env,f.keys,f.manifest,async()=>({ok:false})));
 f.s.revokedAuthorizationIds.push(f.a.authorizationId);let calls=0;
 await assert.rejects(()=>retrieve(f.sign(f.a),f.env,f.keys,f.manifest,async()=>++calls===1?{ok:true,json:async()=>({access_token:'synthetic'})}:{ok:true,json:async()=>({value:JSON.stringify(f.sign(f.s))})}));
 f.env.IDENTITY_ENDPOINT='http://outside.example.test/token';await assert.rejects(()=>retrieve(f.sign(f.a),f.env,f.keys,f.manifest));
});
async function verifiedContinuity(t) {
 const f=setup(t),directory=fs.mkdtempSync(path.join(os.tmpdir(),'opa-continuity-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 f.env.IDENTITY_ENDPOINT='http://127.0.0.1:8081/msi/token';f.env.IDENTITY_HEADER='synthetic';
 f.p.resources.vault.secretOrigin='https://fixtureproduction.vault.azure.net';f.bind();f.a.continuitySeconds=60;
 f.s.activeAuthorizations[f.a.authorizationId]=sha(Buffer.from(JSON.stringify(f.a)));
 fs.writeFileSync(path.join(directory,'artifact.manifest.json'),f.manifest);
 let time=Date.now();
 const request=async url=>String(url).startsWith('http:')?{ok:true,json:async()=>({access_token:'synthetic'})}:{ok:true,json:async()=>({value:JSON.stringify(f.sign(f.s))})};
 const options={directory,root:f.root,request,now:()=>time};
 await refresh(f.sign(f.a),f.env,f.keys,options);
 return {...f,directory,options,advance:ms=>time+=ms,time:()=>time};
}
for(const phase of ['initial startup','restart','process recycling','periodic checks'])test(phase+' tolerates a transient outage only with unchanged verified custody',async t=>{
 const f=await verifiedContinuity(t);f.advance(10000);
 const result=await refresh(f.sign(f.a),f.env,f.keys,{...f.options,request:async()=>({ok:false,status:503})});
 assert.equal(result.mode,'continuity');
 assert.equal(resume(f.sign(f.a),f.env,f.keys,f.directory,f.root,f.time()).deadline,result.deadline);
});
test('continuity retries cannot extend the last successful verification deadline',async t=>{
 const f=await verifiedContinuity(t),request=async()=>({ok:false,status:429});
 f.advance(59000);await refresh(f.sign(f.a),f.env,f.keys,{...f.options,request});
 f.advance(2000);await assert.rejects(()=>refresh(f.sign(f.a),f.env,f.keys,{...f.options,request}));
});
test('cold start without authenticated cache cannot fall back',async t=>{
 const f=setup(t),directory=fs.mkdtempSync(path.join(os.tmpdir(),'opa-no-cache-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 f.p.resources.vault.secretOrigin='https://fixtureproduction.vault.azure.net';fs.writeFileSync(path.join(directory,'artifact.manifest.json'),f.manifest);
 f.env.IDENTITY_ENDPOINT='http://127.0.0.1/msi/token';f.env.IDENTITY_HEADER='synthetic';
 await assert.rejects(()=>refresh(f.sign(f.a),f.env,f.keys,{directory,root:f.root,request:async()=>({ok:false,status:503})}));
});
test('confirmed revocation and signature corruption never use continuity',async t=>{
 for(const tamper of [false,true]) {
  const f=await verifiedContinuity(t);f.s.revokedAuthorizationIds.push(f.a.authorizationId);
  const envelope=f.sign(f.s);if(tamper)envelope.signature='AAAA';
  const request=async url=>String(url).startsWith('http:')?{ok:true,json:async()=>({access_token:'synthetic'})}:{ok:true,json:async()=>({value:JSON.stringify(envelope)})};
  await assert.rejects(()=>refresh(f.sign(f.a),f.env,f.keys,{...f.options,request}));
  await assert.rejects(()=>refresh(f.sign(f.a),f.env,f.keys,{...f.options,request:async()=>({ok:false,status:503})}));
 }
});
test('continuity rejects tampered artifact, receipt, configuration and release substitution',async t=>{
 for(const change of [
  f=>fs.appendFileSync(path.join(f.root,'main.js'),'modified'),
  f=>{const p=path.join(f.directory,'continuity.json'),r=JSON.parse(fs.readFileSync(p));r.verifiedAt+=50000;fs.writeFileSync(p,JSON.stringify(r))},
  f=>f.env.OPA_DEPLOYMENT_RESOURCE_ID+='wrong',
  f=>{f.a.authorizationId='different_authorization_001';},
 ]) {
  const f=await verifiedContinuity(t);change(f);
  await assert.rejects(()=>refresh(f.sign(f.a),f.env,f.keys,{...f.options,request:async()=>({ok:false,status:503})}));
 }
});
test('authorization errors and malformed custody responses fail closed despite cache',async t=>{
 const f=await verifiedContinuity(t);
 for(const request of [async()=>({ok:false,status:403}),async()=>({ok:true,json:async()=>({})})])
  await assert.rejects(()=>refresh(f.sign(f.a),f.env,f.keys,{...f.options,request}));
});
test('connection timeouts during response body reads use bounded continuity',async t=>{
 const f=await verifiedContinuity(t);
 const result=await refresh(f.sign(f.a),f.env,f.keys,{...f.options,request:async()=>({ok:true,json:async()=>{throw Object.assign(Error('synthetic timeout'),{code:'ETIMEDOUT'})}})});
 assert.equal(result.mode,'continuity');
});


