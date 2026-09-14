# Protected Azure disposable validation

The workflow requires self-hosted, linux, opa-staging-azure-validation and the exact executable SHA as runner labels. Only the protected staging environment on integration/institutional-security can launch it. This path accepts validation mode only; it cannot rerun runtime migrations.

The signed migration policy binds the exact VM, VNet, subnet, 10.72.4.4/32, migration identity, runtime opa_staging, disposable opa_staging_test and validation lease ID. The job verifies the root-owned lease, exact private DNS and VM user/tmpfs isolation. The operator supervisor rechecks Azure metadata, inherited IAM, routes, resource ownership and protected GitHub approval before introducing temporary access or starting a listener.

The offline JIT registration is expected. After approval, run run-azure-validation.py with the approved SHA and run ID. It renews the one-job JIT configuration, forces ephemeral/no-update settings, adds the SHA label, and uses a protected in-memory transfer. No listener is started by preparation or commit/push. An approval or authorization mismatch fails closed.

Database custody stays on the existing Windows operator host through its independently verified staging VPN /32. That source is distinct from the Azure runner source. The operator receives only temporary single-bootstrap-secret IAM and PostgreSQL/Key Vault rules. Bootstrap credentials never reach the job or VM. The custodian refuses runtime writes, validates disposable ownership, and sends only disposable access through a protected parameter to VM tmpfs.

After completion/failure, cleanup attempts cancellation, listener stop, disposable DB/role drop, runner deregistration, tmpfs removal, temporary IAM/network removal, execution-authorization deletion, VM/NIC/disk deletion, and runner-only NAT/public-IP deletion. Each step is recorded; one failure does not suppress later independent cleanup. Shared networking, PostgreSQL, Key Vault and the runner subnet/NSG are retained. Azure deletion is polled to absence. Before the supervisor reaches its temporary-access/launch lifecycle, rejected approval or resource-ownership preflight leaves the offline provisioned resources retained for review.

Egress is source-limited to 10.72.4.4/32. Checked hostnames are in azure-runner-endpoints.json. NSGs enforce IP/service boundaries, not hostname filtering. Azure identity uses AzureActiveDirectory; rotating GitHub token/results endpoints use GitHub's published 140.82.112.0/20 prefix. Other job destinations use observed /32s. Unknown JIT service hostnames fail closed. The preparation probe verifies TLS/HTTP only; signed artifact transfers and token acquisition are verified by the eventual protected job.

Preparation never creates/drops databases, launches the listener, deploys, or changes production. The lifecycle supervisor must be invoked only after the prepared run receives staging approval. If the 55-minute execution authorization expires while waiting, refresh only that same SHA/lease authorization before invocation; do not change the reviewed executable SHA.

## Exact results-storage egress

Results/log storage is separate from GitHub control endpoints. The approved hostname is productionresultssa9.blob.core.windows.net, identified through the log-redirect metadata for completed Run 34819635287 / Job 103897986188. This is GitHub-managed infrastructure. The signed redirect URL remains in memory; only its validated hostname is retained. Hostname validation is exact, with no wildcard storage or service-tag allowance.

Before launch, the supervisor refreshes that metadata, resolves the hostname from the VM, records all IPv4 addresses and DNS TTL when available, and creates an outbound rule named opa-results-<lease> at priority 170. Source is exactly 10.72.4.4/32; destinations are only the freshly resolved public IPv4 /32s, using TCP 443. TLS certificate validation and an unauthenticated HEAD / response must pass before launch. No redirect, signed URL, token or response body is used by the transport probe. NAT association and rule configuration are checked separately so failures have distinct DNS/TCP/TLS/HTTP/NSG/NAT classifications.

The resolved address set is frozen for the job and checked again immediately before launch and approximately every minute during execution. Any changed set stops the run; the supervisor never widens egress automatically. The temporary rule belongs to the existing independent cleanup sequence, which removes it and verifies absence after either success or failure. Inbound rules and the permanent deny baseline remain unchanged.

The approved completed job provides hostname provenance, not a guarantee of the host selected for future jobs. GitHub documents a wider *.blob.core.windows.net requirement and does not publish a GitHub-only Azure Storage service tag. If another host is required, this contract intentionally fails closed and needs review. An NSG enforces IP prefixes, not FQDN or tenant identity; shared-IP destinations are an inherent limitation of this approved approach. Storage.EastUS, global Storage and unrestricted Internet rules are not permitted by this change.

Disk cleanup uses the disk-specific ARM API 2024-03-02; VM operations retain their separate API version. This was verified by deleting the detached 32 GiB verification disk after the VM API version was rejected for that disk.

## Prisma engine download prerequisite

Fresh runners require `binaries.prisma.sh` for the engines selected by the committed Prisma lockfile. Include this exact hostname in preparation's fresh DNS /32 destination set, source `10.72.4.4/32`, TCP 443 only. Verify DNS, TCP and certificate-validated TLS/HTTP transport before queueing the protected job. Do not add an Internet-wide rule, disable TLS/checksum verification, or substitute engine/package versions. The existing temporary job-egress rule and mandatory cleanup own these addresses.

`npm ci` alone is insufficient evidence of engine availability: Prisma's engine postinstall suppresses download failures. Keep the explicit `npm run prisma:generate` gate. In the Ubuntu 22.04/Node 22.23.2 reproduction of commit `00755c4a42f684da3cb900f4f00fe7439bf3a7bc`, blocking only the engine hostname allowed `npm ci` to pass but made generation fail; normal access passed generation, validation and the API build. The original Azure command's error output was unavailable, so this corrects a demonstrated egress prerequisite without claiming complete historical attribution. GitHub results-storage hostname approval remains a separate gate.

The final automated attempt also requires a fresh Prisma-engine DNS/TCP/TLS/HTTP probe immediately before listener launch. Any infrastructure, bootstrap, egress, orchestration, supervisor, upload or engine-download failure exhausts the automated path: clean up and use separately controlled manual disposable validation; do not prepare another automated retry.
