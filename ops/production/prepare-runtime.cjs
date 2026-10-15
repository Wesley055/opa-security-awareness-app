'use strict';
// Unsigned preparation: a configuration capture is evidence, never approval.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./contract.cjs'),runtime=require('../../packages/environment-policy/runtime.cjs'),registry=require('../../packages/environment-policy/trusted-signers.json'),{APP}=require('./cutover.cjs');
function prepare(planFile,out,{keys=registry,now=Date.now()}={}) {
 const p=JSON.parse(fs.readFileSync(planFile)),base=path.dirname(path.resolve(planFile)),load=n=>fs.readFileSync(path.resolve(base,p[n]));
 C.requireThat(!fs.existsSync(out)&&/^[a-zA-Z0-9_-]{16,128}$/.test(p.authorizationId||''),'RUNTIME_PREPARATION_INPUT');
 const manifestBytes=load('manifest'),manifest=JSON.parse(manifestBytes),zip=load('api'),capture=JSON.parse(load('configurationCapture'));
 C.requireThat(C.hash(zip)===p.apiSHA256&&C.hash(manifestBytes)===p.manifestSHA256&&manifest.build===p.build,'RUNTIME_EXACT_ARTIFACT');
 C.requireThat(Number.isFinite(Date.parse(capture.capturedAt))&&Date.parse(capture.capturedAt)<=now&&now-Date.parse(capture.capturedAt)<=3600000&&capture.resourceId===APP,'CURRENT_CONFIGURATION_CAPTURE');
 const policy={...capture.policy,version:1,purpose:'api',environment:'production',build:p.build};
 C.requireThat(policy.resources?.app?.id===APP&&policy.settings&&policy.secrets&&policy.resources?.database?.role===C.RUNTIME,'RUNTIME_CONFIGURATION_BINDING');
 const fingerprint=C.hash(crypto.createPublicKey(keys.production[p.keyId]).export({type:'spki',format:'der'}));
 let previous;
 if(p.currentCustody) {
  const bytes=load('currentCustody');C.requireThat(C.hash(bytes)===p.currentCustodySHA256,'CURRENT_CUSTODY_HASH');
  previous=runtime.signed(JSON.parse(bytes),keys,'runtime-custody',now).p;
  C.requireThat(previous.resourceId===APP&&Number.isSafeInteger(previous.sequence)&&previous.sequence>=1&&previous.activeAuthorizations&&Array.isArray(previous.revokedAuthorizationIds)&&Array.isArray(previous.revokedAuthorityFingerprints),'CURRENT_CUSTODY_SCOPE');
 } else {
  // A caller's boolean is insufficient evidence of an uninitialized vault.
  const proof=JSON.parse(load('initializationEvidence'));
  C.requireThat(proof.resourceId===APP&&proof.secretName==='opa-api-runtime-custody'&&proof.status===404&&Number.isFinite(Date.parse(proof.observedAt))&&Date.parse(proof.observedAt)<=now&&now-Date.parse(proof.observedAt)<=3600000&&proof.approvedInitializationReference,'CUSTODY_INITIALIZATION_EVIDENCE');
 }
 const sequence=previous?previous.sequence+1:1;
 C.requireThat(Number.isSafeInteger(sequence)&&!previous?.revokedAuthorizationIds.includes(p.authorizationId)&&!previous?.revokedAuthorityFingerprints.includes(fingerprint),'REVOKED_RUNTIME_PREPARATION');
 const issuedAt=new Date(now).toISOString(),authorization={version:2,environment:'production',purpose:'runtime-api',issuedAt,authorizationId:p.authorizationId,minimumCustodySequence:sequence,authorityFingerprint:fingerprint,manifestSHA256:p.manifestSHA256,policy};
 if(p.continuitySeconds!==undefined){C.requireThat(Number.isSafeInteger(p.continuitySeconds)&&p.continuitySeconds>=60&&p.continuitySeconds<=259200,'CONTINUITY_BOUND');authorization.continuitySeconds=p.continuitySeconds}
 const bytes=Buffer.from(JSON.stringify(authorization)),custody={version:2,environment:'production',purpose:'runtime-custody',issuedAt,sequence,resourceId:APP,activeAuthorizations:{...previous?.activeAuthorizations,[p.authorizationId]:C.hash(bytes)},revokedAuthorizationIds:previous?.revokedAuthorizationIds||[],revokedAuthorityFingerprints:previous?.revokedAuthorityFingerprints||[]};
 for(const relative of p.additionalRuntimePayloads||[]) {
 const b=fs.readFileSync(path.resolve(base,relative)),a=JSON.parse(b);
 C.requireThat(a.version===2&&a.purpose==='runtime-api'&&a.environment==='production'&&a.minimumCustodySequence===sequence&&a.policy?.resources?.app?.id===APP&&a.authorityFingerprint===fingerprint&&a.authorizationId!==p.authorizationId&&!custody.revokedAuthorizationIds.includes(a.authorizationId)&&!custody.revokedAuthorityFingerprints.includes(a.authorityFingerprint),'ADDITIONAL_RUNTIME_SCOPE');
 C.requireThat(!custody.activeAuthorizations[a.authorizationId]||custody.activeAuthorizations[a.authorizationId]===C.hash(b),'AUTHORIZATION_ID_REUSE');custody.activeAuthorizations[a.authorizationId]=C.hash(b);
 }
 C.requireThat(!previous?.activeAuthorizations[p.authorizationId]||previous.activeAuthorizations[p.authorizationId]===C.hash(bytes),'AUTHORIZATION_ID_REUSE');
 fs.mkdirSync(out,{recursive:true});
 const outputs={};for(const [name,b] of [['runtime-api',bytes],['runtime-custody',Buffer.from(JSON.stringify(custody))]]){const file=path.join(out,name+'.UNSIGNED.payload.json');fs.writeFileSync(file,b,{flag:'wx',mode:0o600});outputs[name]={path:file,sha256:C.hash(b)}}
 const receipt={status:'UNSIGNED_NO_AUTHORIZATION',keyId:p.keyId,authorityFingerprint:fingerprint,apiSHA256:p.apiSHA256,manifestSHA256:p.manifestSHA256,sequence,outputs,keyAccessed:false,productionModified:false};
 fs.writeFileSync(path.join(out,'preparation-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});return receipt;
}
if(require.main===module){try{console.log(JSON.stringify(prepare(...process.argv.slice(2))))}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'RUNTIME_PREPARATION_REJECTED');process.exitCode=1}}
module.exports={prepare};
