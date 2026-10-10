'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test'),crypto=require('node:crypto');
const repo=require('node:path').resolve(__dirname,'../..'),E=require('./emergency-writers.cjs'),run=require('./run.cjs');
const C=require(repo+'/ops/production/contract.cjs'),boundary=require(repo+'/packages/environment-policy/index.cjs');
const source=fs.readFileSync(repo+'/ops/production/production.test.cjs','utf8');
const extract=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const ctx={C,Date,Buffer};vm.createContext(ctx);vm.runInContext(extract('function backup(){',"test('backup evidence")+extract('function policyFixture(){',"test('complete dedicated"),ctx);
function fixture(){const f=ctx.policyFixture(),p=f.p;f.artifact.manifest.forward={...C.FORWARD};f.artifact.manifest.baseline=Object.fromEntries(Array.from({length:35},(_,i)=>['baseline'+i,'a'.repeat(64)]));f.artifact.manifest.candidate={...f.artifact.manifest.baseline,...C.FORWARD};
 p.resources.app.id=E.APP;p.resources.database.id=E.SERVER;f.env.OPA_DEPLOYMENT_RESOURCE_ID=E.APP;
 const sub=E.APP.split('/resourceGroups/')[0];p.resources.vault.id=sub+'/resourceGroups/opa-production/providers/Microsoft.KeyVault/vaults/opa-test-only';p.secrets.DATABASE_URL.vaultId=p.resources.vault.id;
 p.runner={kind:'azure-app-service',resourceId:E.APP,privateAddresses:['10.0.0.1'],databaseAddresses:['10.0.2.4'],identity:{tenantId:'adb3fb59-1ac3-42c2-b39a-d70c7006ccbc',principalId:'ed24b331-4dfe-4e07-8aa9-83f835ce7b6c'}};
 p.writersQuiesced=false;
 p.emergencyWriterException={version:1,cutoverId:'opa-seven-20261010-sos',approvalId:p.approvalId,build:p.build,artifactSha256:f.artifact.manifestSha256,originalManifestSha256:E.ORIGINAL,forward:{...C.FORWARD},compatibilityEvidenceSha256:E.EVIDENCE,appResourceId:E.APP,databaseResourceId:E.SERVER,start:p.approvedAt,end:p.expiresAt,lockTimeoutMs:500,statementTimeoutMs:2000,maxSOSDatabasePhaseMs:3000,timeoutApplySha256:E.APPLY,timeoutRestoreSha256:E.RESTORE,activeWriterClasses:[...E.ACTIVE],otherWritersQuiesced:true,writerStateEvidenceSha256:'e'.repeat(64)};
 return f;
}
const check=f=>run.policyInputs(repo,f.artifact,f.env,f.bytes,'execute',()=>f.p);
test('truthful signed exception passes complete runner policy validation',()=>check(fixture()));
for(const [name,mutate] of Object.entries({
 absent:f=>delete f.p.emergencyWriterException,
 contradictory:f=>f.p.writersQuiesced=true,
 unknown:f=>f.p.emergencyWriterException.extra=true,
 future_set:f=>f.p.emergencyWriterException.forward.future='a'.repeat(64),
 altered_sql:f=>f.p.emergencyWriterException.forward[Object.keys(C.FORWARD)[0]]='f'.repeat(64),
 wrong_artifact:f=>f.p.emergencyWriterException.artifactSha256='f'.repeat(64),
 wrong_build:f=>f.p.emergencyWriterException.build='f'.repeat(40),
 wrong_approval:f=>f.p.emergencyWriterException.approvalId='other',
 wrong_evidence:f=>f.p.emergencyWriterException.compatibilityEvidenceSha256='f'.repeat(64),
 wrong_original:f=>f.p.emergencyWriterException.originalManifestSha256='f'.repeat(64),
 wrong_resource:f=>f.p.emergencyWriterException.appResourceId=E.APP+'-other',
 future_window:f=>f.p.emergencyWriterException.start=new Date(Date.now()+10000).toISOString(),
 expired_window:f=>f.p.emergencyWriterException.end=new Date(Date.now()-10000).toISOString(),
 oversized_window:f=>f.p.emergencyWriterException.end=new Date(Date.now()+7200000).toISOString(),
 relaxed_lock:f=>f.p.emergencyWriterException.lockTimeoutMs=501,
 relaxed_statement:f=>f.p.emergencyWriterException.statementTimeoutMs=2001,
 relaxed_SOS:f=>f.p.emergencyWriterException.maxSOSDatabasePhaseMs=3001,
 changed_restore:f=>f.p.emergencyWriterException.timeoutRestoreSha256='f'.repeat(64),
 missing_writer_receipt:f=>delete f.p.emergencyWriterException.writerStateEvidenceSha256,
 ordinary_live:f=>f.p.emergencyWriterException.otherWritersQuiesced=false,
 extra_writer:f=>f.p.emergencyWriterException.activeWriterClasses.push('unreviewed'),
 URL_override:f=>{f.env.DATABASE_URL+='&options=unsafe';f.p.secrets.DATABASE_URL.sha256=C.hash(f.env.DATABASE_URL);},
 runtime_role:f=>f.p.resources.database.role=C.RUNTIME,
 missing_identity:f=>delete f.p.runner.identity,
 wrong_secret:f=>f.p.secrets.DATABASE_URL.sha256='f'.repeat(64)
}))test('reject '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>check(f));});
test('ordinary fully quiesced contract passes unchanged',()=>{const f=ctx.policyFixture();check(f);});
test('unsigned, altered and expired envelopes reject before exception use',()=>{
 const f=fixture(),{publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),keys={production:{'local-test':publicKey}},bytes=Buffer.from(JSON.stringify(f.p));
 const env={keyId:'local-test',payload:bytes.toString('base64'),signature:crypto.sign(null,bytes,privateKey).toString('base64')};
 assert.equal(boundary.verifyEnvelope(env,'production','migration',keys).writersQuiesced,false);
 assert.throws(()=>boundary.verifyEnvelope({...env,signature:''},'production','migration',keys));
 assert.throws(()=>boundary.verifyEnvelope({...env,payload:Buffer.from(JSON.stringify({...f.p,writersQuiesced:true})).toString('base64')},'production','migration',keys));
 const expired=Buffer.from(JSON.stringify({...f.p,expiresAt:'2000-01-01T00:00:00Z'}));assert.throws(()=>boundary.verifyEnvelope({...env,payload:expired.toString('base64'),signature:crypto.sign(null,expired,privateKey).toString('base64')},'production','migration',keys));
});
const good={lock_timeout:'500ms',statement_timeout:'2s',role_settings:['lock_timeout=500ms','statement_timeout=2s']};
test('effective session and fresh-session role defaults both required',async()=>{
 await E.verifyTimeouts({query:async()=>({rows:[good]})});
 for(const row of [{...good,lock_timeout:'0'},{...good,statement_timeout:'0'},{...good,role_settings:[]},{...good,role_settings:null}])await assert.rejects(E.verifyTimeouts({query:async()=>({rows:[row]})}));
});
test('timeout verification failure closes client and preserves cleanup obligation before deploy',async()=>{
 const calls=[],receipt={cleanupRequired:true};const client={connect:async()=>calls.push('connect'),query:async()=>({rows:[]}),end:async()=>calls.push('end')};
 await assert.rejects(run.executeLifecycle({client,artifact:fixture().artifact,policy:fixture().p,mode:'execute',invoke:async()=>calls.push('deploy'),receipt,save:()=>{}}));
 assert.deepEqual(calls,['connect','end']);assert.equal(receipt.cleanupRequired,true);assert.equal(receipt.status,'failed');
});

test('restoration rejects either remaining scoped override',async()=>{
 await E.verifyRestoredTimeouts({query:async()=>({rows:[]})});
 await E.verifyRestoredTimeouts({query:async()=>({rows:[{setconfig:['search_path=public']}]})});
 for(const key of ['lock_timeout=500ms','statement_timeout=2s'])await assert.rejects(E.verifyRestoredTimeouts({query:async()=>({rows:[{setconfig:[key]}]})}));
});
test('new exception cannot bypass cleanup on migration failure',async()=>{
 const I=require(repo+'/ops/production/inspect.cjs'),old={...I},receipt={cleanupRequired:true},calls=[];
 for(const name of ['identity','posture','history','preStructure','compatibility','structure'])I[name]=async()=>name==='identity'?'digest':{};
 const f=fixture(),client={connect:async()=>{},query:async()=>({rows:[good]}),end:async()=>calls.push('end')};
 try{await assert.rejects(run.executeLifecycle({client,artifact:f.artifact,policy:f.p,mode:'execute',invoke:async()=>{throw Error('modeled migration failure');},receipt,save:()=>{}}));assert.equal(receipt.cleanupRequired,true);assert.equal(receipt.status,'failed');assert.deepEqual(calls,['end']);}finally{Object.assign(I,old);}
});
test('exception rejects another tenant or managed principal',()=>{
 for(const key of ['tenantId','principalId']){const f=fixture();f.p.runner.identity[key]='11111111-1111-1111-1111-111111111111';assert.throws(()=>check(f),/EMERGENCY_IDENTITY/);}
});
