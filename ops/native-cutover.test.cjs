"use strict";
// Opt-in test: cached PostgreSQL 14 only, loopback ephemeral port, tmpfs data,
// synthetic credentials, no cloud endpoints, no production connection inputs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const C=require('./production/contract.cjs'),I=require('./production/inspect.cjs'),{sql}=require('./production/admin-sql.cjs');
const root=path.resolve(__dirname,'..');
test('Isolated native PostgreSQL 14: actual Prisma 35 -> 42 and independently verified cleanup', {skip:process.env.OPA_NATIVE_PG_TEST!=='1',timeout:240000},async()=>{
  const name='opa-migration-test-'+Date.now(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-migration-test-'));
  const bin=process.env.OPA_NATIVE_PG_BIN;
  assert(path.isAbsolute(bin));const port=Number(process.env.OPA_NATIVE_PG_PORT);assert(Number.isSafeInteger(port)&&port>20000&&port<65000);
  const local=(name,args,input)=>{const r=cp.spawnSync(path.join(bin,name+'.exe'),args,{input,encoding:'utf8',windowsHide:true,timeout:60000,env:Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','COMSPEC'].includes(k.toUpperCase())))});if(r.status!==0){if(name==='initdb')console.error(JSON.stringify({initdbError:r.error?.code,status:r.status,diagnostic:r.stderr}));throw Error('LOCAL_POSTGRES_'+name.toUpperCase()+'_REJECTED')};return r.stdout};
  const git=args=>cp.execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,...args],{stdio:['ignore','pipe','pipe']});
  const baseline={};
  for(const f of git(['ls-tree','-r','--name-only',C.BASE,'--','apps/api/prisma/migrations']).toString().trim().split('\n'))if(f.endsWith('/migration.sql')){
    const bytes=git(['show',`${C.BASE}:${f}`]);baseline[f.split('/').at(-2)]=C.hash(bytes);fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.writeFileSync(path.join(dir,f),bytes);
  }
  fs.copyFileSync(path.join(root,'apps/api/prisma/schema.prisma'),path.join(dir,'apps/api/prisma/schema.prisma'));
  const schema=path.join(dir,'apps/api/prisma/schema.prisma');let created=false;
  try{
    local('initdb',['-D',path.join(dir,'data'),'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
    local('pg_ctl',['-D',path.join(dir,'data'),'-l',path.join(dir,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','start']);created=true;
    local('createdb',['-h','127.0.0.1','-p',String(port),'-U','postgres',C.DB]);
    const ports=[{HostPort:String(port)}];
    const ADMIN='opa_test_release_admin';let adminReady=false;
    const psql=(bytes,user=adminReady?ADMIN:'postgres')=>local('psql',['--no-psqlrc','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-p',String(port),'-U',user,'-d',C.DB],bytes);
    const deploy=user=>{
      const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,DATABASE_URL:`postgresql://${user}:disposable-only@127.0.0.1:${ports[0].HostPort}/${C.DB}?sslmode=disable`,CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'};
      const r=cp.spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',schema],{env,stdio:'pipe',timeout:60000,windowsHide:true});
      assert.equal(r.status,0,'Disposable Prisma deploy must succeed; child diagnostics intentionally withheld');
    };
    deploy('postgres');
    psql(`CREATE ROLE "${C.RUNTIME}" LOGIN; CREATE ROLE "${C.MIGRATOR}" LOGIN;
      CREATE SCHEMA opa_deployment; CREATE TABLE opa_deployment.environment_identity(singleton boolean PRIMARY KEY CHECK(singleton),environment text NOT NULL);
      INSERT INTO opa_deployment.environment_identity VALUES(true,'production');
      GRANT USAGE ON SCHEMA public,opa_deployment TO "${C.RUNTIME}";
      GRANT SELECT ON opa_deployment.environment_identity,public._prisma_migrations TO "${C.RUNTIME}";
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ${C.BASELINE_TABLES.map(n=>'public."'+n+'"').join(',')} TO "${C.RUNTIME}";
      CREATE ROLE ${ADMIN} LOGIN INHERIT CREATEROLE CREATEDB NOSUPERUSER NOREPLICATION NOBYPASSRLS;
      GRANT USAGE,CREATE ON SCHEMA public TO ${ADMIN};
      ALTER DATABASE "${C.DB}" OWNER TO ${ADMIN};
      ALTER SCHEMA public OWNER TO ${ADMIN};ALTER SCHEMA opa_deployment OWNER TO ${ADMIN};
      ALTER TABLE opa_deployment.environment_identity OWNER TO ${ADMIN};ALTER TABLE public._prisma_migrations OWNER TO ${ADMIN};
      ${C.BASELINE_TABLES.map(n=>`ALTER TABLE public."${n}" OWNER TO ${ADMIN};`).join('\n')}
      ALTER TYPE public."UserRole" OWNER TO ${ADMIN};
      REVOKE SELECT,UPDATE ON public."User",public."Facility" FROM ${ADMIN};`);
    adminReady=true;
    assert.equal(psql('SELECT rolsuper FROM pg_roles WHERE rolname=current_user;').trim(),'f');
    psql(sql()['prepare.sql']);psql(sql()['prepare.sql']);
    psql(`GRANT pg_signal_backend TO ${ADMIN};`,'postgres');
    const {Client}=require(path.join(root,'node_modules/pg')),M=require('./production/maintenance.cjs');
    const maintenanceDB=new Client({host:'127.0.0.1',port,user:ADMIN,database:C.DB});await maintenanceDB.connect();maintenanceDB.on('error',()=>{});
    const competing=new Client({host:'127.0.0.1',port,user:ADMIN,database:C.DB});await competing.connect();
    await M.lock(maintenanceDB);await assert.rejects(M.lock(competing),/ALREADY_RUNNING/);await M.unlock(maintenanceDB);await competing.end();
    const maintenanceManifest={releaseId:'isolated-native-rehearsal',migration:{writersQuiesced:true},maintenance:{mode:'full-maintenance',acceptedOutage:true,noActiveUsersVerified:true,activityEvidenceSHA256:'a'.repeat(64),communicationReference:'synthetic isolated DB; no users',start:new Date(Date.now()-1000).toISOString(),end:new Date(Date.now()+1200000).toISOString()}};
    let maintenanceProof;const saveMaintenance=async r=>{maintenanceProof=structuredClone(r)};
    const heldRuntime=new Client({host:'127.0.0.1',port,user:C.RUNTIME,database:C.DB});await heldRuntime.connect();heldRuntime.on('error',()=>{});
    const snapshot=await M.enter(maintenanceDB,maintenanceManifest,saveMaintenance);await heldRuntime.end().catch(()=>{});
    assert.equal(snapshot.phase,'drained');assert.throws(()=>psql('SELECT 1;',C.RUNTIME));
    await M.verifyFence(maintenanceDB);psql(sql()['activate.sql']);
    const literal=v=>Array.isArray(v)?'ARRAY['+v.map(literal).join(',')+']':"'"+String(v).replaceAll("'","''")+"'";
    const client={query:async(text,params=[])=>{
      const expanded=text.replace(/\$(\d+)/g,(_,n)=>literal(params[Number(n)-1]));
      return {rows:JSON.parse(psql('SELECT COALESCE(json_agg(q),\'[]\'::json) FROM ('+expanded+') q;',C.MIGRATOR).trim())};
    }};
    const sentinel={singleton:true,environment:'production'};
    // jsonb object key order is PostgreSQL's stable order, not JS insertion order.
    const s=await client.query('SELECT to_jsonb(i) AS sentinel FROM opa_deployment.environment_identity i');
    const policy={runner:{databaseAddresses:['127.0.0.1']},sentinelSha256:C.hash(JSON.stringify(s.rows[0].sentinel)),expiresAt:new Date(Date.now()+3600000).toISOString()};
    assert(sentinel.singleton);await I.identity(client,policy);await I.posture(client,true,true);await I.history(client,baseline);await I.preStructure(client);await I.compatibility(client);
    // Demonstrate that the migration identity cannot mutate sentinel or gain DB DDL.
    assert.throws(()=>psql("UPDATE opa_deployment.environment_identity SET environment='staging';",C.MIGRATOR));
    assert.throws(()=>psql('CREATE SCHEMA forbidden;',C.MIGRATOR));
    for(const n of Object.keys(C.FORWARD))fs.cpSync(path.join(root,'apps/api/prisma/migrations',n),path.join(dir,'apps/api/prisma/migrations',n),{recursive:true});
    client.connect=async()=>{};client.end=async()=>{};
    const artifact={manifest:{baseline,candidate:{...baseline,...C.FORWARD},forward:C.FORWARD}},run=require('./production/run.cjs');
    const steps=[],release={sha256:'synthetic-isolated-rehearsal',manifest:{version:1,releaseId:'isolated-native-rehearsal',expiresAt:new Date(Date.now()+3600000).toISOString(),executionTimeoutSeconds:1800}};
    const receipt=await require('./production/cutover.cjs').execute(release,{migrationOnly:true,adapters:{
      enterMaintenance:async()=>{await M.verifyFence(maintenanceDB);return {phase:'drained'}},allowReadOnlyStartup:async()=>M.readOnlyStartup(maintenanceDB,snapshot,saveMaintenance),
      verify:async()=>{await I.history(client,baseline);steps.push('baseline35')},
      recovery:async()=>{assert.equal(psql('SELECT pg_is_in_recovery();').trim(),'f');return {status:'ready',scope:'isolated-only'}},
      activate:async()=>{await I.posture(client,true,true)},
      migrate:async()=>{const r={};await run.executeLifecycle({client,artifact,policy:{...policy,approvedAt:new Date().toISOString(),executionTimeoutSeconds:1800},mode:'execute',receipt:r,save:()=>{},verifyMaintenance:()=>M.verifyFence(maintenanceDB),verifyRecovery:async()=>({status:'ready',scope:'isolated-only'}),invoke:(args,deadline)=>run.cli(root,args,{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,DATABASE_URL:'postgresql://'+C.MIGRATOR+':disposable-only@127.0.0.1:'+port+'/'+C.DB+'?sslmode=disable',CHECKPOINT_DISABLE:'1'},deadline)});assert.equal(r.activeMigrations,42);return r},
      cleanup:async()=>psql(sql()['cleanup.sql']),verifyCleanup:async()=>{await I.posture(client,false,true);steps.push('privileges-restored')},
      publishRuntime:async()=>{steps.push('transport-excluded-runtime-publication')},deploy:async()=>{steps.push('transport-excluded-api-deployment')},health:async()=>{await I.history(client,artifact.manifest.candidate);await I.structure(client)}
    }});
    assert.equal(receipt.status,'migration-phase-complete');assert(steps.includes('privileges-restored'));
    assert.equal(maintenanceProof.phase,'read-only-startup');
    psql('SELECT count(*) FROM public."Incident";',C.RUNTIME);
    assert.throws(()=>psql('DELETE FROM public."Incident" WHERE false;',C.RUNTIME));
    assert.throws(()=>psql('SET default_transaction_read_only=off; DELETE FROM public."Incident" WHERE false;',C.RUNTIME));
        const primaryManifest=path.join(root,'artifacts/launch-unified-release-621f96556892/api-runtime-artifact.manifest.json'),rollbackManifest=process.env.OPA_ROLLBACK_MANIFEST;
    assert(path.isAbsolute(rollbackManifest));
    const smoke=(manifest,restored=false)=>{
      const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','COMSPEC'].includes(k.toUpperCase())));
      const r=cp.spawnSync(process.execPath,[path.join(root,'ops/maintenance-api-smoke.cjs')],{cwd:dir,env,input:JSON.stringify({url:`postgresql://${C.RUNTIME}@127.0.0.1:${port}/${C.DB}?sslmode=disable`,manifest,restored}),encoding:'utf8',timeout:60000,windowsHide:true});
      const lines=r.stdout.split('\n').filter(x=>x.startsWith('{'));const result=lines.length?JSON.parse(lines.at(-1)):{status:'FAIL',code:'NO_SANITIZED_API_RECEIPT'};
      console.log(JSON.stringify({isolatedApiSmoke:result}));assert.equal(r.status,0,'Isolated packaged API must boot under the actual maintenance ACL state');assert.equal(result.status,'PASS');return result;
    };
    smoke(primaryManifest);smoke(rollbackManifest);
    await assert.rejects(M.restore(maintenanceDB,snapshot,{validatedSchema:35,validatedBuild:'local-test',allowedBuilds:['local-test']},saveMaintenance),/VERIFIED_API42/);
    await M.restore(maintenanceDB,snapshot,{validatedSchema:42,validatedBuild:'local-test',allowedBuilds:['local-test']},saveMaintenance);
    psql('DELETE FROM public."Incident" WHERE false;',C.RUNTIME);
    assert.equal(maintenanceProof.phase,'restored');smoke(primaryManifest,true);await maintenanceDB.end();
    console.log(JSON.stringify({isolatedActualPostgres:true,unifiedMigrationLifecycle:'PASS',schema:42,cloudTransport:'EXCLUDED_NOT_ACCEPTED',productionAccess:false}));
    // Original checks below expect active privilege posture before cleanup.
    psql(sql()['activate.sql']);
    await I.history(client,{...baseline,...C.FORWARD});await I.structure(client);await I.identity(client,policy);
    const compare=()=>cp.spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-schema-datasource',schema,'--to-schema-datamodel',schema,'--exit-code'],{
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,DATABASE_URL:`postgresql://${C.MIGRATOR}:disposable-only@127.0.0.1:${ports[0].HostPort}/${C.DB}?sslmode=disable`,CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'},stdio:'pipe',timeout:60000,windowsHide:true});
    const diff=compare();
    if(diff.status===2) {
      // This is a schema-only diff from a synthetic local database. Allow only
      // Prisma's structural summary lines, never URL/error/SQL value output.
      const summary=diff.stdout.toString().split('\n').filter(l=>/^\[(?:\+|-|\*)\] (?:Added|Removed|Changed) [A-Za-z_0-9 `\[\]]+$/.test(l) || /^\s+\[(?:\+|-|\*)\] (?:Added|Removed|Altered) [A-Za-z_0-9 `\[\](),:]+$/.test(l));
      console.log(JSON.stringify({disposableSchemaDifferences:summary}));
    }
    // Actual runtime can use the new sequence and cannot create/alter objects.
    assert.throws(()=>psql('CREATE TABLE public.forbidden(id int);',C.RUNTIME));
    psql(sql()['cleanup.sql']);await I.posture(client,false);await I.history(client,{...baseline,...C.FORWARD});await I.structure(client);
    assert.throws(()=>psql('ALTER TYPE public."UserRole" ADD VALUE \'FORBIDDEN_TEST\';',C.MIGRATOR));
    assert.throws(()=>psql('CREATE TABLE public.forbidden(id int);',C.MIGRATOR));
    // Idempotent cleanup after partial/failure posture, no ledger manipulation.
    psql(sql()['cleanup.sql']);await I.posture(client,false);
    psql(`CREATE ROLE opa_test_unapproved_delegate LOGIN;GRANT "${C.OWNER}" TO opa_test_unapproved_delegate;`);
    await assert.rejects(I.posture(client,false),/ROLE_DELEGATION/);
    assert.throws(()=>psql(sql()['activate.sql']));
    psql(`REVOKE "${C.OWNER}" FROM opa_test_unapproved_delegate;DROP ROLE opa_test_unapproved_delegate;`);
    await I.posture(client,false);
    assert.equal(diff.status,0,'Disposable schema/datamodel must match; secret-bearing child diagnostics withheld');
    assert.equal(compare().status,0,'Idle metadata REFERENCES must support full datamodel verification');
    assert.throws(()=>psql('SELECT * FROM public."User";',C.MIGRATOR));
    // A later reconciliation failure cannot roll back already committed revokes.
    psql(sql()['activate.sql']);psql('ALTER TABLE public."OnboardingAuthorityGrant" OWNER TO postgres;','postgres');
    assert.throws(()=>psql(sql()['cleanup.sql']));
    assert.equal(psql(`SELECT NOT pg_has_role('${C.MIGRATOR}','${C.OWNER}','MEMBER') AND NOT has_schema_privilege('${C.MIGRATOR}','public','CREATE') AND NOT has_table_privilege('${C.MIGRATOR}','public._prisma_migrations','INSERT,UPDATE');`).trim(),'t');
    await assert.rejects(I.posture(client,false),/APPROVED_OBJECT_OWNERS/);
    psql(`BEGIN;GRANT CREATE ON SCHEMA public TO "${C.OWNER}";ALTER TABLE public."OnboardingAuthorityGrant" OWNER TO "${C.OWNER}";REVOKE CREATE ON SCHEMA public FROM "${C.OWNER}";COMMIT;`,'postgres');
    psql(sql()['cleanup.sql']);await I.posture(client,false);
  } finally {
    if(created)local('pg_ctl',['-D',path.join(dir,'data'),'-m','fast','-w','stop']);
    // This path was allocated by mkdtemp, never a repository or user directory.
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});
  }
});
