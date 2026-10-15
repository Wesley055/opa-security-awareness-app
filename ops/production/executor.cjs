'use strict';
const fs=require('node:fs'),path=require('node:path'),C=require('./contract.cjs');
function fingerprint(){
 const files={};
 for(const relative of ['ops/production','packages/environment-policy']){
  const dir=path.resolve(__dirname,'../..',relative);
  for(const name of fs.readdirSync(dir).sort()){
   if(!/\.(cjs|json|sql)$/.test(name)||/\.(test|fixtures)\./.test(name)||name==='fixtures.cjs')continue;
   const file=path.join(dir,name);C.requireThat(fs.lstatSync(file).isFile(),'EXECUTOR_REGULAR_FILE');files[relative+'/'+name]=C.hash(fs.readFileSync(file));
  }
 }
 return C.hash(JSON.stringify(files));
}
module.exports={fingerprint};
