import pathlib,json,hashlib,difflib,zipfile
root=pathlib.Path(__file__).resolve().parents[1];out=root.parent/'durable-runtime-release-reviewed'
baseline=pathlib.Path('C:/Users/mohammed.WESLEYWEST/.codex/visualizations/2026/10/07/01a114a1-0875-7053-af1c-5165d8f77671/api-recovery-b02a851')
sha=lambda b:hashlib.sha256(b).hexdigest()
unit=json.loads((root/'unit-final-results.json').read_text());assert unit['numFailedTests']==0
suites={}
for name in ['integration-results.json','integration-rerun-results.json','compatibility-final-results.json']:
    for suite in json.loads((root/name).read_text())['testResults']:suites[suite['name']]=suite
assert all(s['status']=='passed' for s in suites.values())
integration_count=sum(len(s['assertionResults']) for s in suites.values());assert integration_count==214
linux=json.loads((root/'linux-artifact-rehearsal.log').read_text().strip().splitlines()[-1]);assert linux['status']=='PASS'
independent=json.loads((out/'independent-artifact-verification.json').read_text());assert independent['status']=='PASS'
assert not (root/'lint-final.log').read_text().strip()
assert not (root/'build-reviewed.log').read_text().strip()
selected=[]
for directory in ['apps/api/src','apps/api/test','packages/environment-policy']:
    selected.extend(p for p in (root/directory).rglob('*') if p.is_file() and p.suffix in ['.ts','.cjs','.cts','.json','.md'])
selected.extend([root/'docs/architecture/ADR-durable-api-runtime.md',root/'docs/DURABLE-RUNTIME-OPERATIONS.md'])
selected.extend(root/'ops'/p for p in ['package-durable-runtime.py','verify-runtime-artifact.py','prepare-durable-runtime.cjs','prepare-runtime-test-db.cjs','linux-runtime-rehearsal.cjs','finalize-runtime-evidence.py'])
changes=[];patch=[]
with zipfile.ZipFile(out/'durable-runtime-source-changes.zip','x',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(set(selected)):
        relative=p.relative_to(root).as_posix();old=baseline/relative;data=p.read_bytes()
        if old.exists() and old.read_bytes()==data:continue
        changes.append({'path':relative,'beforeSHA256':sha(old.read_bytes()) if old.exists() else None,'afterSHA256':sha(data)})
        a=old.read_text().splitlines(keepends=True) if old.exists() else [];b=p.read_text().splitlines(keepends=True)
        patch.append('diff --git a/'+relative+' b/'+relative+'\n')
        patch.extend(difflib.unified_diff(a,b,fromfile='a/'+relative if old.exists() else '/dev/null',tofile='b/'+relative))
        z.writestr(relative,data)
(out/'durable-runtime-correction.patch').write_text(''.join(patch))
receipts={}
for name in ['unit-final-results.json','unit-final.log','integration-results.json','integration.log','integration-rerun-results.json','integration-rerun.log','compatibility-final-results.json','compatibility-final.log','affected-results.json','lint-affected-results.json','lint-final.log','build-reviewed.log','policy-final.log','linux-artifact-rehearsal.log']:
    data=(root/name).read_bytes();(out/name).write_bytes(data);receipts[name]=sha(data)
receipts['independent-artifact-verification.json']=sha((out/'independent-artifact-verification.json').read_bytes())
r=json.loads((out/'packaging-receipt.json').read_text())
report={'status':'LOCAL_VALIDATION_COMPLETE_PRODUCTION_AUTHORIZATION_REQUIRED','artifactSHA256':r['artifactSHA256'],'manifestSHA256':r['manifestSHA256'],'build':r['build'],'unitTests':unit['numPassedTests'],'integrationSuites':len(suites),'integrationTests':integration_count,'integrationEvidence':'Full 20-suite run with two targeted reruns; latest result per suite retained. Original failures preserved.','policyAndSecurityTests':51,'productionBuild':'PASS','lint':'PASS','linuxArtifactRehearsal':linux,'independentZIPVerification':independent,'sourceChanges':changes,'evidenceSHA256':receipts,'productionModified':False,'productionDatabaseModified':False,'sevenReleaseMigrationsExecuted':False,'keysOrRegistryChanged':False,'realSOSDispatched':False,'productionAcceptance':False,'pendingGates':['Independently approve and sign exact artifact/config runtime and custody payloads','Verify get-only App Service managed identity access to latest custody secret in existing Key Vault','Authorize custody secret publication and immutable artifact mounting','Authorize isolated App Service restart/recycle/scale-out rehearsal','Authorize exact bounded production deployment and restart after rehearsal','Observe production restart after deployment-approval expiry']}
(out/'acceptance-receipt.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['sourceChanges','evidenceSHA256','linuxArtifactRehearsal','independentZIPVerification']}))
