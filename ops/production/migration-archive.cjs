'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),C=require('./contract.cjs');
const R=C.requireThat;
// This release format contains regular files only. Reject links, non-path pax overrides,
// duplicate paths and traversal before writing anything to a private directory.
function read(file) {
 const raw=fs.readFileSync(file),tar=zlib.gunzipSync(raw,{maxOutputLength:512*1024*1024}),entries=new Map(),modes=new Map();
 let offset=0,pendingPath;
 const str=b=>b.toString('utf8').replace(/\0.*$/s,'');
 while(offset+512<=tar.length) {
  const h=tar.subarray(offset,offset+512);offset+=512;
  if(h.every(b=>b===0)){R(tar.subarray(offset).every(b=>b===0),'ARCHIVE_TRAILING_DATA');break}
  const oct=b=>{const s=str(b).trim();R(/^[0-7]+$/.test(s),'ARCHIVE_NUMBER');return parseInt(s,8)};
  const checksum=oct(h.subarray(148,156));let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];R(sum===checksum,'ARCHIVE_CHECKSUM');
  const prefix=str(h.subarray(345,500));let name=(prefix?prefix+'/':'')+str(h.subarray(0,100)),size=oct(h.subarray(124,136));
  if(h[156]===120){
   R(!pendingPath&&offset+size<=tar.length,'ARCHIVE_PAX');const data=tar.subarray(offset,offset+size),space=data.indexOf(32),length=Number(data.subarray(0,space).toString());
   R(space>0&&length===data.length&&data.at(-1)===10&&data.subarray(space+1,space+6).toString()==='path=','ARCHIVE_PAX');
   pendingPath=data.subarray(space+6,-1).toString('utf8');offset+=Math.ceil(size/512)*512;continue;
  }
  if(pendingPath){name=pendingPath;pendingPath=undefined}
  R(h[156]===48||h[156]===0,'ARCHIVE_REGULAR_ONLY');
  R(name.length>0&&!/[\x00-\x1f\x7f]/.test(name)&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!entries.has(name),'ARCHIVE_PATH');
  R(Number.isSafeInteger(size)&&offset+size<=tar.length,'ARCHIVE_SIZE');
  modes.set(name,oct(h.subarray(100,108))&0o777);entries.set(name,tar.subarray(offset,offset+size));offset+=Math.ceil(size/512)*512;
 }
 R(!pendingPath&&entries.has('migration-artifact.json'),'ARCHIVE_MANIFEST');
 const bytes=entries.get('migration-artifact.json'),manifest=JSON.parse(bytes);
 R(manifest.version===1&&manifest.baselineBuild===C.BASE&&Object.keys(manifest.baseline).length===35&&Object.keys(manifest.candidate).length===42&&JSON.stringify(manifest.forward)===JSON.stringify(C.FORWARD),'ARCHIVE_MIGRATIONS');
 R(entries.size===Object.keys(manifest.files).length+1&&Object.entries(manifest.files).every(([n,h])=>entries.has(n)&&C.hash(entries.get(n))===h),'ARCHIVE_INVENTORY');
 R(Object.entries({...manifest.baseline,...C.FORWARD}).every(([n,h])=>manifest.candidate[n]===h&&manifest.files[`apps/api/prisma/migrations/${n}/migration.sql`]===h),'ARCHIVE_SQL');
 return {manifest,manifestSha256:C.hash(bytes),archiveSha256:C.hash(raw),entries,modes};
}
function extract(file,parent) {
 const checked=read(file),root=fs.mkdtempSync(path.join(parent,'opa-release-runner-'));
 try {for(const [name,bytes] of checked.entries){const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx',mode:checked.modes.get(name)})}return {root,...checked}}
 catch(e){fs.rmSync(root,{recursive:true,force:true});throw e}
}
module.exports={read,extract};
