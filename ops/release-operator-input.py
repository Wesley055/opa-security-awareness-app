"""Existing operator CLI credentials, returned only in memory to the cutover driver."""
import os,json,subprocess,pathlib,hashlib,base64,urllib.parse,urllib.request,fnmatch,time,sys,re

def custody_permission(call,resource,oid):
    target=resource+'/secrets/opa-api-runtime-custody'
    assignments=call(['role','assignment','list','--assignee',oid,'--scope',target,'--include-inherited','--include-groups'])
    if not isinstance(assignments,list): return False
    definitions={};permissions=[]
    for assignment in assignments:
        scope=assignment.get('scope','').lower().rstrip('/')
        if not scope or not (target.lower()==scope or target.lower().startswith(scope+'/')) or assignment.get('condition'): continue
        role=assignment.get('roleDefinitionId','').rsplit('/',1)[-1]
        if role not in definitions: definitions[role]=call(['role','definition','list','--name',role])
        definitions_for_role=definitions[role]
        if isinstance(definitions_for_role,list):
            for definition in definitions_for_role: permissions.extend(definition.get('permissions',[]))
    def covers(action):
        return any(any(fnmatch.fnmatchcase(action.lower(),x.lower()) for x in (p.get('dataActions') or [])) and not any(fnmatch.fnmatchcase(action.lower(),x.lower()) for x in (p.get('notDataActions') or [])) for p in permissions)
    return all(covers('Microsoft.KeyVault/vaults/secrets/'+operation+'/action') for operation in ('getSecret','setSecret'))


TENANT='adb3fb59-1ac3-42c2-b39a-d70c7006ccbc'
SUBSCRIPTION='b79ffdb2-0cf1-4915-89b4-2b6b7cae0299'
ARM='https://management.azure.com/'
VAULT='https://vault.azure.net'
# Verified against the enabled Azure Key Vault service principal in the pinned AzureCloud tenant.
VAULT_APP_ID='cfa8b339-82a2-471a-a3c9-0fc0be7a4093'

def token_claims(token,manifest,resource,now=None,min_seconds=60):
    if resource not in (ARM,VAULT):raise ValueError('RELEASE_TOKEN_RESOURCE')
    try:
        parts=token.split('.');assert len(parts)==3 and all(re.fullmatch(r'[A-Za-z0-9_-]+',v) for v in parts) and len(token)<=65536
        part=parts[1];claims=json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4)));assert isinstance(claims,dict)
    except Exception:raise ValueError('RELEASE_TOKEN_FORMAT') from None
    if claims.get('oid')!=manifest.get('operatorObjectId') or claims.get('tid')!=TENANT:raise ValueError('APPROVED_OPERATOR_IDENTITY_REQUIRED')
    audiences=(ARM,'https://management.core.windows.net/') if resource==ARM else (VAULT,VAULT+'/',VAULT_APP_ID)
    if claims.get('aud') not in audiences:raise ValueError('RELEASE_TOKEN_AUDIENCE')
    issuer=expected_issuer(claims)
    if claims.get('iss')!=issuer:raise ValueError('RELEASE_TOKEN_ISSUER')
    now=time.time() if now is None else now
    if type(min_seconds) is not int or not 60<=min_seconds<=660:raise ValueError('RELEASE_TOKEN_DEADLINE')
    if not isinstance(claims.get('exp'),(int,float)) or claims['exp']<now+min_seconds or claims.get('nbf',0)>now+30:raise ValueError('RELEASE_TOKEN_LIFETIME')
    return claims


def expected_issuer(claims):
    version=claims.get('ver')
    if version=='1.0':return 'https://sts.windows.net/'+TENANT+'/'
    if version=='2.0':return 'https://login.microsoftonline.com/'+TENANT+'/v2.0'
    raise ValueError('RELEASE_TOKEN_VERSION')

_PUBLIC_KEYS={}
def verify_signature(token,claims,resource,get_keys=None):
    # Same pinned Entra authority/RS256 model as the existing App Service verifier;
    # never use token-supplied discovery, jku or x5u. Azure also verifies on use.
    try:
        import jwt
        header=jwt.get_unverified_header(token)
        if header.get('alg')!='RS256' or not isinstance(header.get('kid'),str) or any(k in header for k in ('jku','x5u','crit')):raise ValueError('RELEASE_TOKEN_SIGNATURE')
        issuer=expected_issuer(claims);version=claims['ver'];url='https://login.microsoftonline.com/'+TENANT+'/discovery/'+('v2.0/' if version=='2.0' else '')+'keys'
        if get_keys is None:
            if version not in _PUBLIC_KEYS:
                class NoRedirect(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self,*args,**kwargs):return None
                with urllib.request.build_opener(NoRedirect()).open(url,timeout=10) as response:
                    raw=response.read(1048577)
                if len(raw)>1048576:raise ValueError('RELEASE_TOKEN_SIGNATURE')
                _PUBLIC_KEYS[version]=json.loads(raw)
            document=_PUBLIC_KEYS[version]
        else:document=get_keys(url)
        keys=document.get('keys',[])
        if not isinstance(keys,list) or len(keys)>100:raise ValueError('RELEASE_TOKEN_SIGNATURE')
        matching=[k for k in keys if k.get('kid')==header['kid'] and k.get('kty')=='RSA' and k.get('use')=='sig' and k.get('alg','RS256')=='RS256']
        if len(matching)!=1:raise ValueError('RELEASE_TOKEN_SIGNATURE')
        key=matching[0]
        if key.get('issuer') and key['issuer'].replace('{tenantid}',TENANT)!=issuer:raise ValueError('RELEASE_TOKEN_SIGNATURE')
        public=jwt.PyJWK.from_dict(key).key
        if public.key_size<2048:raise ValueError('RELEASE_TOKEN_SIGNATURE')
        audiences=[ARM,'https://management.core.windows.net/'] if resource==ARM else [VAULT,VAULT+'/',VAULT_APP_ID]
        jwt.decode(token,public,algorithms=['RS256'],audience=audiences,issuer=issuer,options={'require':['exp','nbf','iss','aud','tid','oid']})
    except Exception:raise ValueError('RELEASE_TOKEN_SIGNATURE') from None

def silent_refresh(resource):
    # The installed Azure CLI UserCredential supports MSAL force_refresh. Never
    # invoke interactive authentication, change the account or clear its cache.
    try:
        from azure.cli.core import get_default_cli
        from azure.cli.core._profile import Profile
        from azure.cli.core.auth.util import resource_to_scopes
        profile=Profile(cli_ctx=get_default_cli());account=profile.get_subscription()
        if account.get('id')!=SUBSCRIPTION or account.get('tenantId')!=TENANT or account.get('user',{}).get('type')!='user':raise ValueError('APPROVED_OPERATOR_IDENTITY_REQUIRED')
        credential=profile._create_credential(account,tenant_id=TENANT)
        http=credential._msal_app.http_client
        for method in ('get','post'):
            original=getattr(http,method)
            setattr(http,method,lambda *args,_original=original,**kwargs:_original(*args,**{**kwargs,'timeout':15}))
        # Calling MSAL directly guarantees no interactive fallback.
        result=credential._msal_app.acquire_token_silent_with_error(resource_to_scopes(resource),credential._account,force_refresh=True)
        if not isinstance(result,dict) or not isinstance(result.get('access_token'),str):raise ValueError('RELEASE_TOKEN_REFRESH_REJECTED')
        token=result.pop('access_token');result.clear();return token
    except Exception:raise ValueError('RELEASE_TOKEN_REFRESH_REJECTED') from None

def fresh_token(manifest,resource,call,force=False,refresh=silent_refresh,min_seconds=60,signature_verifier=None):
    signature_verifier=verify_signature if signature_verifier is None else signature_verifier
    if resource not in (ARM,VAULT):raise ValueError('RELEASE_TOKEN_RESOURCE')
    if force:
        token=refresh(resource);claims=token_claims(token,manifest,resource,min_seconds=min_seconds);signature_verifier(token,claims,resource);return token
    answer=call(['account','get-access-token','--resource',resource])
    try:token=answer['accessToken']
    finally:answer.clear()
    try:claims=token_claims(token,manifest,resource,min_seconds=min_seconds);signature_verifier(token,claims,resource);return token
    except ValueError as error:
        if str(error)!='RELEASE_TOKEN_LIFETIME':raise
    # One bounded silent refresh for a stale cached token, not an operation replay.
    token=refresh(resource);claims=token_claims(token,manifest,resource,min_seconds=min_seconds);signature_verifier(token,claims,resource);return token

def approved_payload(file,approved):
    raw=pathlib.Path(file).read_bytes()
    if os.environ.get('OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256')!=approved or hashlib.sha256(raw).hexdigest()!=approved:raise ValueError('EXPLICIT_FINAL_CUTOVER_AUTHORIZATION_REQUIRED')
    return json.loads(base64.b64decode(json.loads(raw)['payload']))

def token_bridge(file,approved,resource,force=False,min_seconds=60):
    manifest=approved_payload(file,approved)
    if manifest.get('executionTools',{}).get('ops/release-operator-input.py')!=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest():raise ValueError('EXECUTION_TOOL_CHANGED')
    az=os.environ.get('OPA_OPERATOR_AZ_CLI','az.cmd' if os.name=='nt' else 'az')
    def call(args):
        result=subprocess.run([az]+args+['--output','json','--only-show-errors'],capture_output=True,text=True,timeout=20)
        if result.returncode:raise ValueError('EXISTING_OPERATOR_ACCESS_REJECTED')
        return json.loads(result.stdout)
    return fresh_token(manifest,resource,call,force=force,min_seconds=min_seconds)

def credentials(file,approved,reference):
    if os.environ.get('OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256')!=approved or hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()!=approved: raise ValueError('EXPLICIT_FINAL_CUTOVER_AUTHORIZATION_REQUIRED')
    manifest=json.loads(base64.b64decode(json.loads(pathlib.Path(file).read_bytes())['payload']))
    expected=manifest.get('operatorCredentialBindings',{})
    if expected!=reference or set(reference)!={'adminRole','adminPasswordSecretId'}: raise ValueError('APPROVED_OPERATOR_CUSTODY_REFERENCE_REQUIRED')
    secret_id=reference['adminPasswordSecretId'];prefix='https://opa-kv-production.vault.azure.net/secrets/opa-production-postgresql-admin-password/'
    if not secret_id.startswith(prefix) or len(secret_id[len(prefix):])!=32 or any(c not in '0123456789abcdef' for c in secret_id[len(prefix):]): raise ValueError('VERSIONED_OPERATOR_ADMIN_SECRET_REQUIRED')
    if reference['adminRole'] in ('opa_production_runtime','opa_production_migrations','opa_production_release_owner') or not reference['adminRole']: raise ValueError('SEPARATE_ADMIN_IDENTITY_REQUIRED')
    env={k:v for k,v in os.environ.items() if k.upper() in ('PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOME','COMSPEC','AZURE_CONFIG_DIR')}
    az=os.environ.get('OPA_OPERATOR_AZ_CLI','az.cmd' if os.name=='nt' else 'az')
    def call(args):
        p=subprocess.run([az]+args+['--output','json','--only-show-errors'],env=env,capture_output=True,text=True,timeout=120)
        if p.returncode: raise ValueError('EXISTING_OPERATOR_ACCESS_REJECTED')
        return json.loads(p.stdout)
    arm={'accessToken':fresh_token(manifest,ARM,call)}
    part=arm['accessToken'].split('.')[1];claims=json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4)))
    if claims.get('oid')!=manifest.get('operatorObjectId'): raise ValueError('APPROVED_OPERATOR_IDENTITY_REQUIRED')
    resource='/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/Microsoft.KeyVault/vaults/opa-kv-production'
    properties=call(['rest','--method','GET','--url','https://management.azure.com'+resource+'?api-version=2023-07-01'])['properties']
    if properties.get('enableRbacAuthorization'):
        authorized=custody_permission(call,resource,claims['oid'])
    else:
        authorized=any(p.get('objectId','').lower()==claims['oid'].lower() and any(x.lower() in ('set','all') for x in p.get('permissions',{}).get('secrets',[])) for p in properties.get('accessPolicies',[]))
    if not authorized: raise ValueError('OPERATOR_CUSTODY_WRITE_PERMISSION_NOT_VERIFIED')
    vault={'accessToken':fresh_token(manifest,VAULT,call)}
    scm=call(['webapp','deployment','list-publishing-credentials','--resource-group','opa-production','--name','opa-api-production'])
    secret=call(['keyvault','secret','show','--id',secret_id])
    try:
        if secret.get('id')!=secret_id or secret.get('attributes',{}).get('enabled') is False: raise ValueError('OPERATOR_ADMIN_SECRET_VERSION_DRIFT')
        url='postgresql://'+urllib.parse.quote(reference['adminRole'],safe='')+':'+urllib.parse.quote(secret['value'],safe='')+'@opa-api-production-server.postgres.database.azure.com:5432/opa-api-production-database?sslmode=require&sslaccept=strict'
        return {'OPA_RELEASE_ARM_TOKEN':arm['accessToken'],'OPA_RELEASE_VAULT_TOKEN':vault['accessToken'],'OPA_RELEASE_SCM_AUTHORIZATION':'Basic '+base64.b64encode((scm['publishingUserName']+':'+scm['publishingPassword']).encode()).decode(),'OPA_RELEASE_ADMIN_DATABASE_URL':url}
    finally: arm.clear();vault.clear();scm.clear();secret.clear()

if __name__=='__main__':
    # Only the verified Node controller consumes this private stdout pipe.
    try:
        if len(sys.argv)!=7 or sys.argv[1]!='--token' or sys.argv[5] not in ('cached','refresh'):raise ValueError('USE_EXECUTE_RELEASE_ENTRYPOINT')
        print(json.dumps({'token':token_bridge(sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5]=='refresh',int(sys.argv[6]))}))
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and str(error).replace('_','').isalnum() and str(error).isupper() else 'RELEASE_TOKEN_ACQUISITION_FAILED'
        print(code,file=sys.stderr);raise SystemExit(1)
