'use strict';
// Generate read-only CLI commands. This module does not invoke Azure.
const fs=require('node:fs'),C=require('./infra.cjs');
const q=x=>"'"+x.replaceAll("'","'\\''")+"'";
function inventory(p){const n=C.plan(p,Date.parse(p.createdAt)),a=`--subscription ${C.SUB}`,g=`${a} -g ${C.RG}`;
const commands=[
 ['account',`az account show ${a} --query '{subscription:id}'`],['group',`az group show ${g}`],
 ['vnet',`az network vnet show ${g} -n opa-api-productionVnet`],['subnet',`az network vnet subnet show ${g} --vnet-name opa-api-productionVnet -n opa-api-productionSubnet`],
 ['subnets',`az network vnet subnet list ${g} --vnet-name opa-api-productionVnet`],
 ['nics',`az network nic list ${a}`],['private-endpoints',`az network private-endpoint list ${a}`],
 ['database',`az postgres flexible-server show ${g} -n opa-api-production-server`],
 ['dns',`az network private-dns zone show ${g} -n privatelink.postgres.database.azure.com`],
 ['links',`az network private-dns link vnet list ${g} -z privatelink.postgres.database.azure.com`],
 ['records',`az network private-dns record-set a list ${g} -z privatelink.postgres.database.azure.com`],
 ['resources',`az resource list ${a} --query "[].{id:id,location:location,type:type,tags:{opaMigrationJob:tags.opaMigrationJob,expiresAt:tags.expiresAt,cleanupOwner:tags.cleanupOwner,approvalId:tags.approvalId,planSha256:tags.planSha256}}"`],
 ['vault',`az resource show ${a} --ids ${q(p.secretScope.split('/secrets/')[0])} --query '{id:id,properties:{enableRbacAuthorization:properties.enableRbacAuthorization,publicNetworkAccess:properties.publicNetworkAccess}}'`],
 ['storage',`az storage account show ${a} --ids ${q(p.containerScope.split('/blobServices/')[0])} --query '{id:id,publicNetworkAccess:publicNetworkAccess,allowSharedKeyAccess:allowSharedKeyAccess}'`],
 ['image',`az sig image-version show ${a} --ids ${q(p.imageId)} --query '{id:id,provisioningState:provisioningState}'`],
 ['sku',`az vm list-skus ${a} -l ${C.REGION} --size Standard_D2s_v5 --all`],
 ['providers',`az provider show ${a} -n Microsoft.Compute --query '{registrationState:registrationState,resourceTypes:resourceTypes}'`],
 ['bastion',`az network bastion list ${a} --query '[].{id:id,location:location}'`],
 ['assignments',`az role assignment list ${a} --all --include-inherited --query '[].{id:id,name:name,principalId:principalId,roleDefinitionId:roleDefinitionId,scope:scope,condition:condition}'`]
];
const lines=['#!/usr/bin/env bash','set -euo pipefail','umask 077','# READ ONLY. Existing authenticated operator session; do not call az login here.','# New protected evidence directory only. No secret/key/token/data-plane queries.','mkdir "$1"','cd "$1"','date -u +%Y-%m-%dT%H:%M:%SZ > observedAt.txt'];
const projections={group:'{id:id,location:location}',vnet:'{id:id,location:location,addressSpace:addressSpace,dhcpOptions:dhcpOptions}',subnet:'{id:id,addressPrefix:addressPrefix,delegations:delegations,networkSecurityGroup:networkSecurityGroup,routeTable:routeTable,natGateway:natGateway,ipConfigurations:ipConfigurations,privateEndpoints:privateEndpoints,serviceAssociationLinks:serviceAssociationLinks,resourceNavigationLinks:resourceNavigationLinks}',subnets:'[].{id:id,addressPrefix:addressPrefix,delegations:delegations}',nics:'[].{id:id,ipConfigurations:ipConfigurations}', 'private-endpoints':'[].{id:id,subnet:subnet,networkInterfaces:networkInterfaces,privateLinkServiceConnections:privateLinkServiceConnections,customDnsConfigs:customDnsConfigs}',database:'{id:id,location:location,version:version,network:network}',dns:'{id:id}',links:'[].{virtualNetwork:virtualNetwork,virtualNetworkLinkState:virtualNetworkLinkState,registrationEnabled:registrationEnabled}',records:'[].{name:name,aRecords:aRecords}'};
for(const [name,cmd] of commands)lines.push(`${cmd}${projections[name]?' --query '+q(projections[name]):''} --only-show-errors -o json > ${name}.json`);
lines.push('# Post-provision additional read-only queries; run only when resources exist:',...[
 `az vm show ${g} -n ${n.vm} --query '{id:id,networkProfile:networkProfile,storageProfile:storageProfile,hardwareProfile:hardwareProfile,identity:identity,osProfile:{linuxConfiguration:{disablePasswordAuthentication:osProfile.linuxConfiguration.disablePasswordAuthentication}},diagnosticsProfile:diagnosticsProfile}'`,
 `az network nic show ${g} -n ${n.nic}`,`az network nsg show ${g} -n ${n.nsg}`,`az identity show ${g} -n ${n.identity}`,`az network nic list-effective-nsg ${g} -n ${n.nic}`,`az network nic show-effective-route-table ${g} -n ${n.nic}`].map(c=>'# '+c+' --only-show-errors -o json'));
return lines.join('\n')+'\n';}
if(require.main===module){try{const [p,out]=process.argv.slice(2);fs.writeFileSync(out,inventory(JSON.parse(fs.readFileSync(p))),{flag:'wx',mode:0o600});console.log('READ_ONLY_COMMANDS_CREATED');}catch{console.error('INVENTORY_GENERATION_REJECTED');process.exitCode=1;}}
module.exports={inventory};
