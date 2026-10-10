'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),N=require('./app-service-network.cjs');
const fixture=()=>[{id:N.APP,properties:{virtualNetworkSubnetId:N.SUBNET}},{id:N.SUBNET,properties:{delegations:[{properties:{serviceName:'Microsoft.Web/serverFarms'}}]}},{id:N.DATABASE,properties:{fullyQualifiedDomainName:N.HOST,network:{publicNetworkAccess:'Disabled',delegatedSubnetResourceId:N.DBSUBNET}}}];
test('exact Azure configuration',()=>N.configuration(...fixture()));
for(const [name,change] of Object.entries({wrongApp:f=>f[0].id+='other',wrongIntegration:f=>f[0].properties.virtualNetworkSubnetId+='other',wrongSubnet:f=>f[1].id+='other',missingDelegation:f=>f[1].properties.delegations=[],wrongDB:f=>f[2].id+='other',publicDB:f=>f[2].properties.network.publicNetworkAccess='Enabled',wrongDBSubnet:f=>f[2].properties.network.delegatedSubnetResourceId+='other',wrongHost:f=>f[2].properties.fullyQualifiedDomainName='evil.test'}))test(name,()=>{const f=fixture();change(f);assert.throws(()=>N.configuration(...f),/^Error: APP_NETWORK_/);});
for(const a of ['8.8.8.8','169.254.1.1','127.0.0.1','010.0.0.1','10.256.0.1','::1'])test('reject '+a,()=>assert.equal(N.private4(a),false));
const verify=request=>async()=>{await request(new URL('http://127.0.0.1/msi/token'),{});};
function harness(addresses=[{family:4,address:'10.0.2.4'}],failure){const f=fixture();let i=0,connections=0;return {v:N.makeVerifier({verify,request:async(u)=>{if(u.protocol==='http:')return {access_token:'test-only'};if(failure)throw Error('APP_NETWORK_ARM_HTTP_403');return f[i++];},lookup:async()=>addresses,connect:async()=>{connections++;}}),count:()=>connections};}
const policy={runner:{databaseAddresses:['10.0.2.4']}};
test('private DNS and TLS required',async()=>{const h=harness();assert.equal((await h.v(policy,{})).tlsVerifyFull,true);assert.equal(h.count(),1);});
test('public DNS rejected before connection',async()=>{const h=harness([{family:4,address:'8.8.8.8'}]);await assert.rejects(h.v(policy,{}),/DATABASE_PRIVATE_DNS/);assert.equal(h.count(),0);});
test('unexpected private DNS rejected',async()=>{await assert.rejects(harness([{family:4,address:'10.0.2.5'}]).v(policy,{}),/DATABASE_PRIVATE_DNS/);});
test('ARM authorization fails closed',async()=>{await assert.rejects(harness(undefined,true).v(policy,{}),/403/);});
test('VM network implementation preserved',()=>{const fs=require('fs'),s=fs.readFileSync(__dirname+'/run.cjs','utf8');assert(s.includes("R(p.runner.privateAddresses.some(a=>addresses.includes(a)),'RUNNER_PRIVATE_NIC')"));assert(s.includes('const metadata=await imds()'));});

test('Azure service identifier casing is equivalent',()=>{const f=fixture();f[1].properties.delegations[0].properties.serviceName='Microsoft.Web/serverfarms';N.configuration(...f);});
