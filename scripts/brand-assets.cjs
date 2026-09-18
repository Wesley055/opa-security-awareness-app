/* BRAND-001. Deterministic exports only; never prebuild or change native behavior. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const sharp = createRequire(path.join(root, 'apps/website/package.json'))('sharp');
const masterPath = 'apps/website/public/opa-logo-mark.svg';
const masterHash = '21385afffabe494c700f21d7e70ef75fe912fca01d6949fc27bf343745acee3b';
const navy = '#0B1F3A';
const check = process.argv.includes('--check');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => fs.readFileSync(path.join(root,p));
const source = read(masterPath);
if(hash(source)!==masterHash) throw Error('BRAND-001 master changed; explicit product decision required.');
if(sharp.versions.sharp!=='0.34.5') throw Error('Use locked website dependencies (sharp 0.34.5).');
const svg=source.toString();
const body=svg.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
// Remove only the container for foreground. Original paths and circle stay intact.
const foreground=body.replace(/<rect\b[^>]*\/>/,'');
const mono=foreground.replace(/#17C9B2|#FF5A36/g,'#FFFFFF').replace(/#0B1F3A/g,'#000000').replace(/opacity="0.9"/,'opacity="1"');
const wrap=(contents,view='0 0 64 64')=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${contents}</svg>`);
const full=wrap(`<rect width="64" height="64" fill="${navy}"/>${body}`);
// Original 64-unit geometry centered on Android's 108-unit canvas. Visible
// artwork fits the central radius-33 safe circle; validation measures alpha.
const adaptive=wrap(`<g transform="translate(22 22)">${foreground}</g>`,'0 0 108 108');
const monochrome=wrap(`<defs><mask id="mark"><g transform="translate(22 22)">${mono}</g></mask></defs><rect width="108" height="108" fill="white" mask="url(#mark)"/>`,'0 0 108 108');
const background=wrap(`<rect width="108" height="108" fill="${navy}"/>`,'0 0 108 108');
const legacy=wrap(`<rect x="18" y="18" width="72" height="72" fill="${navy}"/><g transform="translate(22 22)">${foreground}</g>`,'18 18 72 72');
const round=wrap(`<defs><clipPath id="round"><circle cx="54" cy="54" r="36"/></clipPath></defs><g clip-path="url(#round)"><rect x="18" y="18" width="72" height="72" fill="${navy}"/><g transform="translate(22 22)">${foreground}</g></g>`,'18 18 72 72');
const raster=(input,size,format='png')=>sharp(input,{density:300}).resize(size,size)[format](format==='webp'?{lossless:true,effort:6}:{compressionLevel:9}).toBuffer();
const entries=[];
async function emit(p,b,surface,dimensions,status='generated'){
 const absolute=path.join(root,p);
 if(check){if(!fs.existsSync(absolute)||!read(p).equals(b))throw Error('Brand drift: '+p);}
 else {fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,b);}
 entries.push({surface,source:masterPath,path:p,dimensions,sha256:hash(b),status});
}
async function image(p,input,size,surface,format='png'){await emit(p,await raster(input,size,format),surface,`${size} x ${size}`);}
function ico(images){
 const head=Buffer.alloc(6+16*images.length);head.writeUInt16LE(1,2);head.writeUInt16LE(images.length,4);
 let offset=head.length;
 images.forEach(({size,data},i)=>{let p=6+i*16;head[p]=head[p+1]=size===256?0:size;head.writeUInt16LE(1,p+4);head.writeUInt16LE(32,p+6);head.writeUInt32LE(data.length,p+8);head.writeUInt32LE(offset,p+12);offset+=data.length});
 return Buffer.concat([head,...images.map(i=>i.data)]);
}
async function main(){
 const assets='apps/mobile-app/assets/';
 await emit(assets+'icon.png',await sharp(full,{density:300}).resize(1024,1024).removeAlpha().png({compressionLevel:9}).toBuffer(),'Expo Android / iOS shared opaque RGB source','1024 x 1024');
 await image(assets+'android-icon-foreground.png',adaptive,432,'Android adaptive foreground');
 await image(assets+'android-icon-background.png',background,432,'Android adaptive navy background');
 await image(assets+'android-icon-monochrome.png',monochrome,432,'Android themed monochrome');
 await image(assets+'splash-icon.png',source,1024,'Shared splash');
 await image(assets+'favicon.png',source,48,'Expo web favicon');
 await image('artifacts/brand/google-play/opa-emergency-safety-play-icon-512.png',full,512,'Google Play listing');
 await emit('apps/website/src/app/icon.svg',source,'Website / Command Center browser icon','64 x 64 vector');
 await emit('apps/website/src/app/favicon.ico',ico(await Promise.all([16,32,48,256].map(async size=>({size,data:await raster(source,size)})))),'Website / Command Center favicon','16, 32, 48, 256 square');
 const native='apps/mobile-app/android/app/src/main/res/';
 const portable='apps/mobile-app/assets/brand/android-res/';
 const nativePresent=fs.existsSync(path.join(root,'apps/mobile-app/android/app/src/main/AndroidManifest.xml'));
 async function resource(relative,b,surface,dimensions){
  await emit(portable+relative,b,surface+' (portable native source)',dimensions);
  if(nativePresent) await emit(native+relative,b,surface,dimensions,'native resource; device acceptance pending');
 }
 for(const [density,scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]){
  for(const [name,input,dp,label] of [
   ['ic_launcher',legacy,48,'Android standard'],['ic_launcher_round',round,48,'Android round'],
   ['ic_launcher_foreground',adaptive,108,'Android foreground'],['ic_launcher_background',background,108,'Android background'],['ic_launcher_monochrome',monochrome,108,'Android monochrome']
  ]) {const size=dp*scale;await resource(`mipmap-${density}/${name}.webp`,await raster(input,size,'webp'),label,`${size} x ${size}`);}
  // Retain the existing 288dp splash canvas. Only its image changes.
  const size=288*scale;
  const splash=await sharp({create:{width:size,height:size,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:await raster(source,Math.round(160*scale)),gravity:'centre'}]).png({compressionLevel:9}).toBuffer();
  await resource(`drawable-${density}/splashscreen_logo.png`,splash,'Android splash',`${size} x ${size}`);
 }
 const xml=Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n');
 for(const name of ['ic_launcher','ic_launcher_round'])await resource(`mipmap-anydpi-v26/${name}.xml`,xml,'Android adaptive wiring','108dp layers');
 // Bind existing shared web implementation to master geometry without redesign.
 const logo=read('apps/website/src/components/brand/Logo.tsx').toString();
 const geometry=[...body.matchAll(/\bd="([^"]+)"/g)].map(m=>m[1]);
 for(const d of geometry)if(!logo.includes(d))throw Error('Inline logo geometry diverged from master');
 for(const color of ['#0B1F3A','#FF5A36','#17C9B2'])if(!logo.includes(color))throw Error('Inline logo palette diverged');
 for(const p of ['apps/website/src/components/brand/Logo.tsx','apps/website/public/opa-logo-horizontal.svg'])entries.push({surface:p.endsWith('.tsx')?'Website Navbar/Footer and Super Admin':'Shared horizontal lockup',source:masterPath,path:p,dimensions:p.endsWith('.tsx')?'64 x 64 viewBox; consumer size':'220 x 64 vector',sha256:hash(read(p)),status:'canonical existing implementation'});
 const config=JSON.parse(read('apps/mobile-app/app.json')).expo;
 if(config.name!=='OPA'||!Number.isInteger(config.android.versionCode)||config.android.versionCode<1||config.android.adaptiveIcon.backgroundColor!==navy)throw Error('Unexpected mobile identity configuration');
 for(const [key,value] of Object.entries({foregroundImage:'./assets/android-icon-foreground.png',backgroundImage:'./assets/android-icon-background.png',monochromeImage:'./assets/android-icon-monochrome.png'}))if(config.android.adaptiveIcon[key]!==value)throw Error('Adaptive source drift: '+key);
 if(config.icon!=='./assets/icon.png'||config.web.favicon!=='./assets/favicon.png'||config.splash.image!=='./assets/splash-icon.png'||!config.plugins.includes('./plugins/with-canonical-brand'))throw Error('Shared brand source reference drift');
 if(nativePresent){const gradle=read('apps/mobile-app/android/app/build.gradle').toString();if(Number(gradle.match(/versionCode\s+(\d+)/)?.[1])!==config.android.versionCode)throw Error('Native versionCode differs from Expo');}
 // Targeted source guard, complemented by computed-color browser assertions.
 function styles(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())styles(p);else if(e.name.endsWith('.css')){const css=fs.readFileSync(p,'utf8');for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))if(/m-brand.*svg|data-opa-logo/.test(rule[1])&&/\b(fill|stroke)\s*:/.test(rule[2]))throw Error('Logo CSS recoloring: '+p)}}}
 styles(path.join(root,'apps/website/src'));
 const manifest={decision:'BRAND-001',source:masterPath,sourceSha256:masterHash,generator:'scripts/brand-assets.cjs',rendererVersions:sharp.versions,policy:'All logo changes require coordinated product-owner approval. No independent surface recoloring.',assets:entries};
 const manifestPath='docs/brand-assets.json';
 if(check){const saved=JSON.parse(read(manifestPath));for(const e of entries){const old=saved.assets.find(a=>a.path===e.path);if(!old||old.sha256!==e.sha256)throw Error('Register drift: '+e.path)}}
 else fs.writeFileSync(path.join(root,manifestPath),JSON.stringify(manifest,null,2)+'\n');
 console.log(`${check?'Verified':'Generated'} ${entries.length} brand mappings; master ${masterHash}`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
