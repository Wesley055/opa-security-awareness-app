import 'server-only';
import { apiUrl, getAccessToken } from '@/lib/operator-session';

/**
 * The operator's live incident queue. 14A-6.
 *
 * `server-only` for the same reason lib/tracking.ts and lib/operator-
 * context.ts are: the API base URL and the access token must never reach
 * client code.
 *
 * IT SENDS NO FACILITY ID AND ACCEPTS NONE. GET /operator/incidents resolves
 * the facility from the token inside OperatorFacilityGuard. That endpoint
 * exists precisely so the browser never holds, sends, or is trusted with a
 * facility id - see the guard's own comment for the alternative that was
 * rejected.
 *
 * serverTime IS STAMPED HERE, and it is the whole reason freshness can be
 * shown honestly. The queue response carries no server clock, and the
 * PublicTrackingResponse precedent is explicit that staleness must never be
 * computed against the browser's clock. This is a server, so its clock is
 * the right one to age against. It is NOT the API's clock - the two could
 * drift - so treat it as "when this page last heard from the API", which is
 * exactly what a staleness indicator means.
 *
 * NOT cache()d, unlike getOperatorContext. This is polled every five
 * seconds; deduping within a render pass would be pointless and caching
 * across them would be wrong.
 */

export type QueueIncident = {
  id: string;
  status: string;
  trigger: string;
  /**
   * STRINGS, not numbers. Prisma Decimal serialises to a string over JSON.
   * Anything that formats these must validate before converting.
   */
  latitude: string | null;
  longitude: string | null;
  /** Frequently null - nothing geocodes on this path. Fall back to coords. */
  address: string | null;
  /**
   * SERVER clock, written at creation. This is the field to age against.
   * lastTriggeredAt is a DEVICE clock and can precede it by milliseconds;
   * never compute a duration between the two.
   */
  createdAt: string;
  lastTriggeredAt: string | null;
  retriggerCount: number;
  resolvedAt: string | null;
  user: { firstName: string; lastName: string } | null;
};

export type QueueResult =
  | {
      state: 'READY';
      incidents: QueueIncident[];
      nextCursor: string | null;
      hasMore: boolean;
      serverTime: string;
    }
  /** 401 - the access token was refused. Rotation is the recovery path. */
  | { state: 'REJECTED' }
  /**
   * 403 - the API refused this account: suspended, wrong role, or no
   * facility assigned. NOT a token problem, so rotating would not help and
   * the client must stop polling rather than retry forever.
   */
  | { state: 'FORBIDDEN'; message: string }
  /** Unreachable or unusable. Says nothing; change nothing. */
  | { state: 'UNAVAILABLE' };

export async function fetchOperatorQueue(options?: {
  cursor?: string;
}): Promise<QueueResult> {
  const base = apiUrl();

  if (!base) {
    console.error('OPA_API_URL is not configured.');
    return { state: 'UNAVAILABLE' };
  }

  const accessToken = await getAccessToken();

  if (!accessToken) {
    return { state: 'REJECTED' };
  }

  const url = new URL('/operator/incidents', base);
  if (options?.cursor) {
    url.searchParams.set('cursor', options.cursor);
  }

  let response: Response;

  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    // Never log the token.
    console.error(
      'Operator queue could not reach the API:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return { state: 'UNAVAILABLE' };
  }

  if (response.status === 401) {
    return { state: 'REJECTED' };
  }

  if (response.status === 403) {
    let message = 'This account can no longer access this queue.';

    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === 'string' && body.message) {
        message = body.message;
      }
    } catch {
      // Keep the default. A 403 with an unreadable body is still a 403.
    }

    return { state: 'FORBIDDEN', message };
  }

  if (!response.ok) {
    console.error(`Operator queue returned ${response.status}.`);
    return { state: 'UNAVAILABLE' };
  }

  let payload: {
    incidents?: QueueIncident[];
    nextCursor?: string | null;
    hasMore?: boolean;
  };

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    console.error('Operator queue returned unreadable JSON.');
    return { state: 'UNAVAILABLE' };
  }

  if (!Array.isArray(payload.incidents)) {
    // An unexpected shape must NOT become an empty queue. Showing zero
    // emergencies is a claim, and this cannot make it.
    console.error('Operator queue returned an unexpected shape.');
    return { state: 'UNAVAILABLE' };
  }

  return {
    state: 'READY',
    incidents: payload.incidents,
    nextCursor: payload.nextCursor ?? null,
    hasMore: payload.hasMore ?? false,
    serverTime: new Date().toISOString(),
  };
}