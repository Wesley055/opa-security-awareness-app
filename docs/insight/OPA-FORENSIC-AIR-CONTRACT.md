# OPA forensic AIR contract v1

POST /internal/insight/incidents/:incidentId/air with requestKey (UUID) and optional authorized facilityId.
GET /internal/insight/air/:reportId reads a stored version.
GET /internal/insight/air/:reportId/export returns the same masked JSON with attachment disposition and Cache-Control: no-store.

## Identity and versions

Each row stores report ID, facility/tenant, incident ID, monotonically increasing incident/facility version, schemaVersion=1, generatorVersion=opa-evidence-1.0.0, generatedAt, generatedBy reference, sourceCutoff, sourceDigest, supersedesId and structured document. Responses mask generatedBy and supply the report ID as audit reference.

requestKey deduplicates retries within an incident/facility. Reuse returns the original stored version even if source facts or the generator later change. A new requestKey creates a new version, linking the previous report in supersedesId. A unique version constraint and SERIALIZABLE transaction retries prevent two concurrent writers from allocating the same committed version. No previous row/document is modified.

Determinism means the same allowlisted source facts and generator produce byte-equivalent canonical JSON and the same SHA-256 digest. Different report versions intentionally have different IDs/version/time envelopes. sourceFactCutoff is the database transaction-start observation marker for a consistent transaction snapshot; it is not an arbitrary event-time filter. Late-recorded events appear only in later snapshots. No past-state reconstruction from today's mutable columns is claimed. Source event references, occurrence/recording timestamps and notification/attempt/evidence references are retained.

## Content and classification

The document contains summary, activation trigger/mode/source/time, observed lifecycle status, protected origin location availability, unknown latest verified location, chronological timeline, notification attempts/delivery truth, notification acknowledgements, incident acknowledgement UNKNOWN, recorded response-event references, evidence references, closure provenance, SafeWalk emergency indicator, completeness and uncertainty.

FACT is available in the classification vocabulary but independent fact verification is not invented. SYSTEM_OBSERVED_FACT denotes an OPA-recorded value. SOURCE_ASSERTION identifies mobile/source assertions; UNKNOWN identifies unavailable/unrecognized data; HUMAN_NOTE identifies optional human assertions such as closure reason. Free-text human notes are masked rather than copied into institutional reports. Chronology sorts occurredAt, then sequence, then event ID. Source sequence remains available independently of event-time order.

Unknown event types/sources retain their source reference with UNKNOWN labels; arbitrary strings and payloads cannot escape through those fields. Unknown activation values are classified UNKNOWN. Closure actor is on-behalf-of provenance, and closure reason remains protected. Initial/latest precise tracking stays under the existing authorized tracking boundary.

## Audit and export

Generation, retry access, supersession, read and JSON export are audited using AdministrativeAuditEvent in the same transaction. Audit failure fails the requested operation. Plaintext PII is absent from audit metadata. Current account/facility and current incident ownership are revalidated on every read, including older AIR and ADMIN exports.

The digest covers the allowlisted document only. It is an integrity comparison/deduplication mechanism, not a digital signature, trusted timestamp, WORM store, proof of source truth, legal admissibility or an independently tamper-evident archive. Database administrators can still alter data. Do not label these reports immutable. Regulated retention, signed exports and cryptographic attestations require separate design.
