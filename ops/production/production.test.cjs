"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('./contract.cjs'),{toolLock}=require('./build-artifact.cjs'),{sql}=require('./admin-sql.cjs');
const run=require('./run.cjs'),I=require('./inspect.cjs');
const root=path.resolve(__dirname,'../..');
test('exact seven migration bytes retain canonical hashes',()=>{
  for(const [n,h] of Object.entries(C.FORWARD))assert.equal(C.hash(fs.readFileSync(path.join(root,'apps/api/prisma/migrations',n,'migration.sql'))),h);
});
test('isolated tooling uses exact reviewed Prisma graph without application dependencies',()=>{
  const source=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'))),g=toolLock(source,JSON.parse(fs.readFileSync(path.join(root,'package.json'))));
  assert.equal(g.manifest.dependencies.prisma,'6.19.3');assert.equal(g.manifest.dependencies.pg,'8.22.0');
  assert(!g.lock.packages['node_modules/@nestjs/core']);assert(!g.lock.packages['apps/api']);
  assert.equal(g.manifest.overrides['@prisma/config']['deepmerge-ts'],'8.0.0');assert(!g.manifest.overrides['@nestjs/core']);
  for(const [k,v] of Object.entries(g.lock.packages))if(k)assert.equal(v.integrity,source.packages[k].integrity);
});
test('tooling rejects altered Prisma version and non-registry source',()=>{
  for(const mutate of [l=>l.packages['node_modules/prisma'].version='6.20.0',l=>l.packages['node_modules/pg'].resolved='https://unapproved.invalid/pg']){
    const l=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));mutate(l);assert.throws(()=>toolLock(l));
  }
});
const baseline={first:'a'.repeat(64),second:'b'.repeat(64)};
function rows(){return Object.entries(baseline).map(([migration_name,checksum])=>({migration_name,checksum,finished_at:new Date(),rolled_back_at:null}));}
test('ledger rejects failed, rolled back, duplicate, missing, extra and divergent rows',()=>{
  C.ledger(rows(),baseline);
  for(const mutate of [r=>r[0].finished_at=null,r=>r[0].rolled_back_at=new Date(),r=>r[0].checksum='c'.repeat(64),r=>r[1]={...r[0]},r=>r.pop(),r=>r.push({...r[0]})]){
    const r=rows();mutate(r);assert.throws(()=>C.ledger(r,baseline));
  }
});
function backup(){return {version:1,server:'opa-api-production-server',database:C.DB,publicAccess:'Disabled',retentionDays:7,observedAt:new Date().toISOString(),earliestRestoreDate:new Date(Date.now()-86400000).toISOString(),restorePoint:new Date(Date.now()-60000).toISOString(),evidenceSha256:'a'.repeat(64),approvalId:'test-review'};}
test('backup evidence fails closed on target, freshness, absent PITR and public access',()=>{
  C.backupEvidence(backup());
  for(const change of [{retentionDays:1},{publicAccess:'Enabled'},{observedAt:'2000-01-01T00:00:00Z'},{restorePoint:'invalid'},{earliestRestoreDate:'invalid'},{server:'staging'},{unexpected:'synthetic-only'}])assert.throws(()=>C.backupEvidence({...backup(),...change}));
});
test('private IPv4 rejects public IPv4, IPv6, ambiguity and missing values',()=>{
  for(const ip of ['10.0.0.1','172.16.0.1','192.168.3.4'])assert(run.privateIPv4(ip));
  for(const ip of ['8.8.8.8','172.15.0.1','10.0.0.999','010.0.0.1','::1',null])assert(!run.privateIPv4(ip));
});
test('pg TLS parsing cannot be weakened by Prisma URL parameters',()=>{
  const opts=run.connectOptions('postgresql://test_role:test%40password@db.invalid:5432/test?sslmode=require&sslaccept=strict');
  assert.deepEqual(opts.ssl,{rejectUnauthorized:true});assert.equal(opts.password,'test@password');assert(!opts.connectionString);
});
test('administrator scripts separate revoke commit from ownership reconciliation',()=>{
  const s=sql();assert.equal(Object.keys(s).length,3);
  assert(s['prepare.sql'].includes('ALTER TYPE public."UserRole" OWNER TO'));
  assert(s['prepare.sql'].includes('ALTER TABLE public."IncidentTimelineEvent" OWNER TO'));
  assert(s['cleanup.sql'].indexOf('REVOKE "opa_production_release_owner"')<s['cleanup.sql'].indexOf('COMMIT;'));
  assert(s['cleanup.sql'].indexOf('COMMIT;')<s['cleanup.sql'].indexOf('ALTER TABLE public."OnboardingAuthorityGrant"'));
  assert(s['cleanup.sql'].includes('pg_terminate_backend'));
  assert(!Object.values(s).some(v=>/GRANT .* TO "opa_production_runtime";/.test(v) && /GRANT "opa_production_release_owner" TO "opa_production_runtime"/.test(v)));
});
test('policy rejects API substitution and mismatched artifact before database connection',()=>{
  const artifact={manifest:{build:'a'.repeat(40)},manifestSha256:'b'.repeat(64)},bytes=Buffer.from(JSON.stringify(backup()));
  const env={OPA_ENVIRONMENT:'production',NODE_ENV:'production',OPA_BUILD_SHA:artifact.manifest.build};
  assert.throws(()=>run.policyInputs(root,artifact,env,bytes,'preflight',()=>({version:1,environment:'production',purpose:'api',build:artifact.manifest.build})),/POLICY_SCOPE/);
  assert.throws(()=>run.policyInputs(root,artifact,env,bytes,'preflight',()=>({version:1,environment:'production',purpose:'migration',build:artifact.manifest.build,approvedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),artifactSha256:'c'.repeat(64)})),/POLICY_ARTIFACT_BACKUP/);
});
function lifecycleFixture(failAt,mode='execute'){
  const calls=[],saved=[],receipt={cleanupRequired:true},old={...I};
  for(const name of ['identity','posture','history','compatibility','preStructure','structure'])I[name]=async()=>{
    calls.push(name);if(failAt===name)throw Error('secret DATABASE_URL=test');return name==='identity'?'digest':{};
  };
  const client={connect:async()=>{calls.push('connect');if(failAt==='connect')throw Error('secret');},end:async()=>{calls.push('end');if(failAt==='end')throw Error('secret');}};
  return {calls,saved,receipt,restore:()=>Object.assign(I,old),args:{client,artifact:{manifest:{baseline:{},candidate:{}}},policy:{expiresAt:new Date(Date.now()+60000).toISOString()},mode,receipt,save:()=>saved.push({...receipt}),invoke:async args=>{calls.push(args[1]);if(failAt===args[1])throw Error('password');}}};
}
for(const failure of ['connect','identity','posture','history','preStructure','compatibility','deploy','structure','diff','end'])test(`failure at ${failure} closes connection and retains cleanup obligation`,async()=>{
  const f=lifecycleFixture(failure);try{await assert.rejects(run.executeLifecycle(f.args));assert(f.calls.includes('end'));assert.equal(f.receipt.status,'failed');assert.equal(f.receipt.cleanupRequired,true);assert(!JSON.stringify(f.saved).includes('password'));if(['structure','diff'].includes(failure))assert.equal(f.receipt.activeMigrations,42);}finally{f.restore();}
});
test('successful migration cannot represent privilege cleanup as completed',async()=>{
  const f=lifecycleFixture();try{await run.executeLifecycle(f.args);assert.equal(f.receipt.status,'migrated-awaiting-admin-cleanup');assert.equal(f.receipt.cleanupRequired,true);assert(f.saved.some(r=>r.status==='execution-started'));assert.equal(f.receipt.activeMigrations,42);}finally{f.restore();}
});
test('read-only preflight never invokes Prisma deploy',async()=>{
  const f=lifecycleFixture(undefined,'preflight');try{await run.executeLifecycle(f.args);assert(!f.calls.includes('deploy'));assert.equal(f.receipt.status,'preflight-passed');}finally{f.restore();}
});
test('independent cleanup failure prevents post-migration approval',async()=>{
  const f=lifecycleFixture('posture','verify-post');try{await assert.rejects(run.executeLifecycle(f.args));assert(!f.calls.includes('diff'));assert.equal(f.receipt.cleanupRequired,true);}finally{f.restore();}
});
test('independent cleanup verification clears obligation only after posture passes',async()=>{
  const f=lifecycleFixture(undefined,'verify-cleanup');try{await run.executeLifecycle(f.args);assert.equal(f.receipt.status,'cleanup-verified');assert.equal(f.receipt.cleanupRequired,false);assert(!f.calls.includes('deploy'));}finally{f.restore();}
});
function policyFixture(){
  const artifact={manifest:{build:'a'.repeat(40)},manifestSha256:'b'.repeat(64)},bytes=Buffer.from(JSON.stringify(backup()));
  const sub='/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/opa-production/providers/';
  const app=sub+'Microsoft.Web/sites/opa-api-production',vault=sub+'Microsoft.KeyVault/vaults/opa-test-only';
  const env={OPA_ENVIRONMENT:'production',NODE_ENV:'production',OPA_BUILD_SHA:artifact.manifest.build,OPA_DEPLOYMENT_RESOURCE_ID:app,DATABASE_URL:`postgresql://${C.MIGRATOR}:synthetic-test-only@${C.HOST}:5432/${C.DB}?sslmode=require&sslaccept=strict`};
  const p={version:1,environment:'production',purpose:'migration',build:artifact.manifest.build,approvedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),approvalId:'test-review',action:'MIGRATE_OPA_PRODUCTION',writersQuiesced:true,artifactSha256:artifact.manifestSha256,backupSha256:C.hash(bytes),sentinelSha256:'c'.repeat(64),
    resources:{app:{environment:'production',id:app},database:{environment:'production',id:sub+'Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server',host:C.HOST,port:5432,database:C.DB,role:C.MIGRATOR},vault:{environment:'production',id:vault,secretOrigin:'https://opa-test-only.vault.azure.net'}},
    secrets:{DATABASE_URL:{environment:'production',vaultId:vault,secretId:'https://opa-test-only.vault.azure.net/secrets/test-only/'+'d'.repeat(32),sha256:C.hash(env.DATABASE_URL)}},runner:{kind:'azure-vm',resourceId:sub+'Microsoft.Compute/virtualMachines/test-only',privateAddresses:['10.1.2.3'],databaseAddresses:['10.1.2.4']}};
  env.OPA_MIGRATION_CONFIRMATION=`MIGRATE_OPA_PRODUCTION:${p.build}:${p.artifactSha256}:${p.approvalId}`;
  return {artifact,bytes,env,p};
}
test('complete dedicated signed-policy payload contract accepts only its exact operator binding',()=>{
  const f=policyFixture();assert.equal(run.policyInputs(root,f.artifact,f.env,f.bytes,'execute',()=>f.p),f.p);
});
for(const [name,mutate] of Object.entries({
  runtime_role:f=>f.p.resources.database.role=C.RUNTIME,
  staging_database:f=>f.p.resources.database.environment='staging',
  wrong_host:f=>f.p.resources.database.host='wrong.invalid',
  staging_app:f=>f.p.resources.app.environment='staging',
  stale_policy:f=>f.p.expiresAt='2000-01-01T00:00:00Z',
  excessive_window:f=>f.p.expiresAt=new Date(Date.now()+7200000).toISOString(),
  changed_sentinel:f=>f.p.sentinelSha256='',
  changed_backup:f=>f.p.backupSha256='e'.repeat(64),
  different_vault:f=>f.p.secrets.DATABASE_URL.vaultId='wrong',
  API_secret:f=>f.env.JWT_ACCESS_SECRET='synthetic-only',
  secret_value_in_policy:f=>f.p.secrets.DATABASE_URL.value='synthetic-only',
  public_database:f=>f.p.runner.databaseAddresses=['8.8.8.8'],
  public_runner:f=>f.p.runner.privateAddresses=['8.8.8.8'],
  unfenced_writers:f=>f.p.writersQuiesced=false,
  wrong_approval:f=>f.p.approvalId='wrong-review',
  missing_confirmation:f=>delete f.env.OPA_MIGRATION_CONFIRMATION,
  altered_credential:f=>f.env.DATABASE_URL+='&unsafe=1',
}))test(`dedicated migration policy rejects ${name}`,()=>{
  const f=policyFixture();mutate(f);assert.throws(()=>run.policyInputs(root,f.artifact,f.env,f.bytes,'execute',()=>f.p));
});
test('expired policy cannot spawn a Prisma process',async()=>{
  await assert.rejects(run.cli(root,[],{},'2000-01-01T00:00:00Z'),/PRISMA_POLICY_EXPIRED/);
});
test('CLI deadline terminates a stalled process and never reports success',{timeout:15000},async()=>{
  const os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-cli-timeout-test-'));
  try{
    const file=path.join(dir,'node_modules/prisma/build/index.js');fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n");
    await assert.rejects(run.cli(dir,[],{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},new Date(Date.now()+100).toISOString()));
  }finally{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});

test('exact production App Service is accepted as bounded migration runner',()=>{
  const f=policyFixture();
  const productionSub='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/';
  const app=productionSub+'Microsoft.Web/sites/opa-api-production';
  const vault=productionSub+'Microsoft.KeyVault/vaults/opa-test-only';

  f.env.OPA_DEPLOYMENT_RESOURCE_ID=app;
  f.p.resources.app.id=app;
  f.p.resources.database.id=productionSub+'Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server';
  f.p.resources.vault.id=vault;
  f.p.secrets.DATABASE_URL.vaultId=vault;
  f.p.runner.kind='azure-app-service';
  f.p.runner.resourceId=app;

  assert.equal(
    run.policyInputs(root,f.artifact,f.env,f.bytes,'execute',()=>f.p),
    f.p
  );
});

test('App Service runner rejects any non-production App Service resource',()=>{
  const f=policyFixture();
  const productionSub='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/';
  const app=productionSub+'Microsoft.Web/sites/opa-api-production';
  const vault=productionSub+'Microsoft.KeyVault/vaults/opa-test-only';

  f.env.OPA_DEPLOYMENT_RESOURCE_ID=app;
  f.p.resources.app.id=app;
  f.p.resources.database.id=productionSub+'Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server';
  f.p.resources.vault.id=vault;
  f.p.secrets.DATABASE_URL.vaultId=vault;
  f.p.runner.kind='azure-app-service';
  f.p.runner.resourceId=productionSub+'Microsoft.Web/sites/not-opa-production';

  assert.throws(
    ()=>run.policyInputs(root,f.artifact,f.env,f.bytes,'execute',()=>f.p),
    /RUNNER_BINDING/
  );
});

test('App Service runner still requires private runner addresses',()=>{
  const f=policyFixture();
  const productionSub='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/';
  const app=productionSub+'Microsoft.Web/sites/opa-api-production';
  const vault=productionSub+'Microsoft.KeyVault/vaults/opa-test-only';

  f.env.OPA_DEPLOYMENT_RESOURCE_ID=app;
  f.p.resources.app.id=app;
  f.p.resources.database.id=productionSub+'Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server';
  f.p.resources.vault.id=vault;
  f.p.secrets.DATABASE_URL.vaultId=vault;
  f.p.runner.kind='azure-app-service';
  f.p.runner.resourceId=app;
  f.p.runner.privateAddresses=['8.8.8.8'];

  assert.throws(
    ()=>run.policyInputs(root,f.artifact,f.env,f.bytes,'execute',()=>f.p),
    /PRIVATE_ADDRESSES/
  );
});
