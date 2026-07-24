/**
 * What a bearer-link holder may see.
 *
 * Deliberately a SNAPSHOT, not live tracking. OPA does not yet persist
 * continuous position or device telemetry, so this describes the incident as
 * captured at activation, plus any retriggers since. Fields OPA cannot
 * currently populate honestly - battery, network, device-online state,
 * responder acknowledgement - are OMITTED rather than returned as null,
 * because a null implies the capability exists and is merely empty.
 *
 * Continuous location arrives in Sprint 10B. Until then the page must not
 * imply currency it does not have.
 *
 * Nothing here exposes internal records: no token ids or hashes, no user id,
 * no notification rows, no contact list.
 */
export type PublicIncidentSnapshotDto = {
  /** Display name of the person who triggered the alert. */
  personName: string;
  status: 'OPEN' | 'RESOLVED';
  triggeredAt: string;
  location: {
    latitude: number;
    longitude: number;
    /**
     * When these coordinates were captured. Equal to triggeredAt today,
     * separate because Sprint 10B will update position independently.
     */
    capturedAt: string;
  };
  /** How many times the SOS was re-triggered. Repeated taps may signal rising distress. */
  retriggerCount: number;
  lastRetriggeredAt: string | null;
};

/** A closed incident reveals that it ended, and nothing more. */
export type ClosedIncidentDto = {
  personName: string;
  status: 'RESOLVED';
  triggeredAt: string;
  resolvedAt: string | null;
};

/**
 * Response states, in the precedence the controller applies:
 *
 *   NOT_FOUND        unknown token (404)
 *   REVOKED          explicit access-control decision, outranks everything
 *   INCIDENT_CLOSED  checked BEFORE expiry: someone opening an old link
 *                    benefits more from learning the emergency ended than
 *                    from being told only that their link expired
 *   EXPIRED          link lapsed while the incident may still be active
 *   VALID            current incident snapshot
 *
 * EXPIRED and INCIDENT_CLOSED must never be collapsed together. Telling a
 * family "this incident has ended" when the link merely expired could
 * convince them the emergency is over while their relative is still missing.
 */
export type PublicTrackingResponse =
  | { state: 'VALID'; incident: PublicIncidentSnapshotDto }
  | { state: 'EXPIRED'; incident: null }
  | { state: 'REVOKED'; incident: null }
  | { state: 'INCIDENT_CLOSED'; incident: ClosedIncidentDto }
  | { state: 'NOT_FOUND'; incident: null };
