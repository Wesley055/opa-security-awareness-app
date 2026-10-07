"""OPA production release-authority custody primitives.

Private authority bytes must never be written unprotected.
Windows DPAPI protects the serialized Ed25519 private key for the
current user. Public material and fingerprints are non-secret.

This module does not generate a production authority merely by being
imported or executed.
"""

import ctypes
import hashlib
import pathlib
from ctypes import wintypes

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


class AuthorityError(RuntimeError):
    pass


class Blob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def reject(code: str):
    raise AuthorityError(code)


def _crypt32():
    if not hasattr(ctypes, "WinDLL"):
        reject("WINDOWS_DPAPI_REQUIRED")
    return ctypes.WinDLL("crypt32", use_last_error=True)


def _kernel32():
    return ctypes.WinDLL("kernel32", use_last_error=True)


def public_der(private):
    return private.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def public_pem(private):
    return private.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def public_fingerprint(private):
    return hashlib.sha256(public_der(private)).hexdigest()


def serialize_private(private):
    return private.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


def protect_bytes(raw: bytes) -> bytes:
    if not raw:
        reject("EMPTY_PRIVATE_AUTHORITY")

    src_buf = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    src = Blob(len(raw), src_buf)
    dst = Blob()

    api = _crypt32()
    api.CryptProtectData.argtypes = [
        ctypes.POINTER(Blob),
        ctypes.c_wchar_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(Blob),
    ]
    api.CryptProtectData.restype = wintypes.BOOL

    if not api.CryptProtectData(
        ctypes.byref(src),
        "OPA production release authority",
        None,
        None,
        None,
        1,
        ctypes.byref(dst),
    ):
        reject("PROTECTED_AUTHORITY_WRITE_FAILED")

    try:
        return ctypes.string_at(dst.pbData, dst.cbData)
    finally:
        ctypes.memset(dst.pbData, 0, dst.cbData)
        _kernel32().LocalFree(ctypes.cast(dst.pbData, ctypes.c_void_p))
        ctypes.memset(src_buf, 0, len(raw))


def unprotect_bytes(encrypted: bytes) -> bytes:
    if not encrypted:
        reject("EMPTY_PROTECTED_AUTHORITY")

    src_buf = (ctypes.c_ubyte * len(encrypted)).from_buffer_copy(encrypted)
    src = Blob(len(encrypted), src_buf)
    dst = Blob()

    api = _crypt32()
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
        return ctypes.string_at(dst.pbData, dst.cbData)
    finally:
        ctypes.memset(dst.pbData, 0, dst.cbData)
        _kernel32().LocalFree(ctypes.cast(dst.pbData, ctypes.c_void_p))
        ctypes.memset(src_buf, 0, len(encrypted))


def load_private_from_protected(path: pathlib.Path):
    try:
        encrypted = path.read_bytes()
    except OSError as exc:
        raise AuthorityError("PROTECTED_AUTHORITY_READ_FAILED") from exc

    raw = bytearray(unprotect_bytes(encrypted))
    try:
        private = serialization.load_der_private_key(bytes(raw), password=None)
    except Exception as exc:
        raise AuthorityError("PRIVATE_AUTHORITY_PARSE_FAILED") from exc
    finally:
        for index in range(len(raw)):
            raw[index] = 0

    if not isinstance(private, Ed25519PrivateKey):
        reject("PRIVATE_AUTHORITY_TYPE_REJECTED")

    return private


def create_protected_authority(path: pathlib.Path):
    path = pathlib.Path(path)

    if path.exists():
        reject("AUTHORITY_ALREADY_EXISTS")

    if path.name != "authority.dpapi":
        reject("AUTHORITY_FILENAME_REJECTED")

    path.parent.mkdir(parents=True, exist_ok=True)

    private = Ed25519PrivateKey.generate()
    raw = bytearray(serialize_private(private))

    try:
        encrypted = protect_bytes(bytes(raw))
    finally:
        for index in range(len(raw)):
            raw[index] = 0

    try:
        with path.open("xb") as handle:
            handle.write(encrypted)
    except FileExistsError as exc:
        raise AuthorityError("AUTHORITY_ALREADY_EXISTS") from exc
    except OSError as exc:
        raise AuthorityError("PROTECTED_AUTHORITY_WRITE_FAILED") from exc

    recovered = load_private_from_protected(path)

    if public_der(recovered) != public_der(private):
        reject("PRIVATE_PUBLIC_AUTHORITY_MISMATCH")

    return {
        "publicPem": public_pem(recovered).decode("ascii"),
        "publicSha256": public_fingerprint(recovered),
    }
