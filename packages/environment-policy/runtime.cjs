'use strict';
// Runtime custody is deliberately separate from deployment/migration admission.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function reject() { throw Error('OPA durable runtime authorization rejected'); }
class TransientCustodyError extends Error { constructor() { super('OPA_CUSTODY_TEMPORARILY_UNAVAILABLE'); } }
function transientTransport(e) {
  return ['AbortError','TimeoutError'].includes(e.name) || /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(e.code || e.cause?.code || '');
}
async function custodyJSON(response) {try{return await response.json()}catch(e){if(transientTransport(e))throw new TransientCustodyError();throw e}}
async function requestCustody(request, url, options) {
  let response;
  try { response=await request(url,options); }
  catch(e) {
    if (transientTransport(e)) throw new TransientCustodyError();
    throw e;
  }
  if ([408,429,500,502,503,504].includes(response.status)) throw new TransientCustodyError();
  if(!response.ok) reject();
  return response;
}
function signed(envelope, keys, purpose, now) {
  const key = keys.production?.[envelope?.keyId];
  if (!key || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') reject();
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!crypto.verify(null, bytes, key, Buffer.from(envelope.signature, 'base64'))) reject();
  const p = JSON.parse(bytes);
  if (p.version !== 2 || p.environment !== 'production' || p.purpose !== purpose ||
      typeof p.issuedAt !== 'string' || !Number.isFinite(Date.parse(p.issuedAt)) || Date.parse(p.issuedAt) > now ||
      Object.hasOwn(p, 'expiresAt')) reject();
  return { p, fingerprint: sha(crypto.createPublicKey(key).export({type:'spki',format:'der'})) };
}
function inventory(root) {
  const files = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name), relative = path.relative(root, absolute).split(path.sep).join('/');
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute);
        const resolved = fs.realpathSync(absolute), base = fs.realpathSync(root) + path.sep;
        if (!resolved.startsWith(base) || path.isAbsolute(target)) reject();
        files[relative] = {link:target};
      } else if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) files[relative] = {sha256:sha(fs.readFileSync(absolute))};
      else reject();
    }
  }
  walk(root);
  return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0));
}
function authenticate(envelope, stateEnvelope, manifestBytes, keys, now) {
  try {
    const {p:a, fingerprint} = signed(envelope, keys, 'runtime-api', now);
    const {p:s} = signed(stateEnvelope, keys, 'runtime-custody', now);
    if (!/^[a-f0-9]{64}$/.test(a.manifestSHA256) || sha(manifestBytes) !== a.manifestSHA256 ||
        !/^[a-zA-Z0-9_-]{16,128}$/.test(a.authorizationId) ||
        !Number.isSafeInteger(a.minimumCustodySequence) || a.minimumCustodySequence < 1 ||
        !Number.isSafeInteger(s.sequence) || s.sequence < a.minimumCustodySequence ||
        a.authorityFingerprint !== fingerprint || !Array.isArray(s.revokedAuthorizationIds) ||
        !Array.isArray(s.revokedAuthorityFingerprints) || s.revokedAuthorizationIds.includes(a.authorizationId) ||
        s.revokedAuthorityFingerprints.includes(fingerprint) || s.resourceId !== a.policy?.resources?.app?.id ||
        a.policy?.environment !== 'production' || a.policy?.purpose !== 'api' || a.policy?.version !== 1 ||
        typeof a.policy.build !== 'string' || !a.policy.build ||
        s.activeAuthorizations?.[a.authorizationId] !== sha(Buffer.from(envelope.payload,'base64'))) reject();
    const manifest = JSON.parse(manifestBytes);
    if (manifest.version !== 1 || manifest.build !== a.policy.build) reject();
    return {policy:a.policy, manifest};
  } catch { reject(); }
}
function accept(envelope, stateEnvelope, manifestBytes, root, keys, now = Date.now()) {
  const {policy,manifest}=authenticate(envelope,stateEnvelope,manifestBytes,keys,now);
  if (JSON.stringify(inventory(root)) !== JSON.stringify(manifest.files)) reject();
  return policy;
}
function material() {
  // Neither custody nor manifest location is configurable by the API environment.
  const custody = '/home/opa-runtime-custody';
  return [JSON.parse(fs.readFileSync(path.join(custody,'state.signed.json'))),
    fs.readFileSync(path.join(custody,'artifact.manifest.json'))];
}
function read(envelope,keys) {
  // Every startup/worker policy read requires authenticated bounded custody,
  // even if a caller forgot to perform the asynchronous refresh first.
  resume(envelope,process.env,keys,'/home/opa-runtime-custody',path.resolve(__dirname,'../..'));
  const [state,manifest]=material();return authenticate(envelope,state,manifest,keys,Date.now()).policy;
}
function check(envelope,keys) {const [state,manifest]=material();return authenticate(envelope,state,manifest,keys,Date.now()).policy;}
async function retrieve(envelope, env, keys, manifest, request = fetch) {
  // Key Vault latest-version reads are the current-state oracle. Application
  // storage account keys cannot overwrite this separately controlled custody.
  const {p:a}=signed(envelope,keys,'runtime-api',Date.now());
  const vault=a.policy?.resources?.vault;
  const vaultOrigin=new URL(vault?.secretOrigin);
  if(vaultOrigin.protocol!=='https:' || !/^[a-zA-Z0-9-]+\.vault\.azure\.net$/.test(vaultOrigin.hostname) ||
     vaultOrigin.origin!==vault.secretOrigin || vaultOrigin.pathname!=='/' || vaultOrigin.search || vaultOrigin.hash)reject();
  const identity=new URL(env.IDENTITY_ENDPOINT);
  if (identity.protocol !== 'http:' || !/^(127\.0\.0\.1|169\.254\.\d{1,3}\.\d{1,3})$/.test(identity.hostname) ||
      identity.username || identity.password || !env.IDENTITY_HEADER) reject();
  identity.searchParams.set('api-version','2019-08-01');
  identity.searchParams.set('resource','https://vault.azure.net');
  const tokenResponse=await requestCustody(request,identity,{headers:{'X-IDENTITY-HEADER':env.IDENTITY_HEADER},signal:AbortSignal.timeout(10000),redirect:'error'});
  if (!tokenResponse.ok) reject();
  const token=await custodyJSON(tokenResponse);if(typeof token.access_token!=='string'||!token.access_token)reject();
  const url=`${vault.secretOrigin}/secrets/opa-api-runtime-custody?api-version=7.4`;
  const response=await requestCustody(request,url,{headers:{Authorization:'Bearer '+token.access_token,'Cache-Control':'no-cache'},cache:'no-store',signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok)reject();
  const result=await custodyJSON(response);if(typeof result.value!=='string')reject();
  const bytes=Buffer.from(result.value);if(bytes.length>25000)reject();
  const state=JSON.parse(bytes);
  try { authenticate(envelope,state,manifest,keys,Date.now()); }
  catch(e) {
    try { e.confirmedSequence=signed(state,keys,'runtime-custody',Date.now()).p.sequence; } catch { /* invalid signatures are terminal too */ }
    throw e;
  }
  return bytes;
}
function continuityMAC(record,envelope,env,keys) {
  const {p:a}=signed(envelope,keys,'runtime-api',Date.now());
  if(!env.JWT_ACCESS_SECRET || a.policy.secrets?.JWT_ACCESS_SECRET?.sha256!==sha(env.JWT_ACCESS_SECRET))reject();
  const key=crypto.hkdfSync('sha256',Buffer.from(env.JWT_ACCESS_SECRET),Buffer.from(a.manifestSHA256),'OPA runtime continuity receipt v1',32);
  return crypto.createHmac('sha256',key).update(JSON.stringify(record)).digest('hex');
}
function resume(envelope,env,keys,directory,root,now=Date.now()) {
  if(fs.existsSync(path.join(directory,'continuity-blocked.json')))reject();
  const manifest=fs.readFileSync(path.join(directory,'artifact.manifest.json'));
  const bytes=fs.readFileSync(path.join(directory,'state.signed.json'));
  const stored=JSON.parse(fs.readFileSync(path.join(directory,'continuity.json')));
  const {mac,...record}=stored;
  const expected=continuityMAC(record,envelope,env,keys);
  if(typeof mac!=='string'||!/^[a-f0-9]{64}$/.test(mac)||!crypto.timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(expected,'hex')))reject();
  const {p:a}=signed(envelope,keys,'runtime-api',now),seconds=a.continuitySeconds ?? 21600;
  if(!Number.isSafeInteger(seconds)||seconds<60||seconds>259200||record.version!==1||
     record.authorizationSHA256!==sha(Buffer.from(envelope.payload,'base64'))||record.stateSHA256!==sha(bytes)||
     record.manifestSHA256!==sha(manifest)||!Number.isSafeInteger(record.verifiedAt)||now<record.verifiedAt||now-record.verifiedAt>seconds*1000)reject();
  const policy=accept(envelope,JSON.parse(bytes),manifest,root,keys,now);
  require('./index.cjs').validateApi(env,policy);
  return {mode:'continuity',verifiedAt:record.verifiedAt,deadline:record.verifiedAt+seconds*1000};
}
async function refresh(envelope,env,keys,{directory='/home/opa-runtime-custody',root=path.resolve(__dirname,'../..'),request=fetch,now=Date.now}={}) {
  let bytes;
  try { bytes=await retrieve(envelope,env,keys,fs.readFileSync(path.join(directory,'artifact.manifest.json')),request); }
  catch(e) {
    if(!(e instanceof TransientCustodyError)) {
      // Latch confirmed security failures across process restart. A later
      // transport outage must never resurrect the previously cached allow.
      const blocked={version:1,authorizationSHA256:sha(Buffer.from(envelope.payload,'base64')),sequence:Number.isSafeInteger(e.confirmedSequence)?e.confirmedSequence:null};
      fs.writeFileSync(path.join(directory,'continuity-blocked.json'),JSON.stringify({...blocked,mac:continuityMAC(blocked,envelope,env,keys)}),{mode:0o600});
      throw e;
    }
    const result=resume(envelope,env,keys,directory,root,now());
    console.warn('[OPA-RUNTIME-CUSTODY]',JSON.stringify(result));
    return result;
  }
  const state=JSON.parse(bytes);
  const blockedFile=path.join(directory,'continuity-blocked.json');
  if(fs.existsSync(blockedFile)) {
    const {mac,...blocked}=JSON.parse(fs.readFileSync(blockedFile));
    if(blocked.authorizationSHA256===sha(Buffer.from(envelope.payload,'base64')) &&
       (mac!==continuityMAC(blocked,envelope,env,keys) || blocked.sequence!==null&&signed(state,keys,'runtime-custody',Date.now()).p.sequence<=blocked.sequence))reject();
  }
  const file=path.join(directory,'state.signed.json');
  if(fs.existsSync(file)) {
    const previous=signed(JSON.parse(fs.readFileSync(file)),keys,'runtime-custody',Date.now()).p;
    const current=signed(state,keys,'runtime-custody',Date.now()).p;
    if(current.sequence<previous.sequence || (current.sequence===previous.sequence && sha(bytes)!==sha(fs.readFileSync(file))))reject();
  }
  const pending=file+'.'+process.pid+'.'+crypto.randomUUID();
  fs.writeFileSync(pending,bytes,{flag:'wx',mode:0o600});
  try{fs.renameSync(pending,file)}finally{if(fs.existsSync(pending))fs.unlinkSync(pending)}
  const record={version:1,authorizationSHA256:sha(Buffer.from(envelope.payload,'base64')),stateSHA256:sha(bytes),manifestSHA256:sha(fs.readFileSync(path.join(directory,'artifact.manifest.json'))),verifiedAt:now()};
  const cache=path.join(directory,'continuity.json'),next=cache+'.'+crypto.randomUUID();
  fs.writeFileSync(next,JSON.stringify({...record,mac:continuityMAC(record,envelope,env,keys)}),{flag:'wx',mode:0o600});
  try{fs.renameSync(next,cache)}finally{if(fs.existsSync(next))fs.unlinkSync(next)}
  if(fs.existsSync(blockedFile))fs.unlinkSync(blockedFile);
  console.info('[OPA-RUNTIME-CUSTODY]',JSON.stringify({sequence:signed(state,keys,'runtime-custody',Date.now()).p.sequence,stateSHA256:sha(bytes)}));
  return {mode:'verified',verifiedAt:record.verifiedAt};
}
module.exports = {accept, authenticate, signed, read, check, refresh, retrieve, resume, inventory, sha, TransientCustodyError};
