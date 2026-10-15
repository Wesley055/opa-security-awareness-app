'use strict';
const fs=require('node:fs'),path=require('node:path');
const C=require('./contract.cjs'),run=require('./run.cjs'),I=require('./inspect.cjs'),admin=require('./admin-sql.cjs');
const runtime=require('../../packages/environment-policy/runtime.cjs'),keys=require('../../packages/environment-policy/trusted-signers.json');
const {requireThat:R}=C;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function create(env) {
  let artifact,root,migrationEnv,primary,fallback,custody,settings,timeoutsApplied=false,maintenanceClient,maintenanceSnapshot,maintenanceFile,maintenanceFd;
  const maintenance=require('./maintenance.cjs');
  const saveMaintenance=async value=>{const history=maintenanceFile+'.'+value.phase+'.json',bytes=JSON.stringify(value,null,2),fd=fs.openSync(history,'wx',0o600);try{fs.writeSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}const next=history+'.next';fs.copyFileSync(history,next,fs.constants.COPYFILE_EXCL);fs.renameSync(next,maintenanceFile)};
  const emergency=require('./emergency-writers.cjs');
  const timeoutSQL=mode=>{const bytes=fs.readFileSync(path.join(__dirname,'bounded-'+mode+'.sql'));R(C.hash(bytes)===(mode==='apply'?emergency.APPLY:emergency.RESTORE),'RELEASE_TIMEOUT_SQL_HASH');return bytes.toString('utf8')};
  const request=async(url,options={},deadline=Date.now()+30000)=>{
    const remaining=deadline-Date.now();R(remaining>0,'CUTOVER_DEADLINE');
    return fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(600000,remaining)))});
  };
  const arm=async(release,suffix,method='GET',body,deadline)=>{
    R(env.OPA_RELEASE_ARM_TOKEN,'RELEASE_ARM_CREDENTIAL');
    const r=await request('https://management.azure.com'+release.manifest.appResourceId+suffix,{method,headers:{Authorization:'Bearer '+env.OPA_RELEASE_ARM_TOKEN,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},deadline);
    R(r.ok,'RELEASE_ARM_REJECTED');return r.status===204?{}:r.json();
  };
  const scmOrigin=release=>{
    const u=new URL(release.manifest.scmOrigin);
    R(u.protocol==='https:'&&u.origin===release.manifest.scmOrigin&&/^opa-api-production(?:-[a-z0-9]+)?\.scm(?:\.southafricanorth-01)?\.azurewebsites\.net$/.test(u.hostname),'RELEASE_SCM_RESOURCE');
    R(env.OPA_RELEASE_SCM_AUTHORIZATION,'RELEASE_SCM_CREDENTIAL');return u.origin;
  };
  const sql=async(text)=>{
    const url=new URL(env.OPA_RELEASE_ADMIN_DATABASE_URL);
    R(url.hostname===C.HOST&&Number(url.port||5432)===5432&&decodeURIComponent(url.pathname.slice(1))===C.DB&&
      ![C.RUNTIME,C.MIGRATOR,C.OWNER].includes(decodeURIComponent(url.username))&&url.searchParams.get('sslmode')==='require'&&url.searchParams.get('sslaccept')==='strict','RELEASE_ADMIN_IDENTITY');
    const {Client}=require(path.join(root,'node_modules/pg')),client=new Client(run.connectOptions(url.toString()));
    try{await client.connect();await client.query(text.replace(/^\\set[^\r\n]*$/gm,''))}
    finally{await client.end()}
  };
  function prepareDeployment(release) {
    custody=JSON.parse(fs.readFileSync(release.files.custody));
    primary=JSON.parse(fs.readFileSync(release.files.runtimeAuthorization));fallback=JSON.parse(fs.readFileSync(release.files.rollbackAuthorization));
    const approved=runtime.authenticate(primary,custody,fs.readFileSync(release.files.apiManifest),keys,Date.now()).policy;
    const rollback=runtime.authenticate(fallback,custody,fs.readFileSync(release.files.rollbackManifest),keys,Date.now()).policy;
    R(approved.resources.app.id===release.manifest.appResourceId&&rollback.resources.app.id===release.manifest.appResourceId,'RELEASE_RUNTIME_RESOURCE_BINDING');

    return {approved,rollback};
  }
  return {
    prepareDeployment,
    async verify(release) {
      for(const name of ['OPA_RELEASE_ARM_TOKEN','OPA_RELEASE_VAULT_TOKEN','OPA_RELEASE_SCM_AUTHORIZATION','OPA_RELEASE_ADMIN_DATABASE_URL','OPA_RELEASE_MIGRATION_DATABASE_URL'])R(typeof env[name]==='string'&&env[name].length>0,'RELEASE_EXECUTION_CREDENTIALS');
      scmOrigin(release);
      root=require('./migration-archive.cjs').extract(release.files.migrationArtifact,require('node:os').tmpdir()).root;artifact=run.verifyArtifact(root);
      R(artifact.manifestSha256===release.manifest.migrationManifestSHA256,'RELEASE_MIGRATION_ARTIFACT');
      migrationEnv=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP','HOME','USERPROFILE','IDENTITY_ENDPOINT','IDENTITY_HEADER'].map(k=>[k,env[k]]));
      Object.assign(migrationEnv,{DATABASE_URL:env.OPA_RELEASE_MIGRATION_DATABASE_URL,OPA_ENVIRONMENT:'production',NODE_ENV:'production',OPA_BUILD_SHA:release.manifest.migration.build,OPA_DEPLOYMENT_RESOURCE_ID:release.manifest.appResourceId,
        OPA_MIGRATION_CONFIRMATION:'MIGRATE_OPA_PRODUCTION:'+release.manifest.migration.build+':'+release.manifest.migration.artifactSha256+':'+release.manifest.releaseId});
      run.policyInputs(root,artifact,migrationEnv,fs.readFileSync(release.files.backup),'execute',()=>release.manifest.migration);
      const {approved,rollback}=prepareDeployment(release);
      const boundary=require('../../packages/environment-policy/index.cjs');
      boundary.validateApi({...env,OPA_BUILD_SHA:approved.build},approved);
      boundary.validateApi({...env,OPA_BUILD_SHA:rollback.build},rollback);
      await run.runner(release.manifest.migration);
      return {migrationArtifactSHA256:artifact.manifestSha256,sqlHashes:C.FORWARD};
    },
    recovery:release=>require('./recovery-readiness.cjs').verify(release.manifest.migration,{env}),
    async enterMaintenance(release) {
      maintenance.acceptance(release.manifest);
      // Global existing-home custody survives a release container restart.
      const marker=path.resolve(release.directory,'..','maintenance.lock');
      const markerFd=fs.openSync(marker,'wx',0o600);fs.writeSync(markerFd,JSON.stringify({releaseId:release.manifest.releaseId,manifestSHA256:release.sha256}));fs.fsyncSync(markerFd);fs.closeSync(markerFd);
      maintenanceFile=path.resolve(release.directory,release.manifest.releaseId+'.maintenance.json');
      maintenanceFd=fs.openSync(maintenanceFile,'wx',0o600);
      const {Client}=require(path.join(root,'node_modules/pg'));maintenanceClient=new Client(run.connectOptions(env.OPA_RELEASE_ADMIN_DATABASE_URL));await maintenanceClient.connect();
      maintenanceSnapshot=await maintenance.enter(maintenanceClient,release.manifest,saveMaintenance);
      return {phase:maintenanceSnapshot.phase,activity:maintenanceSnapshot.activity};
    },
    async allowReadOnlyStartup() {
      maintenanceSnapshot=await maintenance.readOnlyStartup(maintenanceClient,maintenanceSnapshot,saveMaintenance);
      await maintenance.unlock(maintenanceClient);await maintenanceClient.end();fs.closeSync(maintenanceFd);maintenanceFd=undefined;
      return {phase:maintenanceSnapshot.phase,snapshotSHA256:C.hash(fs.readFileSync(maintenanceFile))};
    },
    async activate(release) {
      const scripts=admin.sql();await sql(scripts['prepare.sql']);
      if(release.manifest.migration.emergencyWriterException){await sql(timeoutSQL('apply'));timeoutsApplied=true}
      await sql(scripts['activate.sql']);
    },
    async migrate(release,checkpoint=()=>{}) {
      const {Client}=require(path.join(root,'node_modules/pg')),receipt={cleanupRequired:true};
      await run.executeLifecycle({client:new Client(run.connectOptions(migrationEnv.DATABASE_URL)),artifact,policy:release.manifest.migration,mode:'execute',receipt,
        save:()=>checkpoint({...receipt}),verifyMaintenance:()=>maintenance.verifyFence(maintenanceClient,[C.MIGRATOR]),verifyRecovery:()=>require('./recovery-readiness.cjs').verify(release.manifest.migration,{env}),
        invoke:(args,deadline)=>run.cli(root,args,migrationEnv,deadline)});
      return receipt;
    },
    async cleanup() {
      try{await sql(admin.sql()['cleanup.sql'])}
      finally{if(timeoutsApplied){await sql(timeoutSQL('restore'));timeoutsApplied=false}}
    },
    async verifyCleanup(release) {
      const {Client}=require(path.join(root,'node_modules/pg')),client=new Client(run.connectOptions(migrationEnv.DATABASE_URL));
      try{await client.connect();await I.identity(client,release.manifest.migration);await I.posture(client,false,true);if(release.manifest.migration.emergencyWriterException)await emergency.verifyRestoredTimeouts(client)}
      finally{await client.end()}
      return {privilegesRevoked:true};
    },
    async publishRuntime(release,rollback,deadline) {
      const auth=rollback?fallback:primary,decoded=JSON.parse(Buffer.from(auth.payload,'base64')),origin=decoded.policy.resources.vault.secretOrigin;
      R(/^https:\/\/[a-zA-Z0-9-]+\.vault\.azure\.net$/.test(origin)&&env.OPA_RELEASE_VAULT_TOKEN,'RELEASE_CUSTODY_CREDENTIAL');
      const url=origin+'/secrets/opa-api-runtime-custody?api-version=7.4',headers={Authorization:'Bearer '+env.OPA_RELEASE_VAULT_TOKEN,'Content-Type':'application/json'};
      const existing=await request(url,{headers},deadline);
      if(existing.ok) {
        const old=JSON.parse((await existing.json()).value);
        const prev=runtime.signed(old,keys,'runtime-custody',Date.now()).p,next=runtime.signed(custody,keys,'runtime-custody',Date.now()).p;
        R(next.sequence>=prev.sequence&&prev.revokedAuthorizationIds.every(id=>next.revokedAuthorizationIds.includes(id))&&prev.revokedAuthorityFingerprints.every(id=>next.revokedAuthorityFingerprints.includes(id)),'RELEASE_CUSTODY_ROLLBACK');
        R(next.sequence!==prev.sequence||C.hash(Buffer.from(old.payload,'base64'))===C.hash(Buffer.from(custody.payload,'base64')),'RELEASE_CUSTODY_SEQUENCE_CONFLICT');
      } else R(existing.status===404&&release.manifest.initializeCustody===true,'RELEASE_CURRENT_CUSTODY_REQUIRED');
      const put=await request(url,{method:'PUT',headers,body:JSON.stringify({value:JSON.stringify(custody)})},deadline);R(put.ok,'RELEASE_CUSTODY_PUBLICATION');
      const scm=scmOrigin(release),authorization=env.OPA_RELEASE_SCM_AUTHORIZATION;
      const directory=await request(scm+'/api/vfs/home/opa-runtime-custody/',{method:'PUT',headers:{Authorization:authorization,'If-Match':'*'}},deadline);
      R(directory.ok||directory.status===409,'RELEASE_RUNTIME_DIRECTORY');
      for(const [file,source] of [['artifact.manifest.json',rollback?release.files.rollbackManifest:release.files.apiManifest],['runtime-api.signed.json',rollback?release.files.rollbackAuthorization:release.files.runtimeAuthorization]]) {
        const r=await request(scm+'/api/vfs/home/opa-runtime-custody/'+file,{method:'PUT',headers:{Authorization:authorization,'If-Match':'*','Content-Type':'application/octet-stream'},body:fs.readFileSync(source)},deadline);
        R(r.ok,'RELEASE_RUNTIME_TRANSFER');
      }
    },
    async deploy(release,rollback,deadline) {
      const auth=JSON.parse(Buffer.from((rollback?fallback:primary).payload,'base64'));
      settings ??= await arm(release,'/config/appsettings/list?api-version=2023-12-01','POST',undefined,deadline);
      const properties={...settings.properties,OPA_BUILD_SHA:auth.policy.build,OPA_ENVIRONMENT_POLICY_FILE:'/home/opa-runtime-custody/runtime-api.signed.json',WEBSITE_RUN_FROM_PACKAGE:'1'};
      await arm(release,'/config/appsettings?api-version=2023-12-01','PUT',{properties},deadline);
      const origin=scmOrigin(release),headers={Authorization:env.OPA_RELEASE_SCM_AUTHORIZATION};
      const response=await request(origin+'/api/zipdeploy?isAsync=true',{method:'POST',headers:{...headers,'Content-Type':'application/zip'},body:fs.readFileSync(rollback?release.files.rollbackApi:release.files.api)},deadline);
      R(response.status===202,'RELEASE_DEPLOYMENT_REJECTED');
      const status=new URL(response.headers.get('location'),origin);
      R(status.origin===origin&&status.pathname.startsWith('/api/deployments/'),'RELEASE_DEPLOYMENT_STATUS');
      while(Date.now()<deadline) {
        await sleep(3000);const r=await request(status,{headers},deadline);R(r.ok,'RELEASE_DEPLOYMENT_STATUS');
        const result=await r.json();if(result.status===4)return {deploymentId:result.id};R(result.status!==3,'RELEASE_DEPLOYMENT_FAILED');
      }
      throw Error('RELEASE_DEPLOYMENT_TIMEOUT');
    },
    async health(release,rollback,deadline) {
      const auth=JSON.parse(Buffer.from((rollback?fallback:primary).payload,'base64')),origin=auth.policy.resources.app.origin;
      R(/^https:\/\/opa-api-production(?:-[a-z0-9]+)?(?:\.southafricanorth-01)?\.azurewebsites\.net$/.test(origin),'RELEASE_HEALTH_RESOURCE');
      while(Date.now()<deadline) {
        try {
          const responses=await Promise.all(['/health','/health/ready','/health/environment'].map(p=>request(origin+p,{},Math.min(deadline,Date.now()+10000))));
          if(responses.every(r=>r.ok)) {const diag=await responses[2].json();if(diag.build===auth.policy.build&&diag.migrationReadiness==='ready')return {build:diag.build,health:200,readiness:200}}
        } catch { /* only the approved deployment deadline bounds retries */ }
        await sleep(3000);
      }
      throw Error('RELEASE_HEALTH_TIMEOUT');
    }
  };
}
module.exports={create};
