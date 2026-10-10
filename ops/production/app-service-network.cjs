'use strict';
const https=require('node:https'),tls=require('node:tls'),dns=require('node:dns').promises;
const identity=require('./app-service-identity.cjs');
const APP=identity.APP,BASE=APP.slice(0,APP.indexOf('/providers/'));
const VNET=BASE+'/providers/Microsoft.Network/virtualNetworks/opa-api-productionVnet';
const SUBNET=VNET+'/subnets/opa-api-productionAppSubnet',DBSUBNET=VNET+'/subnets/opa-api-productionDbSubnet';
const DATABASE=BASE+'/providers/Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server';
const HOST='opa-api-production-server.postgres.database.azure.com';
const R=(v,c)=>{if(!v)throw Error(c);};
function read(url,headers){return new Promise((resolve,reject)=>{
 const transport=url.protocol==='http:'?require('node:http'):https;const q=transport.get(url,{headers,rejectUnauthorized:true,timeout:10000},s=>{if(s.statusCode!==200){s.resume();reject(Error('APP_NETWORK_ARM_HTTP_'+s.statusCode));return;}let n=0,a=[];s.on('data',b=>{n+=b.length;if(n>1048576)q.destroy();else a.push(b);});s.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(a)));}catch{reject(Error('APP_NETWORK_RESPONSE'));}});s.on('error',()=>reject(Error('APP_NETWORK_TRANSPORT')));});
 const timer=setTimeout(()=>q.destroy(Error('APP_NETWORK_TIMEOUT')),10000);q.on('close',()=>clearTimeout(timer));q.on('error',()=>reject(Error('APP_NETWORK_TRANSPORT')));
});}
function private4(a){const p=a.split('.');return p.length===4&&p.every(x=>/^\d+$/.test(x)&&String(Number(x))===x&&Number(x)<=255)&&(p[0]==='10'||p[0]==='172'&&Number(p[1])>=16&&Number(p[1])<=31||p[0]==='192'&&p[1]==='168');}
function configuration(app,subnet,db){
 R(app.id?.toLowerCase()===APP.toLowerCase()&&app.properties?.virtualNetworkSubnetId?.toLowerCase()===SUBNET.toLowerCase(),'APP_NETWORK_INTEGRATION');
 R(subnet.id?.toLowerCase()===SUBNET.toLowerCase()&&subnet.properties?.delegations?.some(d=>d.properties?.serviceName?.toLowerCase()==='microsoft.web/serverfarms'),'APP_NETWORK_SUBNET');
 R(db.id?.toLowerCase()===DATABASE.toLowerCase()&&db.properties?.fullyQualifiedDomainName===HOST&&db.properties?.network?.publicNetworkAccess==='Disabled'&&db.properties.network.delegatedSubnetResourceId?.toLowerCase()===DBSUBNET.toLowerCase(),'APP_NETWORK_DATABASE');
}
function probe(address){return new Promise((resolve,reject)=>{
 // PostgreSQL SSLRequest only; never sends StartupMessage, credentials or SQL.
 const net=require('node:net');const s=net.connect({host:address,port:5432});let secured;const timer=setTimeout(()=>{s.destroy();secured?.destroy();reject(Error('APP_NETWORK_TLS_TIMEOUT'));},10000);
 const fail=()=>{clearTimeout(timer);s.destroy();secured?.destroy();reject(Error('APP_NETWORK_TLS'));};s.once('error',fail);
 s.once('connect',()=>{const b=Buffer.alloc(8);b.writeInt32BE(8);b.writeInt32BE(80877103,4);s.write(b);});
 s.once('data',b=>{if(b.length!==1||b[0]!==83){fail();return;}s.removeListener('error',fail);secured=tls.connect({socket:s,servername:HOST,rejectUnauthorized:true,minVersion:'TLSv1.2'},()=>{clearTimeout(timer);const ok=secured.authorized;secured.destroy();if(ok)resolve();else reject(Error('APP_NETWORK_TLS'));});secured.once('error',fail);});
});}
function makeVerifier({request=read,verify=identity.makeVerifier,lookup=dns.lookup,connect=probe}={}){return async function(policy,env=process.env){let token;try{
 // Retain only the token whose signature and exact identity are verified by the existing verifier.
 await verify(async(u,h)=>{const x=await request(u,h);if(u.protocol==='http:'&&x.access_token)token=x.access_token;return x;})(policy,env);
 R(token,'APP_NETWORK_TOKEN');const headers={Authorization:'Bearer '+token};
 const get=(id,v)=>request(new URL('https://management.azure.com'+id+'?api-version='+v),headers);
 const app=await get(APP,'2023-12-01'),subnet=await get(SUBNET,'2023-09-01'),db=await get(DATABASE,'2022-12-01');configuration(app,subnet,db);
 const addresses=await lookup(HOST,{all:true});R(addresses.length>0&&addresses.length<=8&&addresses.every(a=>a.family===4&&private4(a.address)&&policy.runner.databaseAddresses.includes(a.address)),'DATABASE_PRIVATE_DNS');
 for(const a of addresses)await connect(a.address);
 return {identity:true,azureNetworkBinding:true,privateDNS:true,tlsVerifyFull:true,sqlExecuted:false};
 }finally{token=undefined;}};}
module.exports={APP,SUBNET,DBSUBNET,DATABASE,HOST,configuration,private4,probe,makeVerifier,verifyAppNetwork:makeVerifier()};
