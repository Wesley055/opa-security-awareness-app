import type {
  FixOrigin,
  JourneyTrackingState,
} from '../tracking-state';

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
     * When these coordinates were captured. Equal to triggeredAt while
     * the incident has no journey fixes, and independent of it once the
     * stream starts.
     */
    capturedAt: string;
    /**
     * Whether this is the immutable origin of the emergency or a later
     * tracked position. ADR-005 keeps the incident row at the origin.
     */
    origin: FixOrigin;
  };
  /**
   * OMITTED, not nulled, when the incident has no journey session - which
   * is every incident created before Sprint 10B Step 4. A null here would
   * imply a stream exists and is merely empty. Decision 15.
   */
  tracking?: {
    state: JourneyTrackingState;
    /** Server clock of the newest fix. Silence is measured from this. */
    lastFixReceivedAt: string | null;
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
  // serverTime rides on VALID only. The other four have no position to
  // age, and INCIDENT_CLOSED deliberately discloses nothing but the end.
  // It exists so the page can judge staleness without trusting the
  // device clock - decision 5.
  | {
      state: 'VALID';
      incident: PublicIncidentSnapshotDto;
      serverTime: string;
    }
  | { state: 'EXPIRED'; incident: null }
  | { state: 'REVOKED'; incident: null }
  | { state: 'INCIDENT_CLOSED'; incident: ClosedIncidentDto }
  | { state: 'NOT_FOUND'; incident: null };
