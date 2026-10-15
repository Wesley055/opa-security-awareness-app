// Local, network-disabled Linux artifact verification. Synthetic keys only.
const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root='/home/site/wwwroot',release='/input/durable-runtime-release-reviewed';
const {fixture}=require('/input/durable-runtime-candidate/packages/environment-policy/fixtures.cjs');
const runtime=require(root+'/packages/environment-policy/runtime.cjs');
const manifest=fs.readFileSync(release+'/artifact.manifest.json'),m=JSON.parse(manifest);
const pair=crypto.generateKeyPairSync('ed25519'),pub=pair.publicKey.export({type:'spki',format:'pem'}),keys={production:{synthetic:pub}};
const sign=p=>{const b=Buffer.from(JSON.stringify(p));return {keyId:'synthetic',payload:b.toString('base64'),signature:crypto.sign(null,b,pair.privateKey).toString('base64')}};
const {env,p}=fixture('production');p.build=m.build;env.OPA_BUILD_SHA=m.build;p.expiresAt='2020-01-01T00:00:00Z';
const a={version:2,environment:'production',purpose:'runtime-api',issuedAt:new Date(Date.now()-1000).toISOString(),authorizationId:'linux_synthetic_authorization',minimumCustodySequence:1,authorityFingerprint:runtime.sha(pair.publicKey.export({type:'spki',format:'der'})),manifestSHA256:runtime.sha(manifest),policy:p};
const s={version:2,environment:'production',purpose:'runtime-custody',issuedAt:a.issuedAt,sequence:1,resourceId:p.resources.app.id,activeAuthorizations:{[a.authorizationId]:runtime.sha(Buffer.from(JSON.stringify(a)))},revokedAuthorizationIds:[],revokedAuthorityFingerprints:[]};
const input=JSON.stringify({envelope:sign(a),state:sign(s),manifest:manifest.toString(),root,keys,env});
const code="const fs=require('node:fs'),x=JSON.parse(fs.readFileSync(0,'utf8'));const p=require('/home/site/wwwroot/packages/environment-policy/runtime.cjs').accept(x.envelope,x.state,Buffer.from(x.manifest),x.root,x.keys);require('/home/site/wwwroot/packages/environment-policy/index.cjs').validateApi(x.env,p);process.stdout.write(p.build);";
const results=[];for(let i=0;i<3;i++){const r=cp.spawnSync(process.execPath,['-e',code],{input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,m.build);results.push('PASS')}
const original=fs.readFileSync(root+'/apps/api/dist/main.js');fs.appendFileSync(root+'/apps/api/dist/main.js','\n// altered\n');
assert.throws(()=>runtime.accept(sign(a),sign(s),manifest,root,keys));fs.writeFileSync(root+'/apps/api/dist/main.js',original);
s.revokedAuthorizationIds.push(a.authorizationId);assert.throws(()=>runtime.accept(sign(a),sign(s),manifest,root,keys));
console.log(JSON.stringify({status:'PASS',node:process.version,platform:process.platform,artifactBuild:m.build,manifestSHA256:runtime.sha(manifest),independentFreshProcesses:results,modifiedArtifactRejected:true,revokedAuthorizationRejected:true,network:'disabled',signing:'synthetic-only',appServiceRestartAcceptance:false,productionAcceptance:false}));
