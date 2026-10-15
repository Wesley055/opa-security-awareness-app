import time
import unittest,importlib.util,pathlib,tempfile,json,hashlib,base64,os,subprocess
from unittest.mock import patch
root=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('provider',root/'release-operator-input.py');provider=importlib.util.module_from_spec(spec);spec.loader.exec_module(provider)
class Operator(unittest.TestCase):
 def setUp(self):self.signature=patch.object(provider,'verify_signature',return_value=None);self.signature.start()
 def tearDown(self):self.signature.stop()
 def fixture(self,directory):
  reference={'adminRole':'test_release_admin','adminPasswordSecretId':'https://opa-kv-production.vault.azure.net/secrets/opa-production-postgresql-admin-password/'+'a'*32}
  payload={'operatorCredentialBindings':reference,'operatorObjectId':'fixture-operator'};file=pathlib.Path(directory)/'owner.json';file.write_text(json.dumps({'payload':base64.b64encode(json.dumps(payload).encode()).decode()}));return file,hashlib.sha256(file.read_bytes()).hexdigest(),reference
 def test_missing_exact_authorization_never_reads_operator_credentials(self):
  with tempfile.TemporaryDirectory() as directory:
   file,digest,reference=self.fixture(directory)
   with patch.dict(os.environ,{},clear=True),patch.object(subprocess,'run') as run:
    with self.assertRaisesRegex(ValueError,'EXPLICIT_FINAL'):provider.credentials(file,digest,reference)
    run.assert_not_called()
 def test_vault_set_permission_is_required_before_admin_secret_read(self):
  for enabled in (False,True):
   with self.subTest(rbac=enabled),tempfile.TemporaryDirectory() as directory:
    file,digest,reference=self.fixture(directory);claims=base64.urlsafe_b64encode(json.dumps({'oid':'fixture-operator','tid':provider.TENANT,'aud':provider.ARM,'exp':int(time.time())+3600,'iss':'https://sts.windows.net/'+provider.TENANT+'/','ver':'1.0'}).encode()).decode().rstrip('=');calls=[]
    def run(args,**kwargs):
     calls.append(args)
     if 'assignment' in args:answer=[]
     elif 'get-access-token' in args:answer={'accessToken':'h.'+claims+'.s'}
     elif any('permissions?' in str(x) for x in args):answer={'value':[{'dataActions':[],'notDataActions':[]}]}
     else:answer={'properties':{'enableRbacAuthorization':enabled,'accessPolicies':[{'objectId':'fixture-operator','permissions':{'secrets':['get']}}]}}
     return subprocess.CompletedProcess(args,0,json.dumps(answer),'')
    with patch.dict(os.environ,{'OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256':digest},clear=True),patch.object(subprocess,'run',side_effect=run):
     with self.assertRaisesRegex(ValueError,'CUSTODY_WRITE_PERMISSION_NOT_VERIFIED'):provider.credentials(file,digest,reference)
    self.assertFalse(any('show' in args and 'secret' in args for args in calls))
 def test_operator_identity_must_match_owner_manifest(self):
  with tempfile.TemporaryDirectory() as directory:
   file,digest,reference=self.fixture(directory);claims=base64.urlsafe_b64encode(json.dumps({'oid':'another-operator'}).encode()).decode().rstrip('=')
   with patch.dict(os.environ,{'OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256':digest},clear=True),patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps({'accessToken':'h.'+claims+'.s'}),'')) as run:
    with self.assertRaisesRegex(ValueError,'APPROVED_OPERATOR_IDENTITY_REQUIRED'):provider.credentials(file,digest,reference)
    self.assertEqual(run.call_count,1)
 def test_reference_cannot_change_after_owner_approval(self):
  with tempfile.TemporaryDirectory() as directory:
   file,digest,reference=self.fixture(directory);reference['adminRole']='unapproved'
   with patch.dict(os.environ,{'OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256':digest},clear=True),patch.object(subprocess,'run') as run:
    with self.assertRaisesRegex(ValueError,'APPROVED_OPERATOR_CUSTODY_REFERENCE_REQUIRED'):provider.credentials(file,digest,reference)
    run.assert_not_called()

class Permission(unittest.TestCase):
 def test_existing_unconditional_officer_needs_no_new_assignment(self):
  resource='/subscriptions/sub/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/vault'
  def call(args):
   if 'assignment' in args:return [{'scope':resource,'roleDefinitionId':'/roles/officer','principalId':'operator','condition':None}]
   return [{'permissions':[{'dataActions':['Microsoft.KeyVault/vaults/secrets/*'],'notDataActions':[]}]}]
  self.assertTrue(provider.custody_permission(call,resource,'operator'))
 def test_owner_control_plane_alone_is_not_data_plane_permission(self):
  resource='/subscriptions/sub/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/vault'
  def call(args):return [{'scope':resource,'roleDefinitionId':'/roles/owner'}] if 'assignment' in args else [{'permissions':[{'actions':['*'],'dataActions':None}]}]
  self.assertFalse(provider.custody_permission(call,resource,'operator'))
 def test_conditions_wrong_scope_and_excluded_set_permission_fail_closed(self):
  resource='/subscriptions/sub/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/vault'
  for override in [{'condition':'not-supported'},{'scope':resource+'/secrets/another'},{'exclude':True}]:
   def call(args):
    if 'assignment' in args:return [{'scope':override.get('scope',resource),'roleDefinitionId':'/roles/officer','condition':override.get('condition')}]
    return [{'permissions':[{'dataActions':['Microsoft.KeyVault/vaults/secrets/*'],'notDataActions':['Microsoft.KeyVault/vaults/secrets/setSecret/action'] if override.get('exclude') else []}]}]
   self.assertFalse(provider.custody_permission(call,resource,'operator'))

if __name__=='__main__':unittest.main()
