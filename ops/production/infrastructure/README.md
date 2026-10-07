# Bounded production migration VM infrastructure

Design/tooling only, 2026-10-07. No Azure read/mutation, SQL, credential access,
signing, migration, deployment, EAS, commit or push was performed for this task.
The existing migration mechanism is unchanged. Start with the canonical release
authority and `../README.md`. This infrastructure contract does not authorize SQL.

## Topology and bounded access

Use existing `opa-api-productionSubnet` (10.0.0.0/24) inside
`opa-api-productionVnet` (10.0.0.0/16), southafricanorth, opa-production,
subscription b79ffdb2-0cf1-4915-89b4-2b6b7cae0299. No new subnet is currently
justified. Fresh inventory must prove no NIC/IP configuration/private endpoint,
delegation, NSG, NAT, route or service association occupies this subnet.
Fail closed on any occupant. Never modify AppSubnet 10.0.1.0/24 or DbSubnet
10.0.2.0/24. If occupancy changes, stop for a separate reviewed topology and exact
CIDR overlap/availability proof; this tooling does not invent a spare CIDR.

Create a dedicated NIC NSG, finish and independently verify its rules BEFORE
creating the NIC/VM. No subnet NSG attachment is generated. All inbound is denied
at priority 100, overriding Azure default VNet/load-balancer inbound allowances.
No public IP, load balancer/NAT/backend association, IP forwarding or SSH listener.
One NIC, dynamically assigned private 10.0.0.x; no data disks. Explicit source
wildcards are outbound-only. NSGs are stateful: replies to approved outbound flows
remain possible. Guest firewall independently denies inbound; disable sshd.

Outbound: TCP5432 to exact independently observed PostgreSQL private IPv4s;
TCP443 to exact pre-existing approved Key Vault/blob private endpoint IPv4s;
AzurePlatformDNS TCP/UDP53; WireServer 168.63.129.16 TCP80/32526; IMDS
169.254.169.254 TCP80; AzureCloud TCP443 for agent/managed-command dependencies;
deny everything else at priority4000. Azure DNS/platform paths have special NSG
semantics; also verify guest firewall access. **AzureCloud is a broad IP service
tag, not FQDN filtering.** This residual egress requires explicit approval and an
isolated rehearsal proving agent extension delivery under these rules. No npm,
apt, general Internet, Redis or package-build access is intended. If this residual
scope is unacceptable, NO-GO pending a separately approved firewall/proxy/private
management design. No firewall/NAT/Bastion creation is generated here.

Recommend Ubuntu 24.04 LTS Linux x64, Standard_D2s_v5 (2 vCPU/8GiB), Standard_LRS
OS disk, approved immutable Compute Gallery version. D-series avoids burst-credit
unpredictability and provides room for Prisma schema checks. Availability/quota
and gallery replication in southafricanorth must be proved. Build/patch the image
outside production: Node22, Azure Linux agent and managed command support, CA
certificates, preinstalled non-secret bootstrap dependencies, guest firewall,
sshd disabled, swap/core dumps disabled, no credentials/artifact secrets. Reviewed
image provenance/hash is a separate prerequisite, not something ARM image ID
alone proves. No `latest`, customData, extension credentials or passwords.

Build the existing migration artifact on the SAME image/OS/x64 outside the
credential-bearing runner. Verify exact artifact manifest hash, CLI/engines and
archive hash before upload and after extraction. Upload via a separately approved
operator to a dedicated private blob container, using Entra auth (no SAS/account
keys). Artifact build/upload and image creation are external actions, not generated
here. Prevent container replacement after review; pin blob version/ETag in the
reviewed bootstrap and check content hash before execution.

Use Managed Run Command with the VM agent. No inbound administration is needed.
The generator uses ARM PUT via az rest with scriptUriManagedIdentity.clientId;
the current az vm run-command create CLI does not expose that identity property.
The generated JSON contains only a non-secret URI and public identity client ID.
Inventory detects any Bastion but does not assume/use one. Require provider/API
support, agent readiness and a rehearsal. Limit approved operators to VM-scoped
read and Microsoft.Compute/virtualMachines/runCommands/read/write/delete via an
existing reviewed custom role/PIM grant. Run Command is effectively root execution;
its principals are release custodians. No broad Contributor/Owner assignment.
Identity RBAC is not operator RBAC. An independent operator with scoped resource
deletion authority owns teardown and remains available if the guest/agent fails.

## Identity, custody and external prerequisites

Exactly one temporary user-assigned identity is attached. It has exactly:

* Key Vault Secrets User (4633458b-17de-408a-b874-0445c86b69e6), scoped to ONE
  migration secret resource, never the vault/subscription. RBAC is secret-resource
  scope, not version scope: the reviewed bootstrap retrieves the policy's exact
  version and hash. No administrator credential is permitted on the VM.
* Storage Blob Data Reader (2a2b9908-6ea1-4ae2-8e65-a410df84e7d1), scoped to ONE
  dedicated artifact container. No write/list at account or key retrieval.

Existing RBAC-enabled vault and storage must have approved private endpoints,
linked private DNS and public access disabled; shared storage keys disabled. They
are prerequisites, not silently created or changed. Endpoint subnet/CIDR is not
assumed free. Missing endpoints or vault/storage require separate review. Identity
must have no transitive groups or other direct/inherited role grants. Independent
subscription-wide assignment inventory plus directory group-membership evidence
is mandatory; the VM identity gets no Graph permission for this.

The bootstrap is reviewed NON-SECRET source, pinned by artifact hash in its URI,
downloaded with scriptUriManagedIdentity. It must verify archive/manifest/image
contracts, use IMDS tokens only in memory, retrieve only the exact approved secret
version over TLS, start Node with the existing production runner environment in
memory, suppress secret-bearing subprocess output, never shell-trace, never write
environment/credential files, and discard tokens/credentials on exit. Node's
DATABASE_URL is necessarily process environment for the existing runner: this
is memory-only, not shell history, command parameters or persisted environment.
Disable debugging, crash dumps and swap; other root users can read memory.
This task does not implement or approve a credential broker/bootstrap execution
workflow. The approved custodian must supply/rehearse that boundary and the
existing signed policy without exposing values. Until then provisioning/migration
is NO-GO. Do not pass secret values even as protected Run Command parameters,
SAS, customData, tags, logs, output blobs, receipts or shell arguments.

Lease is at most one hour, with job, expiry, approval, cleanup owner and plan hash
on every runner resource. Azure tags do NOT schedule deletion. An independent
control-plane custodian must record an externally executable deadline/job before
preflight passes. That supervisor must first ensure existing PostgreSQL privilege
cleanup is completed by its separate DBA, then remove Azure resources regardless
of guest failure. Removing a VM does not revoke database permissions.

## Offline tools and exact commands

`infra.cjs` never invokes Azure or SQL; it accepts independently collected metadata,
validates it, emits a sanitized receipt or reviewable Bash commands. Outputs are
exclusive-created mode0600 (use equivalent Windows ACL). No automatic retries,
updates or adoption. A fresh five-minute snapshot and 15-minute plan issuance
bound generation. Names derive only from safe job IDs. No credentials in plan.
`inventory.cjs` generates read-only commands; it does not run them.

Plan JSON fields are defined by `plan()` and executable synthetic fixtures in
`infra.test.cjs`: version, job, createdAt, expiresAt, cleanupOwner, approvalId,
immutable imageId/imageSha256, artifactSha256, publicKey (public ed25519 only),
databaseAddresses, vaultAddress, blobAddress, exact secretScope/containerScope,
non-SAS scriptUri and explicit controlEgressApproved. No extra fields accepted.
Fixtures are test data, never real approval. Keep approved plan/evidence outside Git.

```sh
node ops/production/infrastructure/inventory.cjs /approved/plan.json /approved/read-only.sh
# Only after an approved authenticated read-only operator session:
bash /approved/read-only.sh /approved/inventory-before
```

The generated script contains exact az account/group/VNet/subnet/NIC/private
endpoint/PostgreSQL/DNS/resource/image/SKU/provider/Bastion/RBAC queries. No
Azure CLI command was executed during implementation. Ensure complete visibility:
inaccessible subscriptions/resources/directory membership is NO-GO, not empty.
Read-only resource APIs sometimes include unrelated tags: protect raw inventory,
retain only selected non-secret metadata, never display unrestricted tags.
Do not collect VM customData, secret data, access keys, access tokens or command
outputs from old runs. Never query Key Vault secret values for preflight.

Normalize these independent responses into `snapshot.json` using the structure
in the tests; this review requires an explicit external inventory attestation:
subscription/account ID; observedAt; group; vnet/subnet; ALL subscription nics and
subnet references; database; dns/links/A records; ALL subscription resource IDs
with selected job tags plus VNet child subnet IDs; vault/storage; image and image
provenance evidence; endpoint service/group/state/IP/DNS-link evidence; SKU and
Run Command support; scheduled cleanup evidence. No inferred true flags from
missing CLI results. Endpoint addresses must come from their NIC configurations,
and DNS-zone links from the corresponding privatelink.vaultcore.azure.net and
privatelink.blob.core.windows.net zones (names/resource groups supplied by approved
endpoint inventory). Check those links with:

```sh
az network private-dns link vnet list --subscription b79ffdb2-0cf1-4915-89b4-2b6b7cae0299 -g <ZONE_RG> -z <EXACT_ZONE> --only-show-errors -o json
az network nic show --subscription b79ffdb2-0cf1-4915-89b4-2b6b7cae0299 --ids <EXACT_ENDPOINT_NIC_ID> --query 'ipConfigurations[].privateIPAddress' --only-show-errors -o json
```

```sh
node ops/production/infrastructure/infra.cjs preflight /approved/plan.json /approved/snapshot.json /approved/preflight.json
node ops/production/infrastructure/infra.cjs generate /approved/plan.json /approved/snapshot.json /approved/provision.review.sh
# STOP FOR EXPLICIT HUMAN MUTATION APPROVAL. Proposed exact mutations are in
# provision.review.sh: NSG/rules -> verify -> identity/RBAC -> NIC -> VM -> disk
# tags/boot diagnostics -> verify -> approved non-secret Managed Run Command.
# Do not run as one unattended script: stop at each independent verification gate.
```

All generated az commands explicitly bind the subscription/group/region and exact
IDs. No az account set is used. RBAC principal is read from the newly created
identity. Allow propagation and independently verify exactly two grants before
bootstrap. Unexpected existing names fail closed. Refresh inventory immediately
before each mutation; Azure offers no atomic inventory-to-create lock. Exclusive
release custody and resource-name reservation are external requirements. On timeout
or ambiguous response, inventory again and stop; never rerun create blindly.

Independent post-provision collection: uncomment exact VM/NIC/NSG/identity,
effective NSG and effective route queries from the generated read-only script.
Inspect VM-agent status using `az vm get-instance-view` on the exact VM; inspect
VM-scoped operator role grants separately. Verify no public IP/backends/NAT,
one approved NIC, exact rule tuples (normalize Azure null/default fields away),
image/size/disk, identity and lease tags. `az vm create` can create an OS disk before
the follow-up tagging command; if interrupted there, retain the tagged VM's exact
osDisk ID as independent disk provenance. An untagged orphan is NOT silently
adopted/deleted: investigate ARM operation provenance and separately approve its
exact-ID cleanup. Partial cleanup is fail-closed when ownership cannot be proven.

An approved non-secret guest verification script must output only Node22/platform/
arch, SSH disabled, agent healthy, exact IMDS VM ID, private NIC IPs, artifact hash
and privately resolved PostgreSQL addresses. DNS lookup makes no PostgreSQL
connection. Verify all resolved addresses match the existing signed runner
contract. Effective rule/route evidence must prove no alternate ingress/egress.
Populate guest, vm, nic, nsg, identity, assignments, identityTransitiveGroups and
rbacInventoryComplete fields; independently attest provenance rather than taking
guest assertions alone as proof. This offline tool cannot authenticate a forged
snapshot. Custody/attestation belongs to the human release authority.

```sh
node ops/production/infrastructure/infra.cjs verify /approved/plan.json /approved/post.json /approved/post-receipt.json
```

Lease teardown is independently generated from FRESH inventory; it remains usable
after policy/lease expiry. Missing resources are skipped. Exact job/plan/lease tags
are required; wrong owners, extra job resources or RBAC drift fail closed for
review. No deletion by wildcard, group or tag query. Do not delete a shared resource.

```sh
node ops/production/infrastructure/infra.cjs teardown /approved/plan.json /approved/cleanup-inventory.json /approved/teardown.review.sh
# After separately approved DBA cleanup and exact deletion review:
# bash /approved/teardown.review.sh
```

Generated commands delete exact two role assignments by ID, then VM (including
managed Run Command child), NIC, OS disk, identity, NSG. On partial deletion,
collect fresh inventory and generate a new script; Azure DELETE errors stop the
script. Resource absence is only accepted from a successful complete list, never
an authorization/network error. Keep assignment IDs/principal in the independent
custodian inventory even after identity deletion, so stale RBAC is detectable.
Never delete VNet/subnets/DNS/DB/App/vault/storage/private endpoints/gallery or
unrelated resources. No subnet detach is needed because no subnet attachment occurs.

```sh
# Re-run exact read-only inventory commands and normalize after deletion.
node ops/production/infrastructure/infra.cjs verify-gone /approved/plan.json /approved/after.json /approved/gone-receipt.json /approved/cleanup-inventory.json
```

Post-teardown checks require all five exact job IDs absent, principal grants absent,
and identical protected production metadata/unrelated resource inventory. Compare
before/after full protected fields, with stable projection/order normalization.
Independent concurrent production change causes review, not silent acceptance.

## Costs, validation and handover

Five runner resources: VM, NIC, OS disk, NSG, user-assigned identity; two role
assignments and one Managed Run Command child. No public IP/Bastion/NAT/firewall,
new subnet/private endpoint/vault/storage is created by these commands. VM compute
and managed disk are billable; existing artifact storage/transactions, private
endpoint traffic, Key Vault operations and gallery image storage have costs.
No currency estimate without current Azure pricing/quota. Deallocation alone
continues disk costs; explicit deletion is required. ARM deployment history is
not generated. New prerequisite resources require a separate cost/approval review.

```sh
node --test ops/production/infrastructure/infra.test.cjs
node --test ops/production/production.test.cjs
git diff --check
```

NO-GO until approved image/artifact/bootstrap provenance, exact private endpoint
and DNS evidence, quota/provider/agent rehearsal, least-privilege operator/cleanup
RBAC, independent timed teardown, fresh full occupancy inventory, custody and
explicit human provisioning approval exist. No live Azure assertion is made here.
Mandatory handover carries plan/hash, VM/NIC/disk/identity/NSG IDs, principal/two
assignment IDs, image/artifact hashes, private IPs, lease/cleanup owner and job,
management operator scope, snapshot/receipt references and teardown results, plus
the existing Production Release Authority continuity. Never carry secret values.

Sources: [NSG semantics](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview),
[Linux agent](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/agent-linux),
[Managed Run Command](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command-managed),
[CLI parameters](https://learn.microsoft.com/en-us/cli/azure/vm/run-command),
[Key Vault RBAC scopes](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide).
