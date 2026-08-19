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
async function persistBackgroundFix(
  position: Location.LocationObject,
  sessionId: string,
  store: JourneyQueueStore,
): Promise<void> {
  const captureSequence = (await store.getCaptureSequence()) + 1;

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
  const fix: TrackedFix = {
    idempotencyKey: sessionId + ':' + String(ms) + ':' + String(captureSequence),
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

  const result = await store.enqueue(
    { sessionId, fix, captureSequence },
    {
      // The SAME depth the foreground path uses. A background capture must
      // never discard emergency history the foreground path would have kept.
      maxQueuedFixes: ACTIVE_INCIDENT_QUEUE_DEPTH,
      // NEVER defer. Deferral protects an in-flight replay batch, and this
      // context cannot observe whether a replay is in flight. Deferring
      // blindly would let the queue grow unbounded through a long drive with
      // no foreground app to trim it.
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
  await persistBackgroundFix(position, sessionId, store);
}

/**
 * One native queue handle per TaskManager invocation.
 *
 * Android may deliver several positions in one callback. Reopening SQLite for
 * every element created avoidable native-handle churn in the exact headless
 * path that has produced prepareAsync/finalizeAsync failures on the device.
 *
 * Session ownership is also snapshotted once for the batch. A single native
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

  for (const position of locations) {
    try {
      await persistBackgroundFix(position, sessionId, store);
    } catch (err: unknown) {
      // One bad fix must not abandon the remainder of the native batch.
      log('failed to store a background fix', err);
    }
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
