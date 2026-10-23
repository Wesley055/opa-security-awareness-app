/**
 * One OS location task shared by ordinary and emergency tracking bootstrap.
 * Each delivery snapshots its canonical session, atomically persists the batch,
 * then attempts background-safe replay under the shared SQLite replay lease.
 * Failed sends retain durable rows. Queue schema creation belongs to bootstrap;
 * per-location callbacks only attach to the initialized store.
 */
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import {
  ACTIVE_INCIDENT_QUEUE_DEPTH,
  cleanNonNegative,
  type TrackedFix,
} from './journey-fix-contract';
import {
  openJourneyQueueStoreForBackground,
} from './journey-queue-store';
import { backgroundApi } from './api';
import {
  createJourneyReplayOwnerToken,
  replayJourneySessionWithLease,
} from './journey-replay';

export const BACKGROUND_LOCATION_TASK = 'opa-background-location';


/**
 * The active session id, shared across JS contexts.
 *
 * SecureStore rather than the journey_queue_meta table: that table's `value`
 * column is INTEGER NOT NULL and a session id is a UUID, so using it would
 * mean migrating the Sprint 10B schema. SecureStore is already a dependency,
 * already used for tokens by api.ts, and readable from both contexts.
 */
export const BACKGROUND_SESSION_KEY = 'opa-background-session-id';

function log(message: string, extra?: unknown): void {
  if (extra === undefined) {
    console.log('[journey-background] ' + message);
    return;
  }
  console.log('[journey-background] ' + message, extra);
}

interface BackgroundLocationPayload {
  locations?: Location.LocationObject[];
}

/**
 * Writes one captured position to the durable queue.
 *
 * Exported for testing: TaskManager.defineTask's callback cannot be invoked
 * directly from a spec, and a task that is only exercised through its
 * registration is a task nobody has tested.
 */
function toBackgroundBatchItem(position: Location.LocationObject): {
  capturedAtMs: number;
  fix: Omit<TrackedFix, 'idempotencyKey'>;
} {
  const coords = position.coords;
  const ms =
    typeof position.timestamp === 'number' && Number.isFinite(position.timestamp)
      ? position.timestamp
      : Date.now();

  // TRUTHFUL PROVENANCE. 'background' is already an accepted wire value -
  // TRACKED_SOURCES in ingest-fixes.dto.ts is
  // ['foreground', 'background', 'manual'] and the column is VarChar(32),
  // not an enum, so no API change or migration is involved. Writing
  // 'foreground' here to avoid checking would have put a false claim into a
  // tamper-evident record.
  const fix: Omit<TrackedFix, 'idempotencyKey'> = {
    source: 'background',
    latitude: coords.latitude,
    longitude: coords.longitude,
    recordedAt: new Date(ms).toISOString(),
  };

  const accuracy = cleanNonNegative(coords.accuracy);
  if (accuracy !== undefined) {
    fix.accuracy = accuracy;
  }

  const speed = cleanNonNegative(coords.speed);
  if (speed !== undefined) {
    fix.speed = speed;
  }

  return {
    capturedAtMs: ms,
    fix,
  };
}
/**
 * Single-fix entry point retained for direct callers and focused tests.
 *
 * A standalone call owns one store open. TaskManager does NOT call this in a
 * loop; captureBackgroundBatch() owns one open for the entire OS delivery.
 */
export async function captureBackgroundFix(
  position: Location.LocationObject,
): Promise<void> {
  const sessionId = await SecureStore.getItemAsync(BACKGROUND_SESSION_KEY);

  if (sessionId === null || sessionId.length === 0) {
    log('no active session - discarding background fix');
    return;
  }

  const store = await openJourneyQueueStoreForBackground();

  const result = await store.enqueueBatch(
    sessionId,
    [toBackgroundBatchItem(position)],
    {
      maxQueuedFixes: ACTIVE_INCIDENT_QUEUE_DEPTH,
      deferOverflowEviction: false,
    },
  );

  if (result.dropped > 0) {
    log(
      'background queue overflow - dropped ' + String(result.dropped) +
        ' oldest fixes, depth ' + String(result.durableDepth),
    );
  }
}

/**
 * One queue-store owner per headless JS context.
 *
 * GAP-01A vc4 deliberately reuses the store returned by
 * openJourneyQueueStoreForBackground() across TaskManager deliveries. Android
 * may deliver several positions in one callback, and multiple callbacks may
 * execute during one emergency, but they must not repeatedly acquire another
 * expo-sqlite wrapper/reference for the same cached NativeDatabase.
 *
 * Session ownership is still snapshotted once for each native batch. A single
 * delivery cannot therefore split itself across two incident ids.
 */
export async function captureBackgroundBatch(
  locations: readonly Location.LocationObject[],
): Promise<void> {
  if (locations.length === 0) {
    return;
  }

  const sessionId = await SecureStore.getItemAsync(BACKGROUND_SESSION_KEY);
  if (sessionId === null || sessionId.length === 0) {
    log('no active session - discarding background batch');
    return;
  }
  const store = await openJourneyQueueStoreForBackground();
  try {
    const result = await store.enqueueBatch(
      sessionId,
      locations.map(toBackgroundBatchItem),
      {
        maxQueuedFixes: ACTIVE_INCIDENT_QUEUE_DEPTH,
        deferOverflowEviction: false,
      },
    );
    log('[OPA-TRACKING] LOCATION_BATCH_DURABLE count=' + String(locations.length));
    if (result.dropped > 0) {
      log(
        'background queue overflow - dropped ' + String(result.dropped) +
          ' oldest fixes, depth ' + String(result.durableDepth),
      );
    }

    /*
     * GAP-01B / VC6-A.
     *
     * The native fix is durable BEFORE replay is attempted.
     *
     * TaskManager is the execution context already proven on-device to keep
     * receiving location while the screen is locked. Each successful native
     * delivery therefore becomes a replay opportunity for the ACTIVE session.
     *
     * backgroundApi attaches the persisted access token but deliberately has
     * no destructive foreground refresh/logout response interceptor.
     *
     * Any replay failure leaves the just-captured row durable.
     */
    const replayOwnerToken =
      createJourneyReplayOwnerToken('background');

    try {
      const replay = await replayJourneySessionWithLease(
        store,
        sessionId,
        replayOwnerToken,
        backgroundApi,
      );

      if (replay.kind === 'DELETE_SHORTFALL') {
        log(
          'BGREPLAY DELETE_SHORTFALL session=' + sessionId +
            ' expected=' + String(replay.expected) +
            ' actual=' + String(replay.actual) +
            ' durableDepth=' + String(replay.durableDepth),
        );
      } else if (replay.kind === 'HTTP_ERROR') {
        log(
          'BGREPLAY HTTP_ERROR session=' + sessionId +
            ' status=' + String(replay.status) +
            ' message=' + replay.message +
            ' - durable rows retained',
        );
      } else {
        log(
          'BGREPLAY ' + replay.kind +
            ' session=' + sessionId,
        );
      }
    } catch (replayError: unknown) {
      log(
        'BGREPLAY FAILED - durable rows retained',
        replayError,
      );
    }
  } catch (err: unknown) {
    // One native delivery is one atomic queue transaction. A failure leaves
    // the whole batch uncommitted rather than producing a partially sequenced
    // emergency record.
    log('failed to store background batch', err);
    throw err;
  }
}

/**
 * Registered at module load, which is what makes the task resolvable after
 * process death: Android restarts the app into a headless JS context and
 * looks the task up by name, so defineTask must have run by then.
 */
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    log('task error', error);
    return;
  }

  const payload = data as BackgroundLocationPayload | undefined;
  const locations = payload?.locations ?? [];

  if (locations.length === 0) {
    return;
  }

  // One store open for the whole native delivery. captureBackgroundBatch()
  // still writes positions sequentially because enqueue advances the persisted
  // sequence transactionally; parallel writes would only create contention.
  await captureBackgroundBatch(locations);
});
