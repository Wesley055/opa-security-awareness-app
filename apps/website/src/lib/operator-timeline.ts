import 'server-only';
import { apiUrl, getAccessToken } from '@/lib/operator-session';

/**
 * An incident's timeline, and whether its hash chain still verifies. 14A-9.
 *
 * `server-only` for the same reason lib/operator-incident.ts is: the API
 * base URL and the access token must never reach client code.
 *
 * THE API ALREADY PROJECTS. GET /incidents/:id/timeline returns sequence,
 * type, occurredAt, source and an allowlisted display object - no raw
 * payload, no hash chain, no internal UUIDs. This file does not narrow it
 * further; the narrowing happened where the payload shapes are known.
 *
 * TWO SEPARATE CALLS, DELIBERATELY. Verification is not free and does not
 * change unless the timeline is appended to, so the caller decides when to
 * ask. A combined endpoint would have to own that decision, which is
 * application state the bridge has no business holding.
 */

export type TimelineEvent = {
  sequence: number;
  type: string;
  occurredAt: string;
  source: string;
  /**
   * Allowlisted payload fields, empty for an event type the API does not
   * recognise. Untyped by design - the shape varies per type, and the
   * console renders it through a per-type formatter.
   */
  display: Record<string, unknown>;
};

export type TimelineVerification = {
  valid: boolean;
  /** Present only when valid is false. */
  brokenAtSequence?: number;
};

export type TimelineResult =
  | { state: 'READY'; events: TimelineEvent[] }
  | { state: 'REJECTED' }
  | { state: 'FORBIDDEN'; message: string }
  | { state: 'NOT_FOUND' }
  | { state: 'UNAVAILABLE' };

export type VerificationResult =
  | { state: 'READY'; verification: TimelineVerification }
  | { state: 'UNAVAILABLE' };

async function callApi(path: string): Promise<
  { ok: true; response: Response } | { ok: false; state: 'REJECTED' | 'UNAVAILABLE' }
> {
  const base = apiUrl();

  if (!base) {
    console.error('OPA_API_URL is not configured.');
    return { ok: false, state: 'UNAVAILABLE' };
  }

  const accessToken = await getAccessToken();

  if (!accessToken) {
    return { ok: false, state: 'REJECTED' };
  }

  try {
    const response = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    return { ok: true, response };
  } catch (error) {
    // Never log the token.
    console.error(
      'Incident timeline could not reach the API:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return { ok: false, state: 'UNAVAILABLE' };
  }
}

export async function fetchIncidentTimeline(
  incidentId: string,
): Promise<TimelineResult> {
  const call = await callApi(
    `/incidents/${encodeURIComponent(incidentId)}/timeline`,
  );

  if (!call.ok) {
    return { state: call.state };
  }

  const { response } = call;

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
    console.error(`Incident timeline returned ${response.status}.`);
    return { state: 'UNAVAILABLE' };
  }

  let events: TimelineEvent[];

  try {
    events = (await response.json()) as TimelineEvent[];
  } catch {
    console.error('Incident timeline returned unreadable JSON.');
    return { state: 'UNAVAILABLE' };
  }

  // AN UNEXPECTED SHAPE MUST NOT BECOME AN EMPTY TIMELINE. Showing no
  // history is a claim, and this cannot make it.
  if (!Array.isArray(events)) {
    console.error('Incident timeline returned an unexpected shape.');
    return { state: 'UNAVAILABLE' };
  }

  return { state: 'READY', events };
}

/**
 * Whether the chain still verifies.
 *
 * UNAVAILABLE IS NOT "INVALID". A failed request means OPA does not know,
 * and the console must say so rather than showing a tampering warning
 * because the network was down. valid: false is a claim only the API makes.
 */
export async function fetchTimelineVerification(
  incidentId: string,
): Promise<VerificationResult> {
  const call = await callApi(
    `/incidents/${encodeURIComponent(incidentId)}/timeline/verify`,
  );

  if (!call.ok || !call.response.ok) {
    return { state: 'UNAVAILABLE' };
  }

  try {
    const verification = (await call.response.json()) as TimelineVerification;

    if (typeof verification?.valid !== 'boolean') {
      console.error('Timeline verification returned an unexpected shape.');
      return { state: 'UNAVAILABLE' };
    }

    return { state: 'READY', verification };
  } catch {
    console.error('Timeline verification returned unreadable JSON.');
    return { state: 'UNAVAILABLE' };
  }
}