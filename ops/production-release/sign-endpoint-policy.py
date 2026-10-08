"""Issue a signed production endpoint policy for OPA.

Places the envelope at packages/environment-policy/release/production-endpoint.json,
which is the path apps/mobile-app/eas.json binds through OPA_ENDPOINT_POLICY_FILE.

Fail-closed by design. The policy is signed only after a live, TLS-verified,
redirect-free probe of /health/environment confirms the environment, the build
and migrationReadiness=ready. httpsVerifiedAt records that probe, so it is a
fact rather than a claim.

Run from the repository root:

    python ops\\production-release\\sign-endpoint-policy.py

Useful switches:
    --expect-build <sha>   assert the deployed build before signing
    --days <n>             policy lifetime (default 90)
    --authority <path>     DPAPI blob location, if not the default
    --dry-run              probe and build the payload, sign nothing, write nothing
"""

import argparse
import base64
import ctypes
import datetime
import hashlib
import json
import os
import pathlib
import urllib.request
from ctypes import wintypes

from cryptography.hazmat.primitives import serialization

# ops/production-release/sign-endpoint-policy.py -> repository root
ROOT = pathlib.Path(__file__).resolve().parents[2]
REGISTRY_FILE = ROOT / "packages" / "environment-policy" / "trusted-signers.json"
OUTPUT_FILE = ROOT / "packages" / "environment-policy" / "release" / "production-endpoint.json"
RECEIPT_FILE = ROOT / "docs" / "releases" / "production-endpoint-receipt.json"

ENVIRONMENT = "production"
PURPOSE = "endpoint"
KID = "opa-production-release-20261006"

# SHA-256 of the enrolled public key in SubjectPublicKeyInfo DER form.
FINGERPRINT = "a3243b027e87ae180822b9a5e6fa8f962ba832d4eb7fe5c2cb6b387ce2755106"

# Must equal its own URL origin exactly: https, no credentials, no query,
# no fragment, no trailing slash. packages/environment-policy/index.cjs
# rejects anything else in httpsOrigin().
API_ORIGIN = (
    "https://opa-api-production-g4f6cxdyanfbaub0.southafricanorth-01.azurewebsites.net"
)

DEFAULT_AUTHORITY = (
    pathlib.Path(os.environ.get("LOCALAPPDATA", ""))
    / "OPA"
    / "Production"
    / "ReleaseAuthority-20261006"
    / "authority.dpapi"
)

DEFAULT_EXPECTED_BUILD = "b02a851f6fbe369661e3e3fc68d02898851278ba"


class Blob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """verify-endpoint.cjs does not follow redirects; neither does this."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def reject(message):
    raise RuntimeError(message)


def probe_endpoint():
    """TLS-verified, redirect-free read of /health/environment.

    Returns the parsed body. Certificate validation is never disabled.
    """
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(
        API_ORIGIN + "/health/environment",
        headers={"Accept": "application/json"},
    )

    with opener.open(request, timeout=15) as response:
        if response.status != 200:
            reject("ENDPOINT_STATUS_REJECTED_" + str(response.status))
        body = response.read(8192)

    data = json.loads(body.decode("utf-8"))

    if data.get("environment") != ENVIRONMENT:
        reject("ENDPOINT_ENVIRONMENT_REJECTED")
    if not isinstance(data.get("build"), str) or not data["build"]:
        reject("ENDPOINT_BUILD_MISSING")
    if data.get("migrationReadiness") != "ready":
        reject("ENDPOINT_MIGRATION_READINESS_REJECTED")

    return data


def recover_authority(authority_path):
    """Load the enrolled public key, then unprotect and match the private half."""
    registry = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))

    pem = registry.get(ENVIRONMENT, {}).get(KID)
    if not pem:
        reject("SIGNER_NOT_ENROLLED")

    public = serialization.load_pem_public_key(pem.encode())
    public_der = public.public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    if hashlib.sha256(public_der).hexdigest() != FINGERPRINT:
        reject("PUBLIC_AUTHORITY_REJECTED")

    if not authority_path.is_file():
        reject("PROTECTED_AUTHORITY_NOT_FOUND")

    encrypted = authority_path.read_bytes()
    if not encrypted:
        reject("PROTECTED_AUTHORITY_EMPTY")

    buf = (ctypes.c_ubyte * len(encrypted)).from_buffer_copy(encrypted)
    src = Blob(len(encrypted), buf)
    dst = Blob()

    api = ctypes.WinDLL("crypt32", use_last_error=True)
    api.CryptUnprotectData.argtypes = [
        ctypes.POINTER(Blob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(Blob),
    ]
    api.CryptUnprotectData.restype = wintypes.BOOL

    if not api.CryptUnprotectData(
        ctypes.byref(src), None, None, None, None, 1, ctypes.byref(dst)
    ):
        reject("PROTECTED_AUTHORITY_RECOVERY_FAILED")

    try:
        private = serialization.load_der_private_key(
            ctypes.string_at(dst.pbData, dst.cbData),
            password=None,
        )
    finally:
        ctypes.memset(dst.pbData, 0, dst.cbData)
        ctypes.WinDLL("kernel32").LocalFree(ctypes.cast(dst.pbData, ctypes.c_void_p))

    recovered_der = private.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    if recovered_der != public_der:
        reject("PRIVATE_PUBLIC_AUTHORITY_MISMATCH")

    return private, public


def stamp(moment):
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect-build", default=DEFAULT_EXPECTED_BUILD)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--authority", type=pathlib.Path, default=DEFAULT_AUTHORITY)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not 1 <= args.days <= 365:
        reject("POLICY_LIFETIME_REJECTED")

    observed = probe_endpoint()
    verified_at = datetime.datetime.now(datetime.timezone.utc)
    build = observed["build"]

    if args.expect_build and build != args.expect_build:
        reject("DEPLOYED_BUILD_REJECTED_" + build)

    payload = {
        "version": 1,
        "environment": ENVIRONMENT,
        "purpose": PURPOSE,
        "apiOrigin": API_ORIGIN,
        "build": build,
        # Must be in the past when the policy is read; it is the moment the
        # probe above succeeded.
        "httpsVerifiedAt": stamp(verified_at),
        "expiresAt": stamp(verified_at + datetime.timedelta(days=args.days)),
    }

    # The signature covers these exact bytes. Compact separators, no BOM.
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    if args.dry_run:
        print("RESULT=DRY_RUN")
        print("DEPLOYED_BUILD=" + build)
        print("MIGRATION_READINESS=" + observed["migrationReadiness"])
        print("HTTPS_VERIFIED_AT=" + payload["httpsVerifiedAt"])
        print("EXPIRES_AT=" + payload["expiresAt"])
        print("POLICY_SHA256=" + hashlib.sha256(raw).hexdigest())
        print("SIGNED=false")
        print("WRITTEN=false")
        return

    private, public = recover_authority(args.authority)

    try:
        signature = private.sign(raw)
        public.verify(signature, raw)
    finally:
        private = None

    envelope = {
        "keyId": KID,
        "payload": base64.b64encode(raw).decode("ascii"),
        "signature": base64.b64encode(signature).decode("ascii"),
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(envelope, indent=2) + "\n", encoding="utf-8")

    # Verify the exact bytes that landed on disk, not the ones in memory.
    written = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
    written_raw = base64.b64decode(written["payload"])
    public.verify(base64.b64decode(written["signature"]), written_raw)

    if written_raw != raw:
        reject("WRITTEN_PAYLOAD_DRIFT")
    if OUTPUT_FILE.read_bytes().startswith(b"\xef\xbb\xbf"):
        reject("WRITTEN_ENVELOPE_BOM")

    policy_hash = hashlib.sha256(raw).hexdigest()
    envelope_hash = hashlib.sha256(OUTPUT_FILE.read_bytes()).hexdigest()

    receipt = {
        "version": 1,
        "purpose": "production-endpoint-policy-issuance",
        "environment": ENVIRONMENT,
        "keyId": KID,
        "signerFingerprintSha256": FINGERPRINT,
        "apiOrigin": API_ORIGIN,
        "build": build,
        "observedMigrationReadiness": observed["migrationReadiness"],
        "httpsVerifiedAt": payload["httpsVerifiedAt"],
        "expiresAt": payload["expiresAt"],
        "policySha256": policy_hash,
        "envelopeSha256": envelope_hash,
        "policyPath": str(OUTPUT_FILE.relative_to(ROOT)).replace("\\", "/"),
        "signatureVerified": True,
    }

    RECEIPT_FILE.parent.mkdir(parents=True, exist_ok=True)
    RECEIPT_FILE.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")

    print("RESULT=PASS")
    print("KEY_ID=" + KID)
    print("BUILD=" + build)
    print("MIGRATION_READINESS=" + observed["migrationReadiness"])
    print("HTTPS_VERIFIED_AT=" + payload["httpsVerifiedAt"])
    print("EXPIRES_AT=" + payload["expiresAt"])
    print("POLICY_SHA256=" + policy_hash)
    print("ENVELOPE_SHA256=" + envelope_hash)
    print("POLICY_FILE=" + str(OUTPUT_FILE))
    print("RECEIPT_FILE=" + str(RECEIPT_FILE))
    print("SIGNATURE_VERIFIED=true")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(
            json.dumps(
                {
                    "result": "FAIL",
                    "class": type(exc).__name__,
                    "message": str(exc),
                }
            )
        )
        raise SystemExit(1)
