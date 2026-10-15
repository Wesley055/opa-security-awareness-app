import unittest,importlib.util,pathlib,time,json,jwt,base64
from cryptography.hazmat.primitives.asymmetric import rsa
spec=importlib.util.spec_from_file_location('provider',pathlib.Path(__file__).with_name('release-operator-input.py'));P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P)
class Signature(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.private=rsa.generate_private_key(public_exponent=65537,key_size=2048);cls.key=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.private.public_key()));cls.key.update(kid='fixture',use='sig',alg='RS256')
 def token(self,audience=None,**changes):
  now=int(time.time());c={'oid':'operator','tid':P.TENANT,'aud':audience or P.VAULT_APP_ID,'exp':now+1564,'nbf':now-1,'iss':'https://sts.windows.net/'+P.TENANT+'/','ver':'1.0'};c.update(changes);return jwt.encode(c,self.private,algorithm='RS256',headers={'kid':'fixture'})
 def validate(self,token,resource=P.VAULT):
  claims=P.token_claims(token,{'operatorObjectId':'operator'},resource,min_seconds=660)
  P.verify_signature(token,claims,resource,get_keys=lambda u:{'keys':[self.key]})
 def test_exact_verified_guid_and_uri_formats_with_valid_signature(self):
  for audience in (P.VAULT,P.VAULT+'/',P.VAULT_APP_ID):self.validate(self.token(audience))
 def test_valid_v2_issuer_remains_tenant_pinned(self):self.validate(self.token(ver='2.0',iss='https://login.microsoftonline.com/'+P.TENANT+'/v2.0'))
 def test_arbitrary_audience_unknown_tenant_wrong_issuer_rejected(self):
  for change in ({'aud':'unapproved'},{'tid':'00000000-0000-0000-0000-000000000000'},{'iss':'https://attacker.invalid'},{'ver':'3.0'},{'oid':'another'}):
   with self.assertRaises(ValueError):self.validate(self.token(**change))
 def test_vault_guid_is_not_an_arm_audience(self):
  with self.assertRaisesRegex(ValueError,'AUDIENCE'):self.validate(self.token(),P.ARM)
 def test_expired_or_not_yet_valid_tokens_rejected(self):
  for c in ({'exp':int(time.time())-1},{'nbf':int(time.time())+3600}):
   with self.assertRaises(ValueError):self.validate(self.token(**c))
 def test_forged_signature_and_modified_payload_rejected(self):
  token=self.token();parts=token.split('.');sig=bytearray(base64.urlsafe_b64decode(parts[2]+'='*(-len(parts[2])%4)));sig[0]^=1;bad='.'.join(parts[:2]+[base64.urlsafe_b64encode(sig).decode().rstrip('=')])
  with self.assertRaisesRegex(ValueError,'SIGNATURE'):self.validate(bad)
  claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*(-len(parts[1])%4)));claims['exp']+=10;bad='.'.join([parts[0],base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('='),parts[2]])
  with self.assertRaisesRegex(ValueError,'SIGNATURE'):self.validate(bad)
 def test_unsigned_malformed_or_token_supplied_authority_rejected(self):
  for token in ('garbage','a.b.','a.b.c.d',jwt.encode({'exp':int(time.time())+3600},None,algorithm='none')):
   with self.assertRaises(ValueError):self.validate(token)
  c=jwt.decode(self.token(),options={'verify_signature':False});bad=jwt.encode(c,self.private,algorithm='RS256',headers={'kid':'fixture','jku':'https://attacker.invalid/keys'})
  with self.assertRaisesRegex(ValueError,'SIGNATURE'):self.validate(bad)
 def test_unknown_or_ambiguous_jwks_rejected(self):
  token=self.token();c=P.token_claims(token,{'operatorObjectId':'operator'},P.VAULT)
  for keys in ([],[self.key,self.key]):
   with self.assertRaisesRegex(ValueError,'SIGNATURE'):P.verify_signature(token,c,P.VAULT,get_keys=lambda u:{'keys':keys})
if __name__=='__main__':unittest.main(verbosity=2)
