"use strict";
// Opt-in test: cached PostgreSQL 14 only, loopback ephemeral port, tmpfs data,
// synthetic credentials, no cloud endpoints, no production connection inputs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const C=require('./contract.cjs'),I=require('./inspect.cjs'),{sql}=require('./admin-sql.cjs');
const root=path.resolve(__dirname,'../..');
test('PostgreSQL 14: actual Prisma 35 -> 42, scoped ownership and independently verified cleanup', {skip:process.env.OPA_DISPOSABLE_PG_TEST!=='1',timeout:240000},async()=>{
  const name='opa-migration-test-'+Date.now(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'opa-migration-test-'));
  const docker=(args,input)=>{
    const r=cp.spawnSync('docker',['--config',path.join(dir,'docker-config'),...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,windowsHide:true});
    if(r.error || r.status!==0)throw Error('DISPOSABLE_DOCKER_FAILED_'+(r.stderr?.match(/ERROR:\s+([A-Z0-9]{5})(?:\s|$)/)?.[1] || 'UNKNOWN'));return r.stdout;
  };
  const git=args=>cp.execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,...args],{stdio:['ignore','pipe','pipe']});
  const baseline={};
  for(const f of git(['ls-tree','-r','--name-only',C.BASE,'--','apps/api/prisma/migrations']).toString().trim().split('\n'))if(f.endsWith('/migration.sql')){
    const bytes=git(['show',`${C.BASE}:${f}`]);baseline[f.split('/').at(-2)]=C.hash(bytes);fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.writeFileSync(path.join(dir,f),bytes);
  }
  fs.copyFileSync(path.join(root,'apps/api/prisma/schema.prisma'),path.join(dir,'apps/api/prisma/schema.prisma'));
  const schema=path.join(dir,'apps/api/prisma/schema.prisma');let created=false;
  try{
    docker(['run','-d','--pull','never','--name',name,'--network','bridge','-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e',`POSTGRES_DB=${C.DB}`,'postgres:14']);created=true;
    const info=JSON.parse(docker(['inspect',name]))[0],ports=info.NetworkSettings.Ports['5432/tcp'];
    assert.equal(ports.length,1);assert.equal(ports[0].HostIp,'127.0.0.1');assert(!info.Mounts.some(m=>m.Type==='bind'));
    for(let i=0;i<50;i++){
      const ready=cp.spawnSync('docker',['--config',path.join(dir,'docker-config'),'exec',name,'pg_isready','-U','postgres'],{stdio:'pipe'});
      if(ready.status===0)break;await new Promise(r=>setTimeout(r,200));if(i===49)throw Error('DISPOSABLE_START_TIMEOUT');
    }
    const ADMIN='opa_test_release_admin';let adminReady=false;
    const psql=(bytes,user=adminReady?ADMIN:'postgres')=>docker(['exec','-i',name,'psql','--no-psqlrc','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-U',user,'-d',C.DB],bytes);
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
      GRANT SELECT,INSERT,UPDATE,DELETE ON ${C.EXISTING_TABLES.map(n=>'public."'+n+'"').join(',')} TO "${C.RUNTIME}";
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
    psql(sql()['prepare.sql']);psql(sql()['activate.sql']);
    const literal=v=>Array.isArray(v)?'ARRAY['+v.map(literal).join(',')+']':"'"+String(v).replaceAll("'","''")+"'";
    const client={query:async(text,params=[])=>{
      const expanded=text.replace(/\$(\d+)/g,(_,n)=>literal(params[Number(n)-1]));
      return {rows:JSON.parse(psql('SELECT COALESCE(json_agg(q),\'[]\'::json) FROM ('+expanded+') q;',C.MIGRATOR).trim())};
    }};
    const sentinel={singleton:true,environment:'production'};
    // jsonb object key order is PostgreSQL's stable order, not JS insertion order.
    const s=await client.query('SELECT to_jsonb(i) AS sentinel FROM opa_deployment.environment_identity i');
    const policy={runner:{databaseAddresses:['127.0.0.1']},sentinelSha256:C.hash(JSON.stringify(s.rows[0].sentinel)),expiresAt:new Date(Date.now()+3600000).toISOString()};
    assert(sentinel.singleton);await I.identity(client,policy);await I.posture(client,true);await I.history(client,baseline);await I.preStructure(client);await I.compatibility(client);
    // Demonstrate that the migration identity cannot mutate sentinel or gain DB DDL.
    assert.throws(()=>psql("UPDATE opa_deployment.environment_identity SET environment='staging';",C.MIGRATOR));
    assert.throws(()=>psql('CREATE SCHEMA forbidden;',C.MIGRATOR));
    for(const n of Object.keys(C.FORWARD))fs.cpSync(path.join(root,'apps/api/prisma/migrations',n),path.join(dir,'apps/api/prisma/migrations',n),{recursive:true});
    deploy(C.MIGRATOR);
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
    if(created)docker(['rm','--force',name]);
    // This path was allocated by mkdtemp, never a repository or user directory.
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});
  }
});
