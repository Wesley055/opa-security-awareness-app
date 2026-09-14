# Pinned staging validation runner

Node 22.23.2 and npm/npx 10.9.8 are copied from the digest-pinned Linux amd64 Node image.
No package manager or network download runs in the build steps.
The resulting image is retained on the approved operator host; it has not been published to a registry.
The supervisor accepts only image.lock.json's exact locally inspected image ID, not a mutable tag.
A rebuild with a different image ID must be reviewed and the lock deliberately updated.

Paths:
- /opt/opa/node22/bin/node
- /opt/opa/node22/bin/npm
- /opt/opa/node22/bin/npx
- cleanup: /home/runner/externals/node24/bin/node /opt/opa/signal-cleanup.cjs

Build from this directory using Docker build --platform linux/amd64 --network none.
Both FROM inputs are immutable digests. The build context excludes everything except the Dockerfile and two scripts.
The job toolchain is outside /opt/hostedtoolcache, which is masked by the runner's tmpfs.
The exact PATH is enforced before registration and before checkout.
The cleanup signal uses the immutable image's interpreter and script, so it does not require checkout, job Node, npm, or PATH.

Run the Node runner.test.cjs tests, Python test_runner_runtime.py tests, and test_image.py offline.
test_image.py uses no network, host mounts, credentials, registration or database access.
The supervisor retains allowlisted stage/command labels, numeric process outcomes, exception classes, timing and resource metadata.
It never serializes command arguments, exception strings, environment variables or child stdout/stderr.
Each cleanup step is isolated; any failed cleanup keeps the outcome fail-closed while the remaining steps still run.
Only a matching SHA/lease/action authorization is removed; foreign authorizations are preserved and reported as a cleanup failure.
Fresh SHA/policy/lease bindings and environment approval remain mandatory for a later protected run.
