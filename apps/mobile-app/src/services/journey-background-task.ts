/**
 * Background location capture - Sprint 11A.
 *
 * WHY THIS EXISTS. On 10 August 2026 a 26 km drive with an active SOS was
 * recorded as TWO POINTS: where the phone was when the screen went off, and
 * where it was when the screen came back on. Measured in production -
 * max_gap_s=3617, total_distance_m=26234, of which 26159 were a single jump.
 *
 * The durable queue was not at fault; max_upload_lag_s=3680 proves it
 * buffered correctly for an hour. Capture had simply stopped, because
 * `watchPositionAsync` in journey-tracker.ts is a FOREGROUND-ONLY API.
 *
 * The execution plan's frozen principle names location capture among the
 * things that must ACTUALLY WORK. This file is what makes that true.
 *
 * ---
 *
 * THIS TASK CAPTURES. IT DOES NOT SEND.
 *
 * A TaskManager task runs in a SEPARATE JAVASCRIPT CONTEXT. Nothing in
 * journey-tracker.ts's module scope exists here - not `queueStore`, not
 * `sessionId`, not `captureSeq`, not `replayFault`, not `flushing`.
 *
 * Replay policy depends on all of those, so replay stays where it is: the
 * foreground tracker keeps SOLE ownership of flushing, the ADR-014 section 11
 * fault slots and the eviction bounds. This task opens its own store handle,
 * reads the persisted capture sequence, writes one row, and stops.
 *
 * When the app returns to the foreground the tracker's flush timer drains
 * whatever accumulated. That is why a background upload failure cannot exist
 * here: no upload is attempted.
 *
 * ---
 *
 * THIS IS THE SOLE CAPTURE PATH WHILE IT RUNS. The tracker starts EITHER
 * this task OR watchPositionAsync, never both. Two OS subscriptions writing
 * to one queue would double every fix: the idempotency key carries a
 * platform timestamp and an independently drawn sequence, so two readings of
 * the same position produce two DIFFERENT keys and INSERT OR IGNORE cannot
 * collapse them. Duplicate history in an emergency record is worse than a
 * slightly slower capture cadence.
 *
 * ---
 *
 * SEQUENCE SAFETY. captureSequence is persisted in SQLite metadata and read
 * fresh on every invocation, never cached in module scope. Two contexts
 * therefore cannot mint the same sequence, and `enqueue` advances it inside
 * the same exclusive transaction that writes the row. ADR-014 section 11
 * permits gaps; it requires monotonic uniqueness, which this preserves.
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
  type JourneyQueueStore,
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
