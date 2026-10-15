"""Offline API recovery policy issuer. Defaults to validation; signing is explicit.

Input contains resource IDs, settings, and versioned secret hashes, never passwords.
The deployed container must independently run its unchanged preflight before startup.
"""
import argparse, base64, datetime as dt, hashlib, importlib.util, json, pathlib

KID = 'opa-production-release-20261006'
FP = 'a3243b027e87ae180822b9a5e6fa8f962ba832d4eb7fe5c2cb6b387ce2755106'
PREFIX = '/subscriptions/b79ffdb2-0cf1-4915-89b4-2b6b7cae0299/resourceGroups/opa-production/providers/'
RESOURCES = {'app': PREFIX+'Microsoft.Web/sites/opa-api-production',
 'database': PREFIX+'Microsoft.DBforPostgreSQL/flexibleServers/opa-api-production-server',
 'vault': PREFIX+'Microsoft.KeyVault/vaults/opa-kv-production',
 'storage': PREFIX+'Microsoft.Storage/storageAccounts/opaproductionevidence'}

def validate_legacy_api(p, build, approved_hash, raw):
    if hashlib.sha256(raw).hexdigest() != approved_hash: raise ValueError('PAYLOAD_APPROVAL_HASH')
    if p.get('version') != 1 or p.get('purpose') != 'api' or p.get('environment') != 'production': raise ValueError('POLICY_SCOPE')
    if p.get('build') != build or not build: raise ValueError('BUILD_BINDING')
    now = dt.datetime.now(dt.timezone.utc)
    expiry = dt.datetime.fromisoformat(p['expiresAt'].replace('Z', '+00:00'))
    if not now < expiry <= now + dt.timedelta(hours=24): raise ValueError('BOUNDED_EXPIRY')
    for name, rid in RESOURCES.items():
        if p['resources'][name]['id'] != rid or p['resources'][name]['environment'] != 'production': raise ValueError('RESOURCE_BINDING')
    if p['resources']['database']['role'] != 'opa_production_runtime': raise ValueError('RUNTIME_ROLE')
    if p['resources']['database']['host'] != 'opa-api-production-server.postgres.database.azure.com': raise ValueError('DATABASE_HOST')
    if p['resources']['database']['database'] != 'opa-api-production-database': raise ValueError('DATABASE_NAME')
    if not isinstance(p.get('settings'), dict) or not isinstance(p.get('secrets'), dict): raise ValueError('ENVIRONMENT_BINDINGS')
    for binding in p['secrets'].values():
        if set(binding) != {'environment','vaultId','secretId','sha256'}: raise ValueError('SECRET_FIELDS')
        if binding['environment'] != 'production' or binding['vaultId'] != RESOURCES['vault']: raise ValueError('SECRET_VAULT')
        if not binding['secretId'].startswith('https://opa-kv-production.vault.azure.net/secrets/'): raise ValueError('SECRET_ID')
        if len(binding['secretId'].split('/')) != 6 or not binding['secretId'].split('/')[-1]: raise ValueError('SECRET_VERSION')
        if len(binding['sha256']) != 64 or any(c not in '0123456789abcdef' for c in binding['sha256']): raise ValueError('SECRET_HASH')

def validate(p, build, approved_hash, raw):
    if hashlib.sha256(raw).hexdigest() != approved_hash: raise ValueError('PAYLOAD_APPROVAL_HASH')
    purpose=p.get('purpose')
    if purpose == 'api': return validate_legacy_api(p,build,approved_hash,raw)
    if p.get('environment') != 'production': raise ValueError('POLICY_SCOPE')
    now=dt.datetime.now(dt.timezone.utc)
    if purpose in ('runtime-api','runtime-custody'):
        if p.get('version') != 2 or 'expiresAt' in p: raise ValueError('DURABLE_SCOPE')
        issued=dt.datetime.fromisoformat(p['issuedAt'].replace('Z','+00:00'))
        if issued > now: raise ValueError('ISSUED_AT')
        if purpose == 'runtime-api':
            if p.get('authorityFingerprint') != FP or not isinstance(p.get('minimumCustodySequence'),int) or p['minimumCustodySequence']<1: raise ValueError('AUTHORITY_SEQUENCE')
            if not isinstance(p.get('authorizationId'),str) or not 16<=len(p['authorizationId'])<=128: raise ValueError('AUTHORIZATION_ID')
            digest(p.get('manifestSHA256'))
            seconds=p.get('continuitySeconds',21600)
            if type(seconds) is not int or not 60<=seconds<=259200: raise ValueError('CONTINUITY_BOUND')
            policy=dict(p['policy'])
            if policy.get('version')!=1 or policy.get('purpose')!='api' or policy.get('environment')!='production': raise ValueError('RUNTIME_POLICY_SCOPE')
            policy['expiresAt']=(now+dt.timedelta(hours=1)).isoformat()
            policyraw=json.dumps(policy,separators=(',',':')).encode()
            validate_legacy_api(policy,build,hashlib.sha256(policyraw).hexdigest(),policyraw)
        else:
            if p.get('resourceId')!=RESOURCES['app'] or type(p.get('sequence')) is not int or p['sequence']<1: raise ValueError('CUSTODY_SCOPE')
            if not isinstance(p.get('activeAuthorizations'),dict) or not p['activeAuthorizations']: raise ValueError('CUSTODY_AUTHORIZATIONS')
            for value in p['activeAuthorizations'].values(): digest(value)
            for name in ('revokedAuthorizationIds','revokedAuthorityFingerprints'):
                if not isinstance(p.get(name),list) or any(not isinstance(x,str) for x in p[name]) or len(set(p[name]))!=len(p[name]): raise ValueError('REVOCATION_HISTORY')
            if any(x in p['activeAuthorizations'] for x in p['revokedAuthorizationIds']): raise ValueError('REVOKED_AUTHORIZATION')
        return
    if purpose != 'release' or p.get('version')!=1 or p.get('appResourceId')!=RESOURCES['app'] or not p.get('approvedByReference'): raise ValueError('RELEASE_SCOPE')
    start=dt.datetime.fromisoformat(p['approvedAt'].replace('Z','+00:00')); end=dt.datetime.fromisoformat(p['expiresAt'].replace('Z','+00:00'))
    if not start<=now<end or end-start>dt.timedelta(days=7): raise ValueError('RELEASE_WINDOW')
    if type(p.get('executionTimeoutSeconds')) is not int or not 60<=p['executionTimeoutSeconds']<=86400: raise ValueError('EXECUTION_BOUND')
    names={'api','apiManifest','runtimeAuthorization','custody','migrationArtifact','backup','rollbackApi','rollbackManifest','rollbackAuthorization'}
    if set(p.get('artifacts',{}))!=names or 42 not in p.get('rollbackAcceptedSchemas',[]): raise ValueError('RELEASE_ARTIFACT_SET')
    for artifact in p['artifacts'].values():
        if set(artifact)!={'path','sha256'} or not isinstance(artifact['path'],str): raise ValueError('ARTIFACT_BINDING')
        digest(artifact['sha256'])
    m=p['migration']; digest(p.get('migrationManifestSHA256'))
    if m.get('purpose')!='migration' or m.get('build')!=build or m.get('approvalId')!=p.get('releaseId') or m.get('approvedAt')!=p['approvedAt'] or m.get('expiresAt')!=p['expiresAt'] or m.get('executionTimeoutSeconds')!=p['executionTimeoutSeconds'] or m.get('artifactSha256')!=p['migrationManifestSHA256'] or m.get('backupSha256')!=p['artifacts']['backup']['sha256']: raise ValueError('MIGRATION_BINDING')
    if m['resources']['database']['role']!='opa_production_migrations' or m['resources']['app']['id']!=RESOURCES['app']: raise ValueError('MIGRATION_IDENTITY')

def digest(value):
    if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value): raise ValueError('SHA256')

def main():
    ap=argparse.ArgumentParser()
    for name in ['payload','build','approved-payload-sha256']: ap.add_argument('--'+name, required=True)
    ap.add_argument('--sign',action='store_true'); ap.add_argument('--output'); ap.add_argument('--authority'); ap.add_argument('--authority-module')
    a=ap.parse_args(); raw=pathlib.Path(a.payload).read_bytes(); p=json.loads(raw)
    validate(p,a.build,a.approved_payload_sha256,raw)
    if not a.sign: print('PAYLOAD_VALIDATION_PASS; UNSIGNED'); return
    if not all([a.output,a.authority,a.authority_module]): raise ValueError('SIGNING_INPUTS')
    spec=importlib.util.spec_from_file_location('custody',a.authority_module); custody=importlib.util.module_from_spec(spec); spec.loader.exec_module(custody)
    private=custody.load_private_from_protected(pathlib.Path(a.authority))
    if custody.public_fingerprint(private)!=FP: raise ValueError('SIGNER_FINGERPRINT')
    signature=private.sign(raw); private.public_key().verify(signature,raw)
    envelope={'keyId':KID,'payload':base64.b64encode(raw).decode(),'signature':base64.b64encode(signature).decode()}
    with pathlib.Path(a.output).open('x',encoding='utf-8') as f: json.dump(envelope,f,separators=(',',':'))
    print('SIGNATURE_VERIFIED; '+hashlib.sha256(pathlib.Path(a.output).read_bytes()).hexdigest())

if __name__=='__main__': main()
