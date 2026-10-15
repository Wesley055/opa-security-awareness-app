"""Independent standard-library verification of the frozen ZIP and manifest."""
import sys,pathlib,json,zipfile,hashlib,stat
directory=pathlib.Path(sys.argv[1]);baseline=pathlib.Path(sys.argv[2]);sha=lambda b:hashlib.sha256(b).hexdigest()
r=json.loads((directory/'packaging-receipt.json').read_text());archive=directory/'opa-api-durable-runtime.UNSIGNED.zip'
assert sha(archive.read_bytes())==r['artifactSHA256']
mb=(directory/'artifact.manifest.json').read_bytes();assert sha(mb)==r['manifestSHA256'];m=json.loads(mb)
assert m['build']=='runtime-v2-sha256-'+r['artifactSHA256']
with zipfile.ZipFile(archive) as z,zipfile.ZipFile(baseline) as old:
    names=[i.filename for i in z.infolist() if not i.is_dir()]
    assert len(names)==len(set(names)) and set(names)==set(m['files'])
    for name in names:
        info=z.getinfo(name);data=z.read(name);entry=m['files'][name]
        if stat.S_ISLNK(info.external_attr>>16):assert entry=={'link':data.decode()}
        else:assert entry=={'sha256':sha(data)}
    migrations=[n for n in names if n.startswith('apps/api/prisma/migrations/') and n.endswith('/migration.sql')]
    assert len(migrations)==35 and all(z.read(n)==old.read(n) for n in migrations)
    trust='packages/environment-policy/trusted-signers.json';assert z.read(trust)==old.read(trust)
    allowed={v['path'] for v in r['changedFiles']}
    assert set(names)-set(old.namelist())=={'packages/environment-policy/runtime.cjs'}
    for n in names:
        if n not in allowed:assert z.read(n)==old.read(n),n
    assert b'refreshRuntimeCustody' in z.read('apps/api/dist/main.js')
    assert b'refreshRuntimeCustody' in z.read('apps/api/dist/shared/config/environment.js')
    result={'status':'PASS','artifactSHA256':r['artifactSHA256'],'completeInventoryVerified':len(names),'unchangedMigrations':35,'trustedRegistryUnchanged':True,'allNonAllowlistedBytesUnchanged':True,'signaturesVerified':False,'productionAcceptance':False}
(directory/'independent-artifact-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
