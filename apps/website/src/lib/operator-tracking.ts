import 'server-only';
import { apiUrl, getAccessToken } from '@/lib/operator-session';
import type {
  OperatorTrackingPoint,
  OperatorTrackingSnapshot,
  OperatorTrackingState,
  TrackingOrigin,
} from '@/lib/operator-tracking-types';

export type {
  OperatorTrackingPoint,
  OperatorTrackingSnapshot,
  OperatorTrackingState,
  TrackingOrigin,
} from '@/lib/operator-tracking-types';

export type OperatorTrackingResult =
  | { state: 'READY'; tracking: OperatorTrackingSnapshot }
  | { state: 'REJECTED' }
  | { state: 'FORBIDDEN'; message: string }
  | { state: 'NOT_FOUND' }
  | { state: 'UNAVAILABLE' };

const TRACKING_STATES = new Set<OperatorTrackingState>([
  'NO_SESSION',
  'AWAITING_FIRST_FIX',
  'RECEIVING',
  'SILENT',
  'ENDED',
]);

const TRACKING_ORIGINS = new Set<TrackingOrigin>([
  'ACTIVATION',
  'TRACKED',
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTrackingPoint(value: unknown): value is OperatorTrackingPoint {
  if (typeof value !== 'object' || value === null) return false;

  const point = value as Record<string, unknown>;

  if (!isFiniteNumber(point.latitude)) return false;
  if (!isFiniteNumber(point.longitude)) return false;
  if (typeof point.source !== 'string') return false;
  if (
    typeof point.origin !== 'string' ||
    !TRACKING_ORIGINS.has(point.origin as TrackingOrigin)
  ) {
    return false;
  }

  if (typeof point.recordedAt !== 'string') return false;
  if (!isNullableString(point.receivedAt)) return false;

  if (
    point.sequence !== undefined &&
    (!Number.isInteger(point.sequence) || (point.sequence as number) < 0)
  ) {
    return false;
  }

  for (const field of ['accuracy', 'speed', 'heading'] as const) {
    const candidate = point[field];
    if (
      candidate !== undefined &&
      candidate !== null &&
      !isFiniteNumber(candidate)
    ) {
      return false;
    }
  }

  return true;
}

function isTrackingSnapshot(
  value: unknown,
): value is OperatorTrackingSnapshot {
  if (typeof value !== 'object' || value === null) return false;

  const snapshot = value as Record<string, unknown>;

  if (
    typeof snapshot.state !== 'string' ||
    !TRACKING_STATES.has(snapshot.state as OperatorTrackingState)
  ) {
    return false;
  }

  if (!isNullableString(snapshot.lastFixReceivedAt)) return false;
  if (!isTrackingPoint(snapshot.latest)) return false;
  if (!Array.isArray(snapshot.points)) return false;
  if (!snapshot.points.every(isTrackingPoint)) return false;
  if (typeof snapshot.serverTime !== 'string') return false;

  return true;
}

/**
 * Authorized Command Center live-tracking read. 14A-8b.
 *
 * Credentials remain server-side. The browser never receives the API base
 * URL or bearer token. Authorization remains the API's IncidentAccessGuard
 * decision; this bridge does not attempt to reproduce facility membership
 * rules.
 *
 * The API response is validated before it crosses into browser-facing code.
 * An unexpected body is UNAVAILABLE, never silently interpreted as an empty
 * route or a stopped stream.
 */
export async function fetchOperatorTracking(
  incidentId: string,
): Promise<OperatorTrackingResult> {
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
      `${base}/incidents/${encodeURIComponent(incidentId)}/tracking`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch (error) {
    console.error(
      'Incident tracking could not reach the API:',
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
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string' && body.message) {
        message = body.message;
      }
    } catch {
      // A 403 remains a 403 even if its body is unreadable.
    }

    return { state: 'FORBIDDEN', message };
  }

  if (!response.ok) {
    console.error(`Incident tracking returned ${response.status}.`);
    return { state: 'UNAVAILABLE' };
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    console.error('Incident tracking returned unreadable JSON.');
    return { state: 'UNAVAILABLE' };
  }

  if (!isTrackingSnapshot(body)) {
    console.error('Incident tracking returned an unexpected shape.');
    return { state: 'UNAVAILABLE' };
  }

  return { state: 'READY', tracking: body };
}
