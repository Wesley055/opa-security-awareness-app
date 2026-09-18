const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const projectRoot=path.join(root,'apps/mobile-app');
const plugin=fs.readFileSync(path.join(projectRoot,'plugins/with-canonical-brand.js'),'utf8');

function harness(corrupt){
 const copied=[];
 const fakeFs={...fs,mkdirSync(){},copyFileSync(from,to){copied.push({from,to})},readFileSync(p,...args){
  if(corrupt&&String(p).endsWith('mipmap-xxxhdpi'+path.sep+'ic_launcher_round.webp'))return Buffer.from('unexpected replacement');
  return fs.readFileSync(p,...args);
 }};
 const module={exports:{}};
 vm.runInNewContext(plugin,{module,require(name){
  if(name==='node:fs')return fakeFs;
  if(name==='@expo/config-plugins')return {withDangerousMod(config,[platform,run]){assert.equal(platform,'android');return run(config)}};
  return require(name);
 }});
 return {copied,run:()=>module.exports({modRequest:{projectRoot}})};
}
test('native brand sync copies exactly the registered resources, with no native code writes',async()=>{
 const h=harness(false);await h.run();assert.equal(h.copied.length,32);
 for(const {to} of h.copied){const p=path.relative(path.join(projectRoot,'android/app/src/main/res'),to).replaceAll('\\','/');assert.match(p,/^(mipmap-|drawable-)/);assert.ok(!p.includes('..'));assert.match(p,/(ic_launcher(?:_round|_foreground|_background|_monochrome)?\.(webp|xml)|splashscreen_logo\.png)$/)}
});
test('native brand sync rejects asset drift before copying any resource',async()=>{
 const h=harness(true);await assert.rejects(h.run(),/missing or changed/);assert.equal(h.copied.length,0);
});
