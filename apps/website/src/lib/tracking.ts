import 'server-only';

/**
 * Server-side client for the incident tracking API.
 *
 * Marked `server-only` deliberately. If this were ever imported into a client
 * component the API base URL would ship to the browser and the capability
 * token would be handled client-side, which is exactly what the same-origin
 * bridge exists to prevent.
 */

export type PublicIncidentSnapshot = {
  personName: string;
  status: 'OPEN';
  triggeredAt: string;
  location: {
    latitude: number;
    longitude: number;
    capturedAt: string;
  };
  retriggerCount: number;
  lastRetriggeredAt: string | null;
};

export type ClosedIncident = {
  personName: string;
  status: 'RESOLVED';
  triggeredAt: string;
  resolvedAt: string | null;
};

export type TrackingResult =
  | { state: 'VALID'; incident: PublicIncidentSnapshot }
  | { state: 'EXPIRED'; incident: null }
  | { state: 'REVOKED'; incident: null }
  | { state: 'INCIDENT_CLOSED'; incident: ClosedIncident }
  | { state: 'NOT_FOUND'; incident: null }
  /** The API could not be reached. Distinct from any answer it might give. */
  | { state: 'UNAVAILABLE'; incident: null };

const API_URL = process.env.OPA_API_URL;

/**
 * Fetch an incident snapshot by capability token.
 *
 * Never cached: an emergency must not be served stale, and a shared cache
 * must never hold one person's incident.
 */
export async function fetchTracking(token: string): Promise<TrackingResult> {
  if (!API_URL) {
    // Fail loudly in development rather than silently showing "unavailable".
    console.error('OPA_API_URL is not configured.');
    return { state: 'UNAVAILABLE', incident: null };
  }

  try {
    const response = await fetch(
      `${API_URL}/public/tracking/${encodeURIComponent(token)}`,
      {
        cache: 'no-store',
        // An emergency page must not hang indefinitely on a slow API.
        signal: AbortSignal.timeout(8000),
      },
    );

    // 404 and 410 are expected answers, not failures: the body carries the
    // state that tells a family member what actually happened.
    if (!response.ok && ![404, 410].includes(response.status)) {
      console.error(`Tracking API returned ${response.status}`);
      return { state: 'UNAVAILABLE', incident: null };
    }

    return (await response.json()) as TrackingResult;
  } catch (error) {
    // Never log the token: it is a working link to someone's emergency.
    console.error(
      'Tracking API request failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return { state: 'UNAVAILABLE', incident: null };
  }
}
