'use strict';
const C=require('./contract.cjs'),identity=require('./app-service-identity.cjs');
const {requireThat:R}=C;
// Azure Backup REST 2024-08-01: automatic/on-demand backups list by server.
// https://learn.microsoft.com/rest/api/postgresql/backups-automatic-and-on-demand/list-by-server
function evaluate(policy,server,list,now=Date.now()) {
  const config=policy.recovery ?? {minimumRetentionDays:7,recoveryLagSeconds:600};
  C.onlyKeys(config,['minimumRetentionDays','recoveryLagSeconds'],'RECOVERY_FIELDS');
  R(Number.isSafeInteger(config.minimumRetentionDays)&&config.minimumRetentionDays>=7&&config.minimumRetentionDays<=35&&
    Number.isSafeInteger(config.recoveryLagSeconds)&&config.recoveryLagSeconds>=300&&config.recoveryLagSeconds<=86400,'RECOVERY_BOUND');
  const p=server.properties,earliest=Date.parse(p?.backup?.earliestRestoreDate),point=now-config.recoveryLagSeconds*1000;
  R(server.id?.toLowerCase()===policy.resources.database.id.toLowerCase()&&p?.state==='Ready'&&p?.network?.publicNetworkAccess==='Disabled'&&
    p.backup.backupRetentionDays>=config.minimumRetentionDays&&Number.isFinite(earliest)&&earliest<=point,'RECOVERY_SERVER');
  R(Array.isArray(list.value)&&!list.nextLink,'RECOVERY_BACKUP_INVENTORY');
  const eligible=list.value.filter(b=>b.id?.toLowerCase().startsWith(server.id.toLowerCase()+'/backups/')&&
    Number.isFinite(Date.parse(b.properties?.completedTime))&&Date.parse(b.properties.completedTime)<=point&&Date.parse(b.properties.completedTime)>=earliest);
  R(eligible.length>0,'RECOVERY_BACKUP_UNAVAILABLE');
  eligible.sort((a,b)=>Date.parse(b.properties.completedTime)-Date.parse(a.properties.completedTime));
  return {status:'ready',checkedAt:new Date(now).toISOString(),serverId:server.id,restorePoint:new Date(point).toISOString(),
    earliestRestoreDate:new Date(earliest).toISOString(),backupId:eligible[0].id,backupCompletedAt:eligible[0].properties.completedTime,
    verification:'live-Azure-backup-and-PITR-metadata',evidenceSha256:C.hash(JSON.stringify({server,list}))};
}
async function verify(policy,{env=process.env,request=fetch,now=Date.now,verifyIdentity=identity.verifyAppIdentity}={}) {
  R(policy.runner.kind==='azure-app-service','RECOVERY_EXECUTION_HOST');
  await verifyIdentity(policy,env);
  const get=async(url,headers)=>{const r=await request(url,{headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});R(r.ok,'RECOVERY_SOURCE_UNAVAILABLE');return r.json()};
  const token=await get(identity.endpoint(env.IDENTITY_ENDPOINT),{'X-IDENTITY-HEADER':env.IDENTITY_HEADER});
  R(typeof token.access_token==='string'&&token.access_token.length>0,'RECOVERY_IDENTITY');
  const headers={Authorization:'Bearer '+token.access_token};
  try {
    const base='https://management.azure.com'+policy.resources.database.id;
    const server=await get(base+'?api-version=2024-08-01',headers);
    const list=await get(base+'/backups?api-version=2024-08-01',headers);
    return evaluate(policy,server,list,now());
  } finally {token.access_token=undefined;}
}
module.exports={evaluate,verify};
