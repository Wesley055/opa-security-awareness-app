"""Unsigned API policy payload for a new build: the currently deployed signed policy,
unchanged except for build and a fresh 23-hour expiry. Sign it with api-recovery-policy.py --sign."""
import argparse, base64, datetime as dt, json, pathlib, re

ap = argparse.ArgumentParser()
ap.add_argument('--previous', required=True)
ap.add_argument('--build', required=True)
ap.add_argument('--output', required=True)
a = ap.parse_args()
if not re.fullmatch(r'[0-9a-f]{40}', a.build): raise SystemExit('BUILD_MUST_BE_FULL_SHA')
p = json.loads(base64.b64decode(json.loads(pathlib.Path(a.previous).read_text(encoding='utf-8'))['payload']))
if p.get('purpose') != 'api' or p.get('environment') != 'production': raise SystemExit('NOT_AN_API_POLICY')
old = p.get('build', '')[:7]
p['build'] = a.build
p['expiresAt'] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=23)).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
pathlib.Path(a.output).open('x', encoding='utf-8').write(json.dumps(p, separators=(',', ':')))
print(f"PAYLOAD_OK carried {old} -> {a.build[:7]}; settings {len(p.get('settings', {}))}, secrets {len(p.get('secrets', {}))} unchanged")
