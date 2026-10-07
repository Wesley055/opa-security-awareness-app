"""Create an OPA release signing authority.

Production mode is deliberately narrow:
- exact production key ID
- canonical Windows DPAPI custody path
- no overwrite
- private material never printed
- stdout contains non-secret enrollment metadata only

The --test-output option is accepted only with --environment test and exists
solely so the real command path can be exercised with disposable authorities.
"""

import argparse
import json
import os
import pathlib
import sys

import authority


PRODUCTION_KEY_ID = "opa-production-release-20261006"


def production_path():
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise authority.AuthorityError("LOCALAPPDATA_REQUIRED")

    return (
        pathlib.Path(local)
        / "OPA"
        / "Production"
        / "ReleaseAuthority-20261006"
        / "authority.dpapi"
    )


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--environment",
        required=True,
        choices=("production", "test"),
    )
    parser.add_argument("--key-id", required=True)
    parser.add_argument("--test-output")
    return parser.parse_args()


def resolve_path(args):
    if args.environment == "production":
        if args.key_id != PRODUCTION_KEY_ID:
            raise authority.AuthorityError("PRODUCTION_KEY_ID_REJECTED")
        if args.test_output:
            raise authority.AuthorityError("PRODUCTION_PATH_OVERRIDE_REJECTED")
        return production_path()

    if args.key_id == PRODUCTION_KEY_ID:
        raise authority.AuthorityError("PRODUCTION_KEY_ID_FORBIDDEN_IN_TEST")

    if not args.test_output:
        raise authority.AuthorityError("TEST_OUTPUT_REQUIRED")

    path = pathlib.Path(args.test_output).resolve()

    if path.name != "authority.dpapi":
        raise authority.AuthorityError("AUTHORITY_FILENAME_REJECTED")

    return path


def main():
    args = parse_args()
    path = resolve_path(args)

    result = authority.create_protected_authority(path)

    receipt = {
        "version": 1,
        "environment": args.environment,
        "keyId": args.key_id,
        "custody": "windows-dpapi-current-user",
        "publicPem": result["publicPem"],
        "publicSha256": result["publicSha256"],
        "authorityCreated": True,
        "privateMaterialExported": False,
    }

    print(json.dumps(receipt, indent=2))


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
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
