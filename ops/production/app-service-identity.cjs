'use strict';
const http=require('node:http'),https=require('node:https'),crypto=require('node:crypto');
const APP='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/Microsoft.Web/sites/opa-api-production';
const GUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const R=(v,code)=>{if(!v)throw Error(code);};
function identityBinding(runner){
 R(runner?.kind==='azure-app-service'&&runner.resourceId===APP,'APP_IDENTITY_RESOURCE');
 const i=runner.identity;
 R(i&&Object.keys(i).length===2&&GUID.test(i.principalId)&&GUID.test(i.tenantId),'APP_IDENTITY_POLICY');
 return i;
}
function endpoint(value){
 let u;try{u=new URL(value);}catch{throw Error('APP_IDENTITY_ENDPOINT');}
 const host=u.hostname,ip=host.split('.').map(Number);
 const local=host==='localhost'||host==='127.0.0.1'||(/^169\.254\.\d+\.\d+$/.test(host)&&ip.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&ip.map(String).join('.')===host);
 R(local&&u.protocol==='http:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/msi/token','APP_IDENTITY_ENDPOINT');
 u.searchParams.set('resource','https://management.azure.com/');u.searchParams.set('api-version','2019-08-01');return u;
}
function getJSON(url,headers,limit=1024*1024){
 return new Promise((resolve,reject)=>{
  const transport=url.protocol==='https:'?https:http;
  const request=transport.get(url,{headers,timeout:10000,...(url.protocol==='https:'?{rejectUnauthorized:true,servername:url.hostname}:{})},response=>{
   if(response.statusCode!==200){response.resume();reject(Error('APP_IDENTITY_HTTP'));return;}
   let size=0,parts=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>limit){request.destroy();reject(Error('APP_IDENTITY_RESPONSE'));}else parts.push(chunk);});
   response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(Error('APP_IDENTITY_RESPONSE'));}});
   response.on('error',()=>reject(Error('APP_IDENTITY_NETWORK')));
  });
  // A total deadline bounds dribbling responses as well as socket inactivity.
  const timer=setTimeout(()=>{request.destroy();reject(Error('APP_IDENTITY_NETWORK'));},10000);
  request.on('close',()=>clearTimeout(timer));request.on('timeout',()=>{request.destroy();reject(Error('APP_IDENTITY_NETWORK'));});request.on('error',()=>reject(Error('APP_IDENTITY_NETWORK')));
 });
}
function tokenParts(token){
 const parts=token.split('.');let header,claims;
 try{R(parts.length===3&&parts.every(p=>/^[a-zA-Z0-9_-]+$/.test(p)),'APP_IDENTITY_TOKEN_FORMAT');header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw Error('APP_IDENTITY_TOKEN_FORMAT');}
 R(header.alg==='RS256'&&typeof header.kid==='string'&&!header.jku&&!header.x5u&&!header.crit,'APP_IDENTITY_TOKEN_SIGNATURE');
 return {parts,header,claims};
}
function authenticatedClaims(c,identity,issuer,now){
 R(c.iss===issuer,'APP_IDENTITY_ISSUER');
 R(c.oid?.toLowerCase()===identity.principalId.toLowerCase()&&c.tid?.toLowerCase()===identity.tenantId.toLowerCase(),'APP_IDENTITY_PRINCIPAL');
 R(c.xms_mirid?.toLowerCase()===APP.toLowerCase(),'APP_IDENTITY_RESOURCE');
 R(['https://management.azure.com/','https://management.core.windows.net/'].includes(c.aud),'APP_IDENTITY_AUDIENCE');
 R(Number.isInteger(c.exp)&&Number.isInteger(c.nbf)&&c.exp>now&&c.nbf<=now,'APP_IDENTITY_TOKEN_TIME');
}
function makeVerifier(request=getJSON){
 return async function verifyAppIdentity(policy,env=process.env){
  const i=identityBinding(policy.runner),url=endpoint(env.IDENTITY_ENDPOINT);
  R(typeof env.IDENTITY_HEADER==='string'&&env.IDENTITY_HEADER.length>0&&!/[\r\n]/.test(env.IDENTITY_HEADER),'APP_IDENTITY_HEADER');
  let token;
  try{
   const response=await request(url,{'X-IDENTITY-HEADER':env.IDENTITY_HEADER});
   R(response.token_type?.toLowerCase()==='bearer'&&typeof response.access_token==='string'&&response.access_token.length>0&&response.access_token.length<=65536&&!/[\r\n]/.test(response.access_token),'APP_IDENTITY_TOKEN_FORMAT');
   token=response.access_token;response.access_token=undefined;
   const {parts,header,claims}=tokenParts(token);
   // Authority comes exclusively from reviewed policy, never token jku/iss.
   const tenant=i.tenantId.toLowerCase(),issuer='https://sts.windows.net/'+tenant+'/';
   const discovery=await request(new URL('https://login.microsoftonline.com/'+tenant+'/.well-known/openid-configuration'),{});
   R(discovery.issuer===issuer,'APP_IDENTITY_ISSUER');
   let keysURL;try{keysURL=new URL(discovery.jwks_uri);}catch{throw Error('APP_IDENTITY_AUTHORITY');}
   R(keysURL.protocol==='https:'&&keysURL.hostname==='login.microsoftonline.com'&&!keysURL.port&&!keysURL.username&&!keysURL.password&&!keysURL.hash&&!keysURL.search&&['/common/discovery/keys','/'+tenant+'/discovery/keys'].includes(keysURL.pathname),'APP_IDENTITY_AUTHORITY');
   const jwks=await request(keysURL,{});
   R(Array.isArray(jwks.keys)&&jwks.keys.length<=100,'APP_IDENTITY_TOKEN_SIGNATURE');
   const matching=jwks.keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use==='sig'&&(!k.alg||k.alg==='RS256'));
   R(matching.length===1,'APP_IDENTITY_TOKEN_SIGNATURE');const key=matching[0];
   if(key.issuer)R(key.issuer.replace('{tenantid}',tenant)===issuer,'APP_IDENTITY_ISSUER');
   let publicKey;try{publicKey=crypto.createPublicKey({key,format:'jwk'});}catch{throw Error('APP_IDENTITY_TOKEN_SIGNATURE');}
   R(publicKey.asymmetricKeyDetails.modulusLength>=2048&&crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')),'APP_IDENTITY_TOKEN_SIGNATURE');
   authenticatedClaims(claims,i,issuer,Math.floor(Date.now()/1000));
  }catch(e){
   const allowed=/^APP_IDENTITY_(HTTP|RESPONSE|NETWORK|RESOURCE|PRINCIPAL|TOKEN_FORMAT|TOKEN_SIGNATURE|AUDIENCE|TOKEN_TIME|ISSUER|AUTHORITY)$/;
   throw Error(allowed.test(e.message)?e.message:'APP_IDENTITY_REJECTED');
  }finally{token=undefined;}
 };
}
module.exports={APP,identityBinding,endpoint,makeVerifier,verifyAppIdentity:makeVerifier()};
