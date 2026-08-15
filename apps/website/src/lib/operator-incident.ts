import 'server-only';
import { apiUrl, getAccessToken } from '@/lib/operator-session';

/**
 * One incident, read server-side. 14A-7.
 *
 * `server-only` for the same reason lib/operator-queue.ts is: the API base
 * URL and the access token must never reach client code.
 *
 * THE ONLY INPUT IS AN INCIDENT ID, and it comes from the route. The API
 * decides whether this caller may read it - IncidentAccessGuard admits the
 * owner, an operator assigned to the facility the incident was routed to,
 * or an admin, all re-read from PostgreSQL on every request. A 403 here is
 * that guard's answer, not a guess this file makes.
 *
 * serverTime IS STAMPED HERE for the same reason as the queue: the response
 * carries no server clock, and PublicTrackingResponse established that
 * staleness must never be computed against the browser's.
 */

export type IncidentDetail = {
  id: string;
  status: string;
  trigger: string;
  /** Prisma Decimal over JSON - STRINGS. Validate before converting. */
  latitude: string | null;
  longitude: string | null;
  address: string | null;
  /**
   * UNTRUSTED DEVICE TEXT. create() writes dto.voicePhrase for every
   * trigger and only validates its content for VOICE_HELP_HELP, so a
   * button-triggered incident can carry an arbitrary string of any length.
   */
  voicePhrase: string | null;
  /** DEVICE clock. Never compute a duration against createdAt. */
  lastTriggeredAt: string | null;
  retriggerCount: number;
  createdAt: string;
  updatedAt: string;
  /**
   * RESOLVED ONLY. Null on a CANCELLED incident is correct, not missing -
   * incidents.service.ts refuses to overload one column with two meanings.
   */
  resolvedAt: string | null;
  /**
   * PRESENCE ONLY. This says a journey session was linked, NOT that it is
   * still running: close() ends the session when the incident resolves, and
   * this projection does not carry session state. Never render this as
   * "live". 14A-8 reads the state and may then say so.
   */
  journeySessionId: string | null;
  user: { firstName: string; lastName: string } | null;
};

export type IncidentDetailResult =
  | { state: 'READY'; incident: IncidentDetail; serverTime: string }
  /** 401 - the access token was refused. Rotation is the recovery path. */
  | { state: 'REJECTED' }
  /** 403 - authenticated, but not permitted to read THIS incident. */
  | { state: 'FORBIDDEN'; message: string }
  /** 404 - no such incident, or the guard refuses to confirm one exists. */
  | { state: 'NOT_FOUND' }
  /** Unreachable or unusable. Says nothing; change nothing. */
  | { state: 'UNAVAILABLE' };

export async function fetchIncidentDetail(
  incidentId: string,
): Promise<IncidentDetailResult> {
  const base = apiUrl();

  if (!base) {
    console.error('OPA_API_URL is not configured.');
    return { state: 'UNAVAILABLE' };
  }

  const accessToken = await getAccessToken();

  if (!accessToken) {
    return { state: 'REJECTED' };
  }

  let response: Response;

  try {
    response = await fetch(
      `${base}/incidents/${encodeURIComponent(incidentId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch (error) {
    // Never log the token.
    console.error(
      'Incident detail could not reach the API:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return { state: 'UNAVAILABLE' };
  }

  if (response.status === 401) {
    return { state: 'REJECTED' };
  }

  if (response.status === 404) {
    return { state: 'NOT_FOUND' };
  }

  if (response.status === 403) {
    let message = 'You do not have access to this incident.';

    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === 'string' && body.message) {
        message = body.message;
      }
    } catch {
      // A 403 with an unreadable body is still a 403.
    }

    return { state: 'FORBIDDEN', message };
  }

  if (!response.ok) {
    console.error(`Incident detail returned ${response.status}.`);
    return { state: 'UNAVAILABLE' };
  }

  let incident: IncidentDetail;

  try {
    incident = (await response.json()) as IncidentDetail;
  } catch {
    console.error('Incident detail returned unreadable JSON.');
    return { state: 'UNAVAILABLE' };
  }

  // A body without an id is not an incident. Rendering a blank detail card
  // would state less than nothing.
  if (!incident || typeof incident.id !== 'string') {
    console.error('Incident detail returned an unexpected shape.');
    return { state: 'UNAVAILABLE' };
  }

  return {
    state: 'READY',
    incident,
    serverTime: new Date().toISOString(),
  };
}