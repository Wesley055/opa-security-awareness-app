/**
 * What a reader may see of an incident's timeline.
 *
 * THE RAW EVENT IS NOT SAFE TO RETURN. IncidentTimelineEvent carries
 * payload (arbitrary internal JSON), hash, previousHash, actorUserId,
 * correlationId and incidentId. getTimeline() selects none of them away.
 *
 * THE ALLOWLIST IS PER EVENT TYPE, because neither extreme is right.
 * Measured against a real production incident, one payload contained
 * reason: 'USER_SAFE' - exactly what an operator needs - alongside
 * endedJourneySessionId, an internal UUID. Dropping payload entirely would
 * lose the first; passing it through would leak the second.
 *
 * confidenceScore and confidenceLevel are DELIBERATELY EXCLUDED from
 * INCIDENT_CREATED. They come from detection.outcome - the emergency
 * DETECTION model's confidence that the activation is genuine, not
 * confidence in the location. A deliberate SOS button press scores LOW, and
 * "Confidence: Low" rendered beside a live emergency would read as doubt
 * about whether it is real.
 *
 * sha256 is excluded from EVIDENCE_ADDED. It is the integrity proof for one
 * file, not something an operator can act on in a timeline row. If it
 * belongs anywhere it is the evidence viewer, 14A-10.
 *
 * AN UNKNOWN TYPE STILL RENDERS. type is a free-form string, not an enum -
 * seven values exist across four call sites and nothing stops an eighth.
 * An unrecognised event returns an empty display and keeps its sequence,
 * type, occurredAt and source. AN AUDIT TRAIL THAT SILENTLY DROPS AN EVENT
 * IT CANNOT LABEL IS WORSE THAN ONE SHOWING A BARE LABEL.
 *
 * actorUserId IS EXCLUDED, and not only because it is a UUID. On the
 * production sample it was the RESIDENT on every event, including the three
 * the orchestrator wrote. It means "on whose behalf", not "who did this",
 * and rendering it as an actor would mislead. source - MOBILE versus
 * INCIDENT_ORCHESTRATOR - carries the distinction that actually matters.
 */

export type TimelineDisplay = Record<string, unknown>;

export type ReaderTimelineEvent = {
  sequence: number;
  type: string;
  /** The event time. recordedAt is audit metadata and is not returned. */
  occurredAt: Date;
  /** MOBILE, INCIDENT_ORCHESTRATOR, EVIDENCE_SERVICE. */
  source: string;
  /**
   * Allowlisted payload fields, if the payload had them. Empty for an
   * unrecognised type. Deliberately untyped: the shape varies per event
   * type, and typing it here would put backend payload knowledge into
   * every consumer - which is what this projection exists to prevent.
   */
  display: TimelineDisplay;
};

/**
 * Keys copied from each type's payload. Everything absent from this map,
 * and every key absent from a listed type, is dropped.
 */
const DISPLAY_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  INCIDENT_CREATED: ['trigger', 'silentMode'],
  LOCATION_ATTACHED: ['latitude', 'longitude'],
  NOTIFICATIONS_QUEUED: ['queued'],
  // close() writes both, and resolvedAt distinguishes them on the incident
  // row. Same fields here; the type is what separates them.
  INCIDENT_RESOLVED: ['reason', 'previousStatus', 'newStatus'],
  INCIDENT_CANCELLED: ['reason', 'previousStatus', 'newStatus'],
  SOS_RETRIGGERED: [
    'triggerMethod',
    'latitude',
    'longitude',
    'retriggerCount',
    // The operationally interesting one: re-triggered after 45 seconds
    // reads very differently from after 20 minutes, and repeated taps may
    // signal rising distress. dedupeWindowSeconds is tuning, and
    // retriggeredAt duplicates occurredAt.
    'secondsSinceInitialTrigger',
  ],
  EVIDENCE_ADDED: ['evidenceType', 'sizeBytes'],
};

/**
 * A PRESENCE-PRESERVING FILTER, NOT A SCHEMA.
 *
 * A key is copied only if the payload actually has it. `reason` is spread
 * into close()'s payload conditionally - `...(reason === undefined ? {} :
 * { reason })` - so a cancellation with no reason has no such key, and
 * emitting `reason: undefined` merely because it is allowlisted would
 * manufacture a field the source never had. That is the same rule
 * public-incident-snapshot.dto.ts set: OMITTED, not nulled.
 *
 * FALSY VALUES SURVIVE. `queued: 0` and `silentMode: false` are real
 * answers. Presence is tested with hasOwnProperty, never truthiness.
 */
function buildDisplay(type: string, payload: unknown): TimelineDisplay {
  const allowed = DISPLAY_ALLOWLIST[type];

  if (!allowed) {
    return {};
  }

  // payload is Json? in Prisma - it can be null, and jsonb can hold an
  // array or a scalar. None of those have allowlisted keys.
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  const source = payload as Record<string, unknown>;
  const display: TimelineDisplay = {};

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      display[key] = source[key];
    }
  }

  return display;
}

export function toReaderTimelineEvent(event: {
  sequence: number;
  type: string;
  occurredAt: Date;
  source: string;
  payload: unknown;
}): ReaderTimelineEvent {
  return {
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.occurredAt,
    source: event.source,
    display: buildDisplay(event.type, event.payload),
  };
}
