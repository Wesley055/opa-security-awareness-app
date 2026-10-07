"""Tests for OPA production release-authority custody primitives.

All authorities created here are disposable, ephemeral test authorities.
No production authority path or production key ID is used.
"""

import pathlib
import tempfile
import unittest

import authority


class AuthorityTests(unittest.TestCase):
    def test_dpapi_round_trip_preserves_ed25519_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "authority.dpapi"

            created = authority.create_protected_authority(path)

            self.assertTrue(path.exists())
            self.assertGreater(path.stat().st_size, 0)
            self.assertIn("BEGIN PUBLIC KEY", created["publicPem"])
            self.assertEqual(len(created["publicSha256"]), 64)

            recovered = authority.load_private_from_protected(path)

            self.assertEqual(
                authority.public_pem(recovered).decode("ascii"),
                created["publicPem"],
            )
            self.assertEqual(
                authority.public_fingerprint(recovered),
                created["publicSha256"],
            )

    def test_creation_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "authority.dpapi"

            authority.create_protected_authority(path)

            with self.assertRaisesRegex(
                authority.AuthorityError,
                "AUTHORITY_ALREADY_EXISTS",
            ):
                authority.create_protected_authority(path)

    def test_creation_requires_canonical_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "private.key"

            with self.assertRaisesRegex(
                authority.AuthorityError,
                "AUTHORITY_FILENAME_REJECTED",
            ):
                authority.create_protected_authority(path)

            self.assertFalse(path.exists())

    def test_empty_protected_authority_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "authority.dpapi"
            path.write_bytes(b"")

            with self.assertRaisesRegex(
                authority.AuthorityError,
                "EMPTY_PROTECTED_AUTHORITY",
            ):
                authority.load_private_from_protected(path)

    def test_corrupted_protected_authority_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "authority.dpapi"

            authority.create_protected_authority(path)
            data = bytearray(path.read_bytes())
            data[len(data) // 2] ^= 0x01
            path.write_bytes(data)

            with self.assertRaises(authority.AuthorityError):
                authority.load_private_from_protected(path)

    def test_missing_authority_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "authority.dpapi"

            with self.assertRaisesRegex(
                authority.AuthorityError,
                "PROTECTED_AUTHORITY_READ_FAILED",
            ):
                authority.load_private_from_protected(path)


if __name__ == "__main__":
    unittest.main()
