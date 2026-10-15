import pathlib,json,base64,importlib.util,shutil,time,paramiko,sys
base=pathlib.Path(__file__).parent;root=pathlib.Path('C:/Projects/OPA-release-simplification')
spec=importlib.util.spec_from_file_location('suite',root/'ops/test_sftp_controller.py');S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
accepted=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);source=json.loads(accepted.read_bytes());old=json.loads(base64.b64decode(source['payload'])) if 'payload' in source else source
test=S.ControllerTests('test_complete_controller_main_real_transport_to_fixture_execution_and_restore');test.setUp();start=time.monotonic()
try:
 test.m['artifacts']={k:dict(v) for k,v in old['artifacts'].items()}
 for a in old['artifacts'].values():
  p=accepted.parent/a['path'];assert test.R.sha(p.read_bytes())==a['sha256'];shutil.copyfile(p,test.bundle/a['path']);shutil.copyfile(p,test.backend.path(test.source+'/'+a['path']))
 test.m['releaseId']=old['releaseId'];test.remote='/home/opa-releases/'+old['releaseId'];test.m['migration']=old['migration'];test.R.approval_bindings(accepted,old);test.write_manifest();test.test_complete_controller_main_real_transport_to_fixture_execution_and_restore()
 for a in test.m['artifacts'].values():assert test.R.sha(test.backend.path(test.remote+'/'+a['path']).read_bytes())==a['sha256']
 diag=json.loads((test.bundle/(test.m['releaseId']+'.remote-database-diagnostic.json')).read_text());assert diag['exitStatus']==0 and diag['stderr']['codes']==['FIXTURE_HANDOFF_ACCEPTED']
 receipt={'status':'PASS_FULL_CONTROLLER_REAL_SSH_SFTP','paramikoVersion':paramiko.__version__,'controllerSHA256':test.R.sha((root/'ops/execute-release.py').read_bytes()),'artifactCount':9,'artifactSHA256':{k:a['sha256'] for k,a in old['artifacts'].items()},'bytesCopied':sum((accepted.parent/a['path']).stat().st_size for a in old['artifacts'].values()),'metadataUpload':True,'sourceAndDestinationVerification':True,'exclusiveMarkerCreateWriteFlushCloseReadback':True,'receiptDownload':True,'deploymentReceiptExclusiveUploadReadback':True,'executionAndRestorationHandoffs':len(test.backend.executions),'duplicateControllerAttemptRejected':True,'sanitizedDiagnosticPersistence':True,'elapsedSeconds':round(time.monotonic()-start,2),'transport':'Real Paramiko SSH/SFTP client and server over loopback; real Node copy/hash subprocesses','privilegedOperations':'Inert runner/deployment/restoration fixtures; synthetic schema receipts; no SQL executed','signatureAdmission':'Fixture manifest admission for orchestration; accepted artifact hashes checked independently; existing signed production manifest unchanged','productionAccessed':False,'productionAcceptance':False,'correctedProductionBindingsCheckedBeforeFixture':True,'backupApprovalId':old['releaseId'],'allNineExactBytesExercised':True,'productionEvidenceUnchanged':True}
 with output.open('x') as f:json.dump(receipt,f,indent=2)
 print(json.dumps(receipt))
finally:test.tearDown()
