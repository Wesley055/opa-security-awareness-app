"""Build an unsigned API policy payload that rebinds ONE secret to a new Key Vault version.

Takes the currently deployed signed policy, keeps every other binding unchanged, and
replaces the named secret's secretId (must carry a version) and sha256. The secret value
itself is never read here: pass only its SHA-256 (hex of the exact UTF-8 value).
Sign the result with api-recovery-policy.py --sign, as for any release.
"""
import argparse, base64, datetime as dt, json, pathlib, re

ap = argparse.ArgumentParser()
ap.add_argument('--previous', required=True, help='currently deployed signed policy (envelope JSON)')
ap.add_argument('--build', required=True, help='full git SHA of the build that will run with this policy')
ap.add_argument('--name', required=True, help='environment variable name, e.g. AFRICASTALKING_API_KEY')
ap.add_argument('--secret-id', required=True, help='versioned Key Vault secret id')
ap.add_argument('--value-sha256', required=True)
ap.add_argument('--output', required=True)
a = ap.parse_args()

envelope = json.loads(pathlib.Path(a.previous).read_text(encoding='utf-8'))
p = json.loads(base64.b64decode(envelope['payload']))
if p.get('purpose') != 'api' or p.get('environment') != 'production': raise SystemExit('NOT_AN_API_POLICY')
if a.name not in p['secrets']: raise SystemExit('UNKNOWN_SECRET ' + a.name)
if not re.fullmatch(r'[0-9a-f]{40}', a.build): raise SystemExit('BUILD_MUST_BE_FULL_SHA')
if not re.fullmatch(r'[0-9a-f]{64}', a.value_sha256): raise SystemExit('VALUE_SHA256')
parts = a.secret_id.split('/')
if not a.secret_id.startswith('https://opa-kv-production.vault.azure.net/secrets/') or len(parts) != 6 or not parts[-1]:
    raise SystemExit('SECRET_ID_MUST_BE_VERSIONED')

old = p['secrets'][a.name]
if old['sha256'] == a.value_sha256: raise SystemExit('VALUE_UNCHANGED')
p['secrets'][a.name] = {**old, 'secretId': a.secret_id, 'sha256': a.value_sha256}
p['build'] = a.build
p['expiresAt'] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=23)).replace(microsecond=0).isoformat().replace('+00:00', 'Z')

pathlib.Path(a.output).open('x', encoding='utf-8').write(json.dumps(p, separators=(',', ':')))
print(f"PAYLOAD_OK {a.name}: version {old['secretId'].split('/')[-1][:8]}… -> {parts[-1][:8]}…; other bindings unchanged")
