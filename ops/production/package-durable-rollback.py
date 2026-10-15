from pathlib import Path
import zipfile,hashlib,json,stat,copy,sys
out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=False)
old=Path(sys.argv[1])
current=Path(sys.argv[2])
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(old.read_bytes())=='2d391ef4eb10d4c0bdfcf8407307f3fc492bb9a123ae8dd73c82145a57301cd4'
assert sha(current.read_bytes())=='621f96556892bcb144cf414d2f1add908e4d1b2143ece135bfca81e85478d508'
overrides=['apps/api/dist/main.js','apps/api/dist/main.js.map','apps/api/dist/shared/config/environment.js','apps/api/dist/shared/config/environment.js.map','packages/environment-policy/index.cjs','packages/environment-policy/index.d.cts','packages/environment-policy/runtime.cjs']
files={};changes=[];migrations={};archive=out/'opa-api42-durable-rollback.zip'
with zipfile.ZipFile(old) as prior,zipfile.ZipFile(current) as fixed,zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as new:
 names=set()
 for info in prior.infolist():
  assert info.filename not in names;names.add(info.filename);data=prior.read(info)
  if info.filename in overrides:
   replacement=fixed.read(info.filename);changes.append({'path':info.filename,'before':sha(data),'after':sha(replacement)});data=replacement
  new.writestr(copy.copy(info),data)
  if not info.is_dir():files[info.filename]={'link':data.decode()} if stat.S_ISLNK(info.external_attr>>16) else {'sha256':sha(data)}
  if info.filename.startswith('apps/api/prisma/migrations/') and info.filename.endswith('/migration.sql'):migrations[info.filename]=sha(data)
 for name in overrides:
  if name not in names:
   data=fixed.read(name);info=fixed.getinfo(name);new.writestr(copy.copy(info),data);files[name]={'sha256':sha(data)};changes.append({'path':name,'before':None,'after':sha(data)})
 # Startup uses schema inventory, unchanged at 42; patched preflight and main are
 # byte-identical to the tested unified runtime, not the expired legacy verifier.
 assert len(migrations)==42
 for name in overrides:assert files[name]['sha256']==sha(fixed.read(name))
 assert prior.read('apps/api/prisma/schema.prisma')==fixed.read('apps/api/prisma/schema.prisma')
h=sha(archive.read_bytes());manifest={'version':1,'build':'rollback42-sha256-'+h,'files':dict(sorted(files.items()))};b=json.dumps(manifest,separators=(',',':')).encode();(out/'rollback-runtime-artifact.manifest.json').write_bytes(b)
receipt={'status':'UNSIGNED_SCHEMA42_ROLLBACK_CANDIDATE','sourceZIP_SHA256':sha(old.read_bytes()),'artifactSHA256':h,'manifestSHA256':sha(b),'build':manifest['build'],'migrationCount':42,'schemaMatchesAcceptedAPI42':True,'runtimeOverridesMatchUnifiedAPI':True,'changes':changes,'migrations':migrations,'linuxRehearsalPassed':False,'productionAcceptance':False,'productionModified':False}
(out/'rollback-packaging-receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({k:v for k,v in receipt.items() if k not in ('changes','migrations')}))

