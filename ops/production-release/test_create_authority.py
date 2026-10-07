"""Boundary tests for the OPA release-authority creation CLI."""

import importlib.util
import pathlib
import tempfile
import types
import unittest


ROOT = pathlib.Path(__file__).parent
SCRIPT = ROOT / "create-authority.py"

spec = importlib.util.spec_from_file_location("create_authority", SCRIPT)
create = importlib.util.module_from_spec(spec)
spec.loader.exec_module(create)


class CreateAuthorityTests(unittest.TestCase):
    def args(self, environment, key_id, test_output=None):
        return types.SimpleNamespace(
            environment=environment,
            key_id=key_id,
            test_output=test_output,
        )

    def test_production_requires_exact_successor_key_id(self):
        with self.assertRaisesRegex(
            create.authority.AuthorityError,
            "PRODUCTION_KEY_ID_REJECTED",
        ):
            create.resolve_path(
                self.args("production", "opa-production-release-wrong")
            )

    def test_production_rejects_path_override(self):
        with self.assertRaisesRegex(
            create.authority.AuthorityError,
            "PRODUCTION_PATH_OVERRIDE_REJECTED",
        ):
            create.resolve_path(
                self.args(
                    "production",
                    create.PRODUCTION_KEY_ID,
                    r"C:\temp\authority.dpapi",
                )
            )

    def test_test_mode_cannot_use_production_key_id(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                create.authority.AuthorityError,
                "PRODUCTION_KEY_ID_FORBIDDEN_IN_TEST",
            ):
                create.resolve_path(
                    self.args(
                        "test",
                        create.PRODUCTION_KEY_ID,
                        str(pathlib.Path(directory) / "authority.dpapi"),
                    )
                )

    def test_test_mode_requires_explicit_output(self):
        with self.assertRaisesRegex(
            create.authority.AuthorityError,
            "TEST_OUTPUT_REQUIRED",
        ):
            create.resolve_path(
                self.args("test", "opa-test-release-fixture")
            )

    def test_test_mode_requires_canonical_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                create.authority.AuthorityError,
                "AUTHORITY_FILENAME_REJECTED",
            ):
                create.resolve_path(
                    self.args(
                        "test",
                        "opa-test-release-fixture",
                        str(pathlib.Path(directory) / "private.key"),
                    )
                )

    def test_test_mode_accepts_disposable_authority_path(self):
        with tempfile.TemporaryDirectory() as directory:
            expected = (
                pathlib.Path(directory) / "authority.dpapi"
            ).resolve()

            actual = create.resolve_path(
                self.args(
                    "test",
                    "opa-test-release-fixture",
                    str(expected),
                )
            )

            self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
