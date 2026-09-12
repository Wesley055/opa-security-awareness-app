# OPA continuous compliance evidence foundation

GET /internal/insight/incidents/:incidentId/compliance-evidence[?facilityId=<UUID>].

Returns schemaVersion, incident/facility, the latest stored AIR, report-version/supersession references and current corrective-action projections. AIR facts retain their original cutoff; actions reflect this read. Before AIR generation the report is null and explicit uncertainty explains its absence. No AIR is silently generated as a read side effect. Requests over 100 versions or 1,000 actions fail rather than return partial evidence packages.

This is an output of the same reporting program. It can trace what OPA recorded, event/recording times, masked notification recipient references, provider acceptance versus actual delivery truth, notification acknowledgements, response events, stored evidence, closure provenance, follow-up ownership, completion and independent verification. Incident acknowledgement remains UNKNOWN until an authoritative writer exists.

Authorization is identical to AIR, including current account/facility and incident scope checks. Package reads are audited. Structured data is authoritative; formatting cannot modify facts. Evidence files remain behind the existing authorized Evidence boundary; no storage URLs, keys, identities or private SafeWalk journey history are embedded.

complianceClaim is null and regulatoryMappings is empty. There are no NUPRC, NESREA, NOSDRA, NCAA or NSIB mappings. No claim of regulatory compliance, admissibility, immutable evidence or independent incident verification is made.

Future framework adapters may map validated evidence to specific obligations, after separate policy, retention, export and legal review. Future Partner Gateway authentication/webhooks are outside this lane.
