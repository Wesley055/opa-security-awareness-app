'use strict';
// Offline contract and command generator. No Azure/SQL/credential execution.
const fs=require('node:fs'),crypto=require('node:crypto');
const SUB='b79ffdb2-0cf1-4915-89b4-2b6b7cae0299',RG='opa-production',REGION='southafricanorth';
const ROOT=`/subscriptions/${SUB}/resourceGroups/${RG}/providers/`;
const VNET=ROOT+'Microsoft.Network/virtualNetworks/opa-api-productionVnet';
const SUBNET=VNET+'/subnets/opa-api-productionSubnet';
const DB=ROOT+'Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server';
const DNS=ROOT+'Microsoft.Network/privateDnsZones/privatelink.postgres.database.azure.com';
const roles={secret:'4633458b-17de-408a-b874-0445c86b69e6',blob:'2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'};
const R=(v,c)=>{if(!v)throw Error(c);};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ip=x=>typeof x==='string'&&/^10\.0\.\d{1,3}\.\d{1,3}$/.test(x)&&x.split('.').every(n=>Number(n)<=255);
const keys=(x,k)=>R(x&&Object.keys(x).sort().join()===k.sort().join(),'FIELDS');
function plan(p,now=Date.now()){
 keys(p,['version','job','createdAt','expiresAt','cleanupOwner','approvalId','imageId','imageSha256','artifactSha256','publicKey','databaseAddresses','vaultAddress','blobAddress','secretScope','containerScope','scriptUri','controlEgressApproved']);
 R(p.version===1&&/^[a-z0-9]{8,24}$/.test(p.job),'JOB');
 R(/^[A-Za-z0-9_.@-]{1,100}$/.test(p.cleanupOwner)&&/^[A-Za-z0-9_-]{1,80}$/.test(p.approvalId),'OWNER');
 const start=Date.parse(p.createdAt),end=Date.parse(p.expiresAt);
 R(start<=now&&now-start<900000&&end>now&&end-start<=3600000,'LEASE');
 R(/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[A-Za-z0-9_-]+\/providers\/Microsoft.Compute\/galleries\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9_-]+\/versions\/\d+\.\d+\.\d+$/.test(p.imageId),'IMAGE_PIN');
 R([p.imageSha256,p.artifactSha256].every(x=>/^[a-f0-9]{64}$/.test(x)),'HASH');
 R(/^ssh-ed25519 [A-Za-z0-9+/=]{40,100}$/.test(p.publicKey),'PUBLIC_KEY_ONLY');
 R(Array.isArray(p.databaseAddresses)&&p.databaseAddresses.length>0&&p.databaseAddresses.length<=8&&p.databaseAddresses.every(ip)&&new Set(p.databaseAddresses).size===p.databaseAddresses.length,'DB_IP');
 R(ip(p.vaultAddress)&&ip(p.blobAddress),'ENDPOINT_IP');
 R(p.secretScope.startsWith(ROOT+'Microsoft.KeyVault/vaults/')&&/^\w[\w-]*\/secrets\/[\w-]+$/.test(p.secretScope.slice((ROOT+'Microsoft.KeyVault/vaults/').length)),'SECRET_SCOPE');
 R(p.containerScope.startsWith(ROOT+'Microsoft.Storage/storageAccounts/')&&/^[a-z0-9]+\/blobServices\/default\/containers\/[a-z0-9-]+$/.test(p.containerScope.slice((ROOT+'Microsoft.Storage/storageAccounts/').length)),'BLOB_SCOPE');
 const account=p.containerScope.split('/')[8],container=p.containerScope.split('/').at(-1);
 R(p.scriptUri===`https://${account}.blob.core.windows.net/${container}/bootstrap-${p.artifactSha256}.sh`,'SCRIPT_URI');
 R(p.controlEgressApproved===true,'CONTROL_EGRESS_APPROVAL');
 return {vm:'opa-mig-'+p.job,nic:'opa-mig-'+p.job+'-nic',nsg:'opa-mig-'+p.job+'-nsg',identity:'opa-mig-'+p.job+'-id',disk:'opa-mig-'+p.job+'-os',tags:{opaMigrationJob:p.job,expiresAt:p.expiresAt,cleanupOwner:p.cleanupOwner,approvalId:p.approvalId,planSha256:hash(p)}};
}
function rules(p){
 const allow=(name,priority,protocol,destinationAddressPrefix,destinationPortRange)=>({name,priority,direction:'Outbound',access:'Allow',protocol,sourceAddressPrefix:'*',sourcePortRange:'*',destinationAddressPrefix,destinationPortRange});
 return [
 {name:'deny-inbound',priority:100,direction:'Inbound',access:'Deny',protocol:'*',sourceAddressPrefix:'*',sourcePortRange:'*',destinationAddressPrefix:'*',destinationPortRange:'*'},
 ...p.databaseAddresses.map((a,i)=>allow('postgres-'+i,100+i,'Tcp',a,'5432')),
 allow('vault',120,'Tcp',p.vaultAddress,'443'),allow('artifact',121,'Tcp',p.blobAddress,'443'),
 allow('dns-udp',130,'Udp','AzurePlatformDNS','53'),allow('dns-tcp',131,'Tcp','AzurePlatformDNS','53'),
 allow('agent-http',140,'Tcp','168.63.129.16','80'),allow('agent-wire',141,'Tcp','168.63.129.16','32526'),
 allow('imds',142,'Tcp','169.254.169.254','80'),
 // AzureCloud is IP ranges, NOT FQDN filtering. Explicitly approved residual scope.
 allow('azure-control',150,'Tcp','AzureCloud','443'),
 {name:'deny-outbound',priority:4000,direction:'Outbound',access:'Deny',protocol:'*',sourceAddressPrefix:'*',sourcePortRange:'*',destinationAddressPrefix:'*',destinationPortRange:'*'}];
}
function base(s,p,phase='pre',now=Date.now()){
 const n=plan(p,now);
 R(s.subscription===SUB&&s.group?.id===`/subscriptions/${SUB}/resourceGroups/${RG}`&&s.group.location===REGION,'AZURE_TARGET');
 R(Date.parse(s.observedAt)<=now&&now-Date.parse(s.observedAt)<300000,'INVENTORY_STALE');
 R(s.vnet.id===VNET&&s.vnet.location===REGION&&JSON.stringify(s.vnet.addressSpace.addressPrefixes)===JSON.stringify(['10.0.0.0/16'])&&!(s.vnet.dhcpOptions?.dnsServers?.length),'VNET');
 R(s.subnet.id===SUBNET&&s.subnet.addressPrefix==='10.0.0.0/24'&&!(s.subnet.delegations?.length)&&!s.subnet.networkSecurityGroup&&!s.subnet.routeTable&&!s.subnet.natGateway,'SUBNET');
 R(!(s.subnet.serviceAssociationLinks?.length)&&!(s.subnet.resourceNavigationLinks?.length),'SUBNET_LINKS');
 const expectedNic=ROOT+'Microsoft.Network/networkInterfaces/'+n.nic;
 const occupancy=(s.nics||[]).filter(x=>(x.ipConfigurations||[]).some(c=>c.subnet?.id===SUBNET));
 R(occupancy.every(x=>phase!=='pre'&&x.id===expectedNic)&&!(s.subnet.privateEndpoints?.length),'OCCUPANCY');
 const refs=s.subnet.ipConfigurations||[];
 R(refs.every(x=>phase!=='pre'&&x.id.startsWith(expectedNic+'/ipConfigurations/')),'OCCUPANCY_REFERENCE');
 R(s.database.id===DB&&s.database.location===REGION&&s.database.version==='14'&&s.database.network.publicNetworkAccess==='Disabled'&&s.database.network.delegatedSubnetResourceId===VNET+'/subnets/opa-api-productionDbSubnet'&&s.database.network.privateDnsZoneArmResourceId===DNS,'DATABASE');
 R(s.dns.id===DNS&&s.links.some(x=>x.virtualNetwork.id===VNET&&x.virtualNetworkLinkState==='Completed'&&x.registrationEnabled===false),'DNS');
 R(s.records.some(x=>x.name==='opa-api-production-server'&&JSON.stringify(x.aRecords.map(a=>a.ipv4Address).sort())===JSON.stringify([...p.databaseAddresses].sort())),'DNS_RECORD');
 for(const [kind,address,resource] of [['vault',p.vaultAddress,p.secretScope.split('/secrets/')[0]],['blob',p.blobAddress,p.containerScope.split('/blobServices/')[0]]] ){
  R(s.endpoints.some(e=>e.privateLinkServiceId===resource&&e.groupId===kind&&e.status==='Approved'&&e.address===address&&e.dnsLinked===true),'PRIVATE_ENDPOINT');
 }
 R(s.vault.id===p.secretScope.split('/secrets/')[0]&&s.vault.properties.enableRbacAuthorization===true&&s.vault.properties.publicNetworkAccess==='Disabled','VAULT');
 R(s.storage.id===p.containerScope.split('/blobServices/')[0]&&s.storage.publicNetworkAccess==='Disabled'&&s.storage.allowSharedKeyAccess===false,'STORAGE');
 R(s.image.id===p.imageId&&s.image.provisioningState==='Succeeded'&&s.imageEvidence.sha256===p.imageSha256&&s.imageEvidence.nodeMajor===22&&s.imageEvidence.platform==='linux'&&s.imageEvidence.arch==='x64'&&s.imageEvidence.agentReady&&s.imageEvidence.sshDisabled&&s.imageEvidence.noCredentials,'IMAGE');
 R(s.skuAvailable===true&&s.runCommandSupported===true&&s.cleanupScheduled===true,'EXTERNAL_PREREQUISITES');
 const protectedIds=[VNET,SUBNET,DB,DNS,ROOT+'Microsoft.Web/sites/opa-api-production',VNET+'/subnets/opa-api-productionAppSubnet',VNET+'/subnets/opa-api-productionDbSubnet'];
 R(protectedIds.every(id=>s.resources.some(r=>r.id===id)||[VNET,SUBNET,DB,DNS].includes(id)),'PROTECTED_INVENTORY');
 return n;
}
function owned(s,p,n){
 const ids={vm:ROOT+'Microsoft.Compute/virtualMachines/'+n.vm,nic:ROOT+'Microsoft.Network/networkInterfaces/'+n.nic,nsg:ROOT+'Microsoft.Network/networkSecurityGroups/'+n.nsg,identity:ROOT+'Microsoft.ManagedIdentity/userAssignedIdentities/'+n.identity,disk:ROOT+'Microsoft.Compute/disks/'+n.disk};
 const found={};
 for(const [k,id] of Object.entries(ids)){
  const matches=s.resources.filter(r=>r.id.toLowerCase()===id.toLowerCase());R(matches.length<=1,'DUPLICATE');
  if(matches.length){const r=matches[0];R(r.id===id&&r.location===REGION&&Object.entries(n.tags).every(([k,v])=>r.tags?.[k]===v),'UNEXPECTED_RESOURCE');found[k]=r;}
 }
 R(s.resources.filter(r=>r.tags?.opaMigrationJob===p.job).every(r=>Object.values(ids).includes(r.id)),'UNEXPECTED_JOB_RESOURCE');
 return {ids,found};
}
function preflight(s,p,now){const n=base(s,p,'pre',now),o=owned(s,p,n);R(!Object.keys(o.found).length,'ALREADY_EXISTS');return receipt('preflight',p,n);}
function assignments(s,p,n){
 const identity=s.identity;R(identity.id===ROOT+'Microsoft.ManagedIdentity/userAssignedIdentities/'+n.identity&&/^[a-f0-9-]{36}$/.test(identity.principalId),'IDENTITY');
 const expected=[[p.secretScope,roles.secret],[p.containerScope,roles.blob]];
 const actual=s.assignments.filter(a=>a.principalId===identity.principalId);
 R(actual.length===2&&expected.every(([scope,role])=>actual.some(a=>a.scope===scope&&a.roleDefinitionId.endsWith('/'+role)&&!a.condition)),'RBAC_DRIFT');
 R(s.identityTransitiveGroups?.length===0&&s.rbacInventoryComplete===true,'RBAC_INCOMPLETE');
}
function verify(s,p,now){const n=base(s,p,'post',now),o=owned(s,p,n);R(Object.keys(o.found).length===5,'MISSING_RESOURCE');
 R(s.vm.id===o.ids.vm&&s.vm.networkProfile.networkInterfaces.length===1&&s.vm.networkProfile.networkInterfaces[0].id===o.ids.nic&&s.vm.storageProfile.imageReference.id===p.imageId&&s.vm.hardwareProfile.vmSize==='Standard_D2s_v5'&&s.vm.storageProfile.osDisk.managedDisk.id===o.ids.disk&&!(s.vm.storageProfile.dataDisks?.length),'VM');
 R(s.vm.identity.type==='UserAssigned'&&Object.keys(s.vm.identity.userAssignedIdentities).join()===o.ids.identity,'VM_IDENTITY');
 R(!s.vm.osProfile.customData&&s.vm.osProfile.linuxConfiguration.disablePasswordAuthentication===true&&s.vm.diagnosticsProfile?.bootDiagnostics?.enabled===false,'VM_SECRETS');
 R(s.nic.id===o.ids.nic&&s.nic.networkSecurityGroup.id===o.ids.nsg&&s.nic.enableIPForwarding===false&&s.nic.ipConfigurations.length===1,'NIC');
 const c=s.nic.ipConfigurations[0];R(c.subnet.id===SUBNET&&!c.publicIPAddress&&/^10\.0\.0\./.test(c.privateIPAddress)&&ip(c.privateIPAddress)&&!(c.loadBalancerBackendAddressPools?.length)&&!(c.applicationGatewayBackendAddressPools?.length)&&!(c.loadBalancerInboundNatRules?.length),'PUBLIC_OR_INBOUND_PATH');
 R(JSON.stringify(s.nsg.securityRules.map(r=>({name:r.name,...r.properties})))===JSON.stringify(rules(p)),'NSG_DRIFT');
 R(s.guest.nodeMajor===22&&s.guest.platform==='linux'&&s.guest.arch==='x64'&&s.guest.sshDisabled&&s.guest.artifactSha256===p.artifactSha256&&s.guest.resourceId===o.ids.vm&&s.guest.privateAddresses.includes(c.privateIPAddress)&&JSON.stringify([...s.guest.databaseAddresses].sort())===JSON.stringify([...p.databaseAddresses].sort())&&s.guest.databaseAddresses.every(ip)&&s.guest.agentHealthy&&s.guest.effectiveNsgVerified&&s.guest.routesVerified,'GUEST_PROOF');
 assignments(s,p,n);return receipt('post-provision',p,n);
}
function receipt(phase,p,n){return {version:1,phase,status:'verified',job:p.job,planSha256:hash(p),expiresAt:p.expiresAt,cleanupOwner:p.cleanupOwner,resources:n};}
const q=x=>"'"+String(x).replaceAll("'","'\\''")+"'";
function commands(s,p,now){preflight(s,p,now);const n=plan(p,now), tags=Object.entries(n.tags).map(([k,v])=>q(k+'='+v)).join(' '),a=`--subscription ${SUB} -g ${RG}`,o=owned(s,p,n);
 const lines=['#!/usr/bin/env bash','set -euo pipefail','# REVIEW ONLY. Re-run fresh preflight immediately before each stage. No credentials.'];
 lines.push(`az network nsg create ${a} -n ${n.nsg} -l ${REGION} --tags ${tags} --only-show-errors -o none`);
 for(const r of rules(p))lines.push(`az network nsg rule create ${a} --nsg-name ${n.nsg} -n ${r.name} --priority ${r.priority} --direction ${r.direction} --access ${r.access} --protocol ${q(r.protocol)} --source-address-prefixes ${q(r.sourceAddressPrefix)} --source-port-ranges ${q(r.sourcePortRange)} --destination-address-prefixes ${q(r.destinationAddressPrefix)} --destination-port-ranges ${q(r.destinationPortRange)} --only-show-errors -o none`);
 lines.push('# Independent rule-set verification REQUIRED before NIC/VM creation.',`az identity create ${a} -n ${n.identity} -l ${REGION} --tags ${tags} --only-show-errors -o none`,`principal=$(az identity show ${a} -n ${n.identity} --query principalId -o tsv)`);
 for(const [scope,role] of [[p.secretScope,roles.secret],[p.containerScope,roles.blob]])lines.push(`az role assignment create --subscription ${SUB} --assignee-object-id "$principal" --assignee-principal-type ServicePrincipal --role ${role} --scope ${q(scope)} --only-show-errors -o none`);
 lines.push(`az network nic create ${a} -n ${n.nic} -l ${REGION} --subnet ${q(SUBNET)} --network-security-group ${q(o.ids.nsg)} --ip-forwarding false --tags ${tags} --only-show-errors -o none`,
 `az vm create ${a} -n ${n.vm} -l ${REGION} --image ${q(p.imageId)} --size Standard_D2s_v5 --nics ${q(o.ids.nic)} --assign-identity ${q(o.ids.identity)} --os-disk-name ${n.disk} --storage-sku Standard_LRS --admin-username opaoperator --ssh-key-values ${q(p.publicKey)} --authentication-type ssh --public-ip-address '' --nsg '' --tags ${tags} --only-show-errors -o none`,
 `az disk update ${a} -n ${n.disk} --set tags=${q(JSON.stringify(n.tags))} --only-show-errors -o none`,
 `az vm boot-diagnostics disable ${a} -n ${n.vm} --only-show-errors -o none`,
 '# STOP. Collect independent guest/network/RBAC proof. This does not authorize migration.',
 '# Approved NON-SECRET bootstrap only; no parameters, SAS, output blob or secret values.',
 `client=$(az identity show ${a} -n ${n.identity} --query clientId -o tsv)`,
 `jq -n --arg client "$client" --arg uri ${q(p.scriptUri)} '{location:"${REGION}",properties:{source:{scriptUri:$uri,scriptUriManagedIdentity:{clientId:$client}},timeoutInSeconds:600,asyncExecution:false}}' > /approved/managed-runcommand.json`,
 `az rest --method put --url ${q('https://management.azure.com'+o.ids.vm+'/runCommands/opa-bootstrap?api-version=2025-04-01')} --body @/approved/managed-runcommand.json --only-show-errors -o none`);
 return lines.join('\n')+'\n';
}
function teardown(s,p,now=Date.now()){
 // Expired lease MUST NOT block cleanup. Revalidate immutable plan at creation.
 const n=plan(p,Date.parse(p.createdAt)),o=owned(s,p,n);
 R(s.subscription===SUB&&Date.parse(s.observedAt)<=now&&now-Date.parse(s.observedAt)<300000,'CLEANUP_INVENTORY');
 const lines=['#!/usr/bin/env bash','set -euo pipefail','# REVIEW ONLY. Partial cleanup uses fresh, complete inventory. Never delete by tag search.'];
 if(s.identity)R(s.identity.id===o.ids.identity&&/^[a-f0-9-]{36}$/.test(s.identity.principalId),'CLEANUP_IDENTITY');
 const principal=s.identity?.principalId;
 const assignmentsToRemove=(s.assignments||[]).filter(a=>a.principalId===principal&&principal);
 R(assignmentsToRemove.every(a=>[[p.secretScope,roles.secret],[p.containerScope,roles.blob]].some(([scope,role])=>a.scope===scope&&a.roleDefinitionId.endsWith('/'+role))),'RBAC_DRIFT');
 for(const a of assignmentsToRemove){R(a.id===a.scope+'/providers/Microsoft.Authorization/roleAssignments/'+a.name&&/^[a-f0-9-]{36}$/.test(a.name),'ASSIGNMENT_ID');lines.push(`az role assignment delete --subscription ${SUB} --ids ${q(a.id)} --only-show-errors`);}
 for(const k of ['vm','nic','disk','identity','nsg'])if(o.found[k])lines.push(`az resource delete --subscription ${SUB} --ids ${q(o.ids[k])} --only-show-errors`);
 return lines.join('\n')+'\n';
}
function gone(s,p,before,now=Date.now()){const n=plan(p,Date.parse(p.createdAt));R(s.subscription===SUB&&Date.parse(s.observedAt)<=now&&now-Date.parse(s.observedAt)<300000,'CLEANUP_INVENTORY');R(!Object.keys(owned(s,p,n).found).length,'RESOURCES_REMAIN');R(!(s.assignments||[]).some(a=>a.principalId===before.identity?.principalId&&a.principalId),'RBAC_REMAINS');
 for(const field of ['group','vnet','subnet','database','dns','links','records','vault','storage'])R(hash(s[field])===hash(before[field]),'PRODUCTION_DRIFT');
 for(const r of before.resources.filter(r=>r.tags?.opaMigrationJob!==p.job))R(s.resources.some(x=>x.id===r.id&&hash(x)===hash(r)),'UNRELATED_RESOURCE_DRIFT');
 return receipt('post-teardown',p,n);
}
if(require.main===module){try{const [mode,planFile,snapshotFile,out,beforeFile]=process.argv.slice(2);R(['preflight','generate','verify','teardown','verify-gone'].includes(mode)&&out,'ARGUMENTS');const p=JSON.parse(fs.readFileSync(planFile)),s=JSON.parse(fs.readFileSync(snapshotFile));const result=mode==='preflight'?preflight(s,p):mode==='generate'?commands(s,p):mode==='verify'?verify(s,p):mode==='teardown'?teardown(s,p):gone(s,p,JSON.parse(fs.readFileSync(beforeFile)));fs.writeFileSync(out,typeof result==='string'?result:JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log('INFRA_OUTPUT_CREATED');}catch{console.error('INFRA_CONTRACT_REJECTED');process.exitCode=1;}}
module.exports={SUB,RG,REGION,ROOT,VNET,SUBNET,DB,DNS,roles,plan,rules,preflight,verify,commands,teardown,gone,hash};
