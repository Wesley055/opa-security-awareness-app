import unittest,importlib.util,pathlib,json,hashlib,datetime as dt
spec=importlib.util.spec_from_file_location('issuer',pathlib.Path(__file__).with_name('api-recovery-policy.py'));issuer=importlib.util.module_from_spec(spec);spec.loader.exec_module(issuer)
class Validation(unittest.TestCase):
 def validate(self,p):
  raw=json.dumps(p,separators=(',',':')).encode();issuer.validate(p,'test-build',hashlib.sha256(raw).hexdigest(),raw)
 def custody(self):
  return dict(version=2,purpose='runtime-custody',environment='production',issuedAt=dt.datetime.now(dt.timezone.utc).isoformat(),sequence=9,resourceId=issuer.RESOURCES['app'],activeAuthorizations={'approved-runtime-id':'a'*64},revokedAuthorizationIds=['retired-runtime-id'],revokedAuthorityFingerprints=['b'*64])
 def test_durable_custody_validation_never_loads_key(self):
  self.validate(self.custody())
 def test_invalid_custody_scope_expiry_and_revocation_rejected(self):
  for field,value in [('expiresAt','2099-01-01T00:00:00Z'),('sequence',0),('resourceId','wrong'),('revokedAuthorizationIds',['approved-runtime-id']),('activeAuthorizations',{'id':'bad'}),('environment','staging')]:
   with self.subTest(field=field):
    p=self.custody();p[field]=value
    with self.assertRaises(ValueError):self.validate(p)
 def test_hash_approval_and_purpose_are_independent(self):
  p=self.custody();raw=json.dumps(p).encode()
  with self.assertRaisesRegex(ValueError,'PAYLOAD_APPROVAL_HASH'):issuer.validate(p,'test-build','0'*64,raw)
  p['purpose']='migration'
  with self.assertRaises(ValueError):self.validate(p)
 def test_runtime_requires_exact_authority_and_manifest(self):
  p=dict(version=2,purpose='runtime-api',environment='production',issuedAt=dt.datetime.now(dt.timezone.utc).isoformat(),authorityFingerprint='wrong',minimumCustodySequence=9,authorizationId='approved-runtime-id',manifestSHA256='a'*64)
  with self.assertRaisesRegex(ValueError,'AUTHORITY_SEQUENCE'):self.validate(p)
 def test_release_cannot_use_durable_scope(self):
  p=self.custody();p['purpose']='release'
  with self.assertRaisesRegex(ValueError,'RELEASE_SCOPE'):self.validate(p)
if __name__=='__main__':unittest.main()
