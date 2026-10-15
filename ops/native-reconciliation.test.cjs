"use strict";
// Opt-in test: cached PostgreSQL 14 only, loopback ephemeral port, tmpfs data,
// synthetic credentials, no cloud endpoints, no production connection inputs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const C=require('./production/contract.cjs'),I=require('./production/inspect.cjs'),{sql}=require('./production/admin-sql.cjs');
const root=path.resolve(__dirname,'..');
test('Isolated schema35: existing incident cancellation ends test journey and preserves location evidence', {skip:process.env.OPA_NATIVE_PG_TEST!=='1',timeout:240000},async()=>{
  const name='opa-migration-test-'+Date.now(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-migration-test-'));
  const bin=process.env.OPA_NATIVE_PG_BIN;
  assert(path.isAbsolute(bin));const port=Number(process.env.OPA_NATIVE_PG_PORT);assert(Number.isSafeInteger(port)&&port>20000&&port<65000);
  const local=(name,args,input)=>{const r=cp.spawnSync(path.join(bin,name+'.exe'),args,{input,encoding:'utf8',windowsHide:true,timeout:60000,env:Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','COMSPEC'].includes(k.toUpperCase())))});if(r.status!==0){if(name==='psql')console.error(JSON.stringify({localSQLState:(r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)||[])[1]}));if(name==='initdb')console.error(JSON.stringify({initdbError:r.error?.code,status:r.status,diagnostic:r.stderr}));throw Error('LOCAL_POSTGRES_'+name.toUpperCase()+'_REJECTED')};return r.stdout};
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
      GRANT SELECT,UPDATE ON public."User",public."Facility" TO ${ADMIN};`);
    adminReady=true;
    assert.equal(psql('SELECT rolsuper FROM pg_roles WHERE rolname=current_user;').trim(),'f');
    const {PrismaClient}=require(path.join(root,'node_modules/@prisma/client'));
    const db=new PrismaClient({datasources:{db:{url:`postgresql://${ADMIN}@127.0.0.1:${port}/${C.DB}?sslmode=disable`}},log:[]});
    const owner='a9e2fc5e-a935-45af-8bfc-e525fcd67b83',incident='5163fd54-a4b9-4932-b69f-d3c6b92990d9',session='be53a398-95d8-4afa-b630-3faa4bd40664';
    psql(`INSERT INTO public."User" (id,email,"phoneNumber","firstName","lastName",role,"isActive","accountStatus","credentialVersion","createdAt","updatedAt") VALUES ('${owner}','synthetic@example.invalid','+10000000000','Synthetic','Fixture','USER',true,'ACTIVE',0,now(),now());
    INSERT INTO public."JourneySession" (id,"userId",purpose,status,"startedAt","createdAt","updatedAt") VALUES ('${session}','${owner}','INCIDENT','ACTIVE',now(),now(),now());
    INSERT INTO public."Incident" (id,"userId",trigger,status,"createdAt","updatedAt","lastTriggeredAt","journeySessionId","retriggerCount") VALUES ('${incident}','${owner}','SOS_BUTTON','OPEN',now(),now(),now(),'${session}',0);`,'postgres');
    const base=path.join(root,'apps/api/dist/modules'),{IncidentsService}=require(path.join(base,'incidents/incidents.service.js')),{IncidentTimelineService}=require(path.join(base,'incident-timeline/incident-timeline.service.js')),{IncidentAccessTokenService}=require(path.join(base,'incident-access/incident-access-token.service.js')),{JourneySessionService}=require(path.join(base,'journey/journey-session.service.js'));
    const timeline=new IncidentTimelineService(db),journey=new JourneySessionService(),service=new IncidentsService(db,new IncidentAccessTokenService(db),timeline,journey);
    try{
      await db.$transaction(tx=>journey.insertFixes(tx,session,[{idempotencyKey:'synthetic-reconciliation-proof',source:'manual',latitude:'0',longitude:'0',recordedAt:new Date()}]));
      await timeline.recordEvent({incidentId:incident,type:'INCIDENT_CREATED',source:'ISOLATED_TEST',actorUserId:owner,payload:{synthetic:true}});
      const before=await db.$queryRawUnsafe('SELECT id::text,hash,"previousHash","payloadHash",sequence FROM public."JourneyLocationFix" ORDER BY id');
      const result=await service.cancel(incident,owner,{reason:'FOUNDER_CONFIRMED_TEST_RECONCILIATION_ISOLATED_PROOF'});
      assert.equal(result.status,'CANCELLED');assert.equal(result.endedJourneySessionId,session);
      const after=await db.$queryRawUnsafe('SELECT id::text,hash,"previousHash","payloadHash",sequence FROM public."JourneyLocationFix" ORDER BY id');assert.deepEqual(after,before);
      const state=await db.$queryRawUnsafe(`SELECT status::text,"endedReason"::text FROM public."JourneySession" WHERE id='${session}'::uuid`);assert.equal(state[0].status,'ENDED');
      const events=await db.$queryRawUnsafe(`SELECT type FROM public."IncidentTimelineEvent" WHERE "incidentId"='${incident}'::uuid ORDER BY sequence`);assert.equal(events.at(-1).type,'INCIDENT_CANCELLED');
      console.log(JSON.stringify({isolatedSchema35:true,existingIncidentCancelWorkflow:'PASS',linkedJourneyEnded:true,historicalLocationUnchanged:true,dispatch:false,productionAccess:false}));
    }finally{await db.$disconnect()}
  } finally {
    if(created)local('pg_ctl',['-D',path.join(dir,'data'),'-m','fast','-w','stop']);
    // This path was allocated by mkdtemp, never a repository or user directory.
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});
  }
});
