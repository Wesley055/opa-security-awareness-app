import { isAxiosError, type AxiosInstance } from 'axios';
import { api } from './api';
import type { TrackedFix } from './journey-fix-contract';
import type {
  JourneyQueueStore,
  StoredJourneyFix,
} from './journey-queue-store';

/**
 * ArrayMaxSize(200) on the Journey ingest DTO.
 */
export const JOURNEY_REPLAY_MAX_BATCH = 200;

/**
 * Deliberately matches the existing Journey tracker replay override.
 *
 * The shared axios client defaults to 10s, but Journey replay already allows
 * 30s because a large emergency batch on a weak mobile link may exceed 10s.
 */
export const JOURNEY_REPLAY_TIMEOUT_MS = 30000;

/**
 * Longer than the HTTP attempt.
 *
 * Normal completion releases immediately. Process death leaves a bounded
 * stale lease that another context may take after expiry.
 */
export const JOURNEY_REPLAY_LEASE_MS = 45000;

export type JourneyReplayResult =
  | {
      kind: 'LEASE_BUSY';
    }
  | {
      kind: 'EMPTY';
    }
  | {
      kind: 'SENT';
      sent: number;
      removed: number;
      durableDepth: number;
    }
  | {
      kind: 'DELETE_SHORTFALL';
      expected: number;
      actual: number;
      durableDepth: number;
    }
  | {
      kind: 'HTTP_ERROR';
      status: number | undefined;
      message: string;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The durable row is NOT the wire DTO.
 *
 * StoredJourneyFix additionally contains queueId and sessionId. Sending those
 * fields would fail the API's whitelist validation. Optional telemetry is also
 * omitted rather than sent as null.
 */
function toPayload(row: StoredJourneyFix): TrackedFix {
  const fix: TrackedFix = {
    idempotencyKey: row.idempotencyKey,
    source: row.source,
    latitude: row.latitude,
    longitude: row.longitude,
    recordedAt: row.recordedAt,
  };

  if (row.accuracy !== undefined) {
    fix.accuracy = row.accuracy;
  }

  if (row.speed !== undefined) {
    fix.speed = row.speed;
  }

  return fix;
}

/**
 * Generates an owner token for one replay attempt.
 *
 * This is lease ownership only. It is not a Journey identity or wire
 * idempotency key.
 */
export function createJourneyReplayOwnerToken(
  context: 'foreground' | 'background',
): string {
  return (
    context +
    ':' +
    String(Date.now()) +
    ':' +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Replays ONE explicitly named Journey session under the durable SQLite lease.
 *
 * The caller supplies replay policy:
 *
 * - foreground may select active or historical sessions;
 * - TaskManager supplies only the active emergency session.
 *
 * The HTTP client is injectable deliberately. Foreground callers default to
 * the ordinary `api` client. The headless TaskManager MUST pass backgroundApi,
 * whose request interceptor attaches the token but which has no destructive
 * refresh/logout response interceptor.
 *
 * Durability:
 *
 * - never delete before a successful 2xx;
 * - delete only from the session that was sent;
 * - surface sqlite3_changes() disagreement as DELETE_SHORTFALL;
 * - HTTP/network failure keeps every queued row;
 * - always attempt owner-protected lease release.
 */
export async function replayJourneySessionWithLease(
  store: JourneyQueueStore,
  replaySession: string,
  ownerToken: string,
  client: AxiosInstance = api,
): Promise<JourneyReplayResult> {
  if (replaySession.length === 0) {
    throw new Error('replaySession must not be empty.');
  }

  if (ownerToken.length === 0) {
    throw new Error('ownerToken must not be empty.');
  }

  const acquired = await store.tryAcquireReplayLease(
    ownerToken,
    Date.now(),
    JOURNEY_REPLAY_LEASE_MS,
  );

  if (!acquired) {
    return { kind: 'LEASE_BUSY' };
  }

  try {
    const rows = await store.listOldestForSession(
      replaySession,
      JOURNEY_REPLAY_MAX_BATCH,
    );

    if (rows.length === 0) {
      return { kind: 'EMPTY' };
    }

    try {
      await client.post(
        '/journey/fixes',
        {
          sessionId: replaySession,
          fixes: rows.map(toPayload),
        },
        {
          timeout: JOURNEY_REPLAY_TIMEOUT_MS,
        },
      );
    } catch (error: unknown) {
      return {
        kind: 'HTTP_ERROR',
        status: isAxiosError(error)
          ? error.response?.status
          : undefined,
        message: errorMessage(error),
      };
    }

    const keys = rows.map((row) => row.idempotencyKey);

    const removed = await store.deleteAcknowledgedForSession(
      replaySession,
      keys,
    );

    const durableDepth = await store.count();

    if (removed !== keys.length) {
      return {
        kind: 'DELETE_SHORTFALL',
        expected: keys.length,
        actual: removed,
        durableDepth,
      };
    }

    return {
      kind: 'SENT',
      sent: keys.length,
      removed,
      durableDepth,
    };
  } finally {
    try {
      await store.releaseReplayLease(ownerToken);
    } catch (error: unknown) {
      /*
       * Do not replace the actual replay result with a cleanup failure.
       * Expiry is the recovery mechanism if release itself fails.
       */
      console.log(
        '[journey-replay] replay lease release failed',
        error,
      );
    }
  }
}