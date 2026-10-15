import unittest,importlib.util,pathlib,json,base64,time,types,sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('provider',pathlib.Path(__file__).with_name('release-operator-input.py'));P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P)
NOW=2000000000
def jwt(resource=P.VAULT,remaining=1564,**changes):
 claims={'oid':'approved-operator','tid':P.TENANT,'aud':resource,'exp':NOW+remaining,'nbf':NOW-1,'iss':'https://sts.windows.net/'+P.TENANT+'/','ver':'1.0'};claims.update(changes)
 return 'h.'+base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')+'.fixture'
class Refresh(unittest.TestCase):
 def setUp(self):self.manifest={'operatorObjectId':'approved-operator'};self.clock=patch.object(P.time,'time',return_value=NOW);self.clock.start();self.signature=patch.object(P,'verify_signature',return_value=None);self.signature.start()
 def tearDown(self):self.clock.stop();self.signature.stop()
 def test_cached_1564_seconds_valid_for_real_660_second_request_budget(self):
  cached=jwt();calls=[];refresh=[]
  def call(args):calls.append(args);return {'accessToken':cached}
  for _ in range(2):self.assertEqual(P.fresh_token(self.manifest,P.VAULT,call,refresh=lambda r:refresh.append(r),min_seconds=660),cached)
  self.assertEqual(refresh,[]);self.assertEqual(len(calls),2)
 def test_stale_cache_refreshed_once_at_operation_use(self):
  calls=[];fresh=jwt(remaining=3600)
  result=P.fresh_token(self.manifest,P.VAULT,lambda a:{'accessToken':jwt(remaining=100)},refresh=lambda r:(calls.append(r) or fresh),min_seconds=660)
  self.assertEqual(result,fresh);self.assertEqual(calls,[P.VAULT])
 def test_expiry_during_staging_reacquires_before_admission(self):
  self.assertEqual(P.fresh_token(self.manifest,P.VAULT,lambda a:{'accessToken':jwt(remaining=-1)},refresh=lambda r:jwt(remaining=3600)),jwt(remaining=3600))
 def test_repeated_stale_refresh_is_rejected_without_loop(self):
  calls=[]
  with self.assertRaisesRegex(ValueError,'RELEASE_TOKEN_LIFETIME'):P.fresh_token(self.manifest,P.VAULT,lambda a:{'accessToken':jwt(remaining=1)},refresh=lambda r:(calls.append(r) or jwt(remaining=2)))
  self.assertEqual(len(calls),1)
 def test_refresh_failure_is_fail_closed(self):
  def reject(r):raise ValueError('RELEASE_TOKEN_REFRESH_REJECTED')
  with self.assertRaisesRegex(ValueError,'REFRESH_REJECTED'):P.fresh_token(self.manifest,P.VAULT,lambda a:{'accessToken':jwt(remaining=1)},refresh=reject)
 def test_unauthorized_identity_or_audience_never_refreshed(self):
  for changes in ({'oid':'another'},{'tid':'another'},{'aud':P.ARM}):
   calls=[]
   with self.assertRaises(ValueError):P.fresh_token(self.manifest,P.VAULT,lambda a:{'accessToken':jwt(**changes)},refresh=lambda r:calls.append(r))
   self.assertEqual(calls,[])
 def test_force_refresh_skips_cached_token(self):
  calls=[]
  def no_cache(a):raise AssertionError('must not reuse cache on 401')
  self.assertEqual(P.fresh_token(self.manifest,P.VAULT,no_cache,force=True,refresh=lambda r:(calls.append(r) or jwt(remaining=3600))),jwt(remaining=3600));self.assertEqual(calls,[P.VAULT])
 def test_unsupported_resource_or_unbounded_deadline_rejected(self):
  with self.assertRaisesRegex(ValueError,'RESOURCE'):P.fresh_token(self.manifest,'https://unapproved.invalid',lambda a:None)
  for minimum in (0,1860):
   with self.assertRaisesRegex(ValueError,'DEADLINE'):P.token_claims(jwt(),self.manifest,P.VAULT,min_seconds=minimum)
 def test_installed_cli_silent_refresh_uses_same_account_force_flag_and_http_timeout(self):
  from azure.cli.core._profile import Profile
  from azure.cli.core import get_default_cli
  calls=[];http=types.SimpleNamespace(get=lambda *a,**kw:calls.append(kw),post=lambda *a,**kw:calls.append(kw))
  def acquire(scopes,account,**kw):
   self.assertEqual(scopes,['https://vault.azure.net/.default']);self.assertEqual(account,'existing-account');self.assertTrue(kw['force_refresh']);http.post('https://fixture.invalid');return {'access_token':jwt(remaining=3600)}
  credential=types.SimpleNamespace(_account='existing-account',_msal_app=types.SimpleNamespace(http_client=http,acquire_token_silent_with_error=acquire))
  profile=types.SimpleNamespace(get_subscription=lambda:{'id':P.SUBSCRIPTION,'tenantId':P.TENANT,'user':{'type':'user'}},_create_credential=lambda *a,**kw:credential)
  with patch('azure.cli.core._profile.Profile',return_value=profile),patch('azure.cli.core.get_default_cli',return_value=None):self.assertEqual(P.silent_refresh(P.VAULT),jwt(remaining=3600))
  self.assertEqual(calls,[{'timeout':15}])
if __name__=='__main__':unittest.main(verbosity=2)
