"""Offline packaging only. Never signs, deploys or contacts Azure."""
import hashlib,json,pathlib,sys,zipfile,stat,tarfile,io
root=pathlib.Path(__file__).resolve().parents[1]
source=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2])
out.mkdir(parents=True,exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
expected='e02203802356f1b04ab6537c1be2617e9bdfe0826cbf6b8f080948cfbca9884b'
assert sha(source.read_bytes())==expected,'RECOVERY_ZIP_DRIFT'
overrides=['apps/api/dist/main.js','apps/api/dist/main.js.map','apps/api/dist/shared/config/environment.js','apps/api/dist/shared/config/environment.js.map','packages/environment-policy/index.cjs','packages/environment-policy/index.d.cts','packages/environment-policy/runtime.cjs']
payloads={n:(root/n).read_bytes() for n in overrides}
changes=[]; files={}; migrations={}
archive=out/'opa-api-durable-runtime.UNSIGNED.zip'
with zipfile.ZipFile(source) as old,zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as new:
    names=set()
    for info in old.infolist():
        assert info.filename not in names,'DUPLICATE_ZIP_ENTRY'
        names.add(info.filename)
        assert not info.filename.startswith('/') and '..' not in pathlib.PurePosixPath(info.filename).parts
        data=old.read(info)
        if info.filename in payloads:
            replacement=payloads.pop(info.filename)
            changes.append({'path':info.filename,'before':sha(data),'after':sha(replacement)})
            data=replacement
        new.writestr(info,data)
        if not info.is_dir():
            files[info.filename]={'link':data.decode()} if stat.S_ISLNK(info.external_attr>>16) else {'sha256':sha(data)}
        if info.filename.startswith('apps/api/prisma/migrations/') and info.filename.endswith('/migration.sql'):
            migrations[info.filename]=sha(data)
    for name,data in payloads.items():
        info=zipfile.ZipInfo(name,(2026,10,13,0,0,0));info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
        new.writestr(info,data);files[name]={'sha256':sha(data)};changes.append({'path':name,'before':None,'after':sha(data)})
assert len(migrations)==35,'SCHEMA_35_REQUIRED'
archive_sha=sha(archive.read_bytes());build='runtime-v2-sha256-'+archive_sha
manifest={'version':1,'build':build,'files':dict(sorted(files.items()))}
manifest_bytes=json.dumps(manifest,separators=(',',':'),ensure_ascii=False).encode()
(out/'artifact.manifest.json').write_bytes(manifest_bytes)
receipt={'status':'UNSIGNED_CANDIDATE_NOT_APPROVED_FOR_PRODUCTION','sourceZIP_SHA256':expected,'artifactSHA256':archive_sha,'build':build,'manifestSHA256':sha(manifest_bytes),'changedFiles':changes,'migrationCount':len(migrations),'migrations':migrations,'productionModified':False,'signingPerformed':False,'linuxAcceptance':False}
(out/'packaging-receipt.json').write_text(json.dumps(receipt,indent=2))
with zipfile.ZipFile(archive) as z,tarfile.open(out/'linux-rehearsal.tar','w') as tar:
    for info in z.infolist():
        if info.is_dir(): continue
        data=z.read(info);entry=tarfile.TarInfo(info.filename);entry.mode=(info.external_attr>>16)&0o777 or 0o644
        if stat.S_ISLNK(info.external_attr>>16):
            entry.type=tarfile.SYMTYPE;entry.linkname=data.decode();tar.addfile(entry)
        else:
            entry.size=len(data);tar.addfile(entry,io.BytesIO(data))
print(json.dumps({k:v for k,v in receipt.items() if k not in ['migrations','changedFiles']}))
