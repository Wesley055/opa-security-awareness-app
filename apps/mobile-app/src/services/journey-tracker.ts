/**
 * Journey fix sender - Sprint 10B item 9b.
 *
 * A module-scope singleton, deliberately NOT a hook. It owns a long-lived
 * watchPositionAsync subscription that must survive screen navigation, so it
 * cannot be tied to a component that unmounts on every route change.
 *
 * Lifecycle (ADR-010 Decision 3): started from app/sos.tsx AFTER a successful
 * activation, stopped from app/_layout.tsx when isAuthenticated goes false.
 * Starting only after activation is what makes a cancelled SOS unable to
 * strand an open session - reopen that question when SafeWalk lands.
 *
 * SANITISER (ADR-010 Decision 2). iOS reports an invalid reading as a
 * negative number, and a stationary device is the ordinary cause. Because
 * forbidNonWhitelisted is true and validation is per request, ONE negative
 * field on ONE fix rejects the ENTIRE batch of up to 200 fixes. So nothing
 * negative ever reaches the wire.
 *
 * Note the client is deliberately MORE aggressive than the API. The API
 * rejects garbage such as -20 on purpose; the client omits it instead,
 * because a client that ships a batch-killing value has failed at its one
 * job. Same asymmetry principle, different responsibility.
 *
 * QUEUE DISCIPLINE (trap 74). The refresh interceptor in api.ts cannot retry
 * a 401 that arrives while a refresh is already in flight, and this sender is
 * the first concurrent caller in the app. A fix is therefore NEVER removed
 * from the queue until a 2xx has actually returned.
 *
 * PERSISTENCE (item 9c). The queue is a SQLite table owned by
 * journey-queue-store.ts. Fixes survive process death. There is NO
 * in-memory queue: ADR-014 section 11 forbids a staging array, because a
 * second buffer would die with the process and reintroduce the loss this
 * replaces. Write serialization comes from the exclusive transaction.
 */
import { isAxiosError } from 'axios';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { api } from './api';
import {
  BACKGROUND_LOCATION_TASK,
  BACKGROUND_SESSION_KEY,
} from './journey-background-task';
import {
  ACTIVE_INCIDENT_QUEUE_DEPTH,
  cleanNonNegative,
  type TrackedFix,
  type TrackedFixSource,
} from './journey-fix-contract';
import { openJourneyQueueStore } from './journey-queue-store';
import type {
  JourneyQueueStore,
  StoredJourneyFix,
} from './journey-queue-store';

/** How often a flush is attempted. */
const FLUSH_INTERVAL_MS = 15000;

/**
 * Per-request override. The shared axios instance uses 10s, which a large
 * batch on a weak mobile link will exceed - and an axios timeout is
 * indistinguishable from being offline.
 */
const FLUSH_TIMEOUT_MS = 30000;

const TIME_INTERVAL_MS = 10000;

/**
 * DELIBERATELY 0. A distanceInterval suppresses updates until the device
 * physically moves that far - on Android it is setSmallestDisplacement - so
 * a stationary phone emits one cached fix and then nothing at all. Stationary
 * is the case a panic button exists for, so timeInterval drives instead.
 */
const DISTANCE_INTERVAL_M = 0;

/**
 * ArrayMaxSize(200) on IngestFixesDto. ONE batch of up to 200 is attempted
 * per flush cycle - replay is not chunked, so a deep queue drains over
 * successive cycles rather than in a single pass.
 */
const MAX_BATCH = 200;

/**
 * Storage-safety ceiling used ONLY while replayFault is non-null.
 */
const MAX_FAULTED_QUEUED_FIXES = ACTIVE_INCIDENT_QUEUE_DEPTH;

/**
 * Ordinary steady-state durable retention depth.
 */
const MAX_QUEUED_FIXES = ACTIVE_INCIDENT_QUEUE_DEPTH;

/**
 * ADR-010: course uses exactly -1, but the client range-checks rather than
 * matching that one value, because omitting is always safe and sending an
 * out-of-range heading would reject the batch. Unused today, kept so the
 * next person does not reinvent it wrongly.
 */
export const cleanHeading = (
  value: number | null | undefined,
): number | undefined =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 360
    ? value
    : undefined;

let running = false;
let generation = 0;
let sessionId: string | null = null;
let subscription: Location.LocationSubscription | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let captureSeq = 0;

let queueStore: JourneyQueueStore | null = null;
let durableQueued = 0;
let durabilityAvailable = false;
let durabilityFault: string | null = null;

/**
 * Replay outcomes are a SEPARATE fault domain from store failures. ADR-014
 * section 11: neither slot may overwrite the other, and one category never
 * clears the other.
 *
 * The `kind` discriminant exists so that no consumer parses `message` to
 * learn what happened. `message` is for logs and diagnostics only.
 */
export type ReplayFault =
  | { kind: 'HTTP_400'; status: 400; message: string }
  | { kind: 'HTTP_404'; status: 404; message: string }
  | { kind: 'HTTP_409'; status: 409; message: string }
  | {
      kind: 'DELETE_SHORTFALL';
      expected: number;
      actual: number;
      message: string;
    };

/**
 * Emergency-ceiling eviction is a POLICY event: not a store failure and not
 * a replay outcome. ADR-014 section 11 keeps it out of both fault slots.
 */
export type QueueEvictionDiagnostic = {
  kind: 'FAULTED_QUEUE_EMERGENCY_EVICTION';
  dropped: number;
  durableDepth: number;
  ceiling: number;
  message: string;
} | null;

let replayFault: ReplayFault | null = null;
let evictionDiagnostic: QueueEvictionDiagnostic = null;

/**
 * Wall clock at the moment tracking started. Anything captured before it is
 * a cached reading replayed by watchPositionAsync on subscribe.
 */
let trackingStartedAtMs = 0;

function log(message: string, extra?: unknown): void {
  if (extra === undefined) {
    console.log('[journey-tracker] ' + message);
    return;
  }
  console.log('[journey-tracker] ' + message, extra);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens the durable queue and restores the persisted capture sequence
 * before any fix is captured.
 *
 * openJourneyQueueStore() already enforces the ADR-014 section 11 platform
 * boundary and calls initialize() itself, so this function does NOT repeat
 * either check. Any rejection fails closed: tracking does not start.
 *
 * NOT DECIDED: whether a runtime storage fault on a supported platform
 * should degrade to the pre-9c in-memory path instead of failing closed.
 * The store does not yet distinguish a platform rejection from a runtime
 * one, and inferring it from the message text would be a guess.
 */
async function initializeDurableQueue(): Promise<boolean> {
  if (queueStore !== null) {
    return true;
  }

  try {
    const store = await openJourneyQueueStore();
    const persistedCaptureSequence = await store.getCaptureSequence();
    const persistedCount = await store.count();

    queueStore = store;
    captureSeq = Math.max(captureSeq, persistedCaptureSequence);
    durableQueued = persistedCount;
    durabilityAvailable = true;
    durabilityFault = null;

    log(
      'durable queue ready - ' + String(durableQueued) +
        ' rows, captureSequence=' + String(captureSeq),
    );

    return true;
  } catch (error: unknown) {
    queueStore = null;
    durableQueued = 0;
    durabilityAvailable = false;
    durabilityFault = errorMessage(error);

    log('DURABLE QUEUE UNAVAILABLE - not tracking', error);

    return false;
  }
}

/**
 * POST /journey/sessions is idempotent by construction: resolveForActivation
 * reuses an open session and the partial unique index guarantees at most one.
 * After an SOS the orchestrator has already opened an INCIDENT session, so
 * this returns reused=true with purpose INCIDENT even though MANUAL was
 * asked for. That is the documented contract, not a bug.
 *
 * MANUAL is sent explicitly rather than omitted: INCIDENT is not in
 * CLIENT_PURPOSES, and relying on an unread server-side default would be a
 * guess.
 */
async function acquireSession(): Promise<string | null> {
  try {
    const { data } = await api.post('/journey/sessions', { purpose: 'MANUAL' });
    const id: unknown = data?.sessionId;
    if (typeof id !== 'string' || id.length === 0) {
      log('session response carried no sessionId');
      return null;
    }
    log(
      'session ' + id + ' reused=' + String(data?.reused) +
        ' purpose=' + String(data?.purpose),
    );
    return id;
  } catch (err: unknown) {
    log('session start FAILED - not tracking', err);
    return null;
  }
}

/**
 * Builds the fix and writes it durably.
 *
 * captureSeq increments synchronously, BEFORE the async write, so the
 * idempotency key is minted first and stays stable across retries. A failed
 * write therefore burns a sequence number. ADR-014 section 11: gaps are
 * correct. The requirement is monotonic uniqueness, not contiguity. Never
 * decrement or reuse a burned sequence.
 */
async function enqueueDurable(
  position: Location.LocationObject,
  forSession: string,
): Promise<void> {
  const store = queueStore;
  if (store === null) {
    throw new Error('durable queue is not open');
  }

  const coords = position.coords;

  const ms =
    typeof position.timestamp === 'number' && Number.isFinite(position.timestamp)
      ? position.timestamp
      : Date.now();

  // PRE-START FIX GUARD. watchPositionAsync replays a cached last-known
  // position on subscribe. Its recordedAt can PRECEDE the activation fix,
  // which makes recordedAt run backwards against sequence and lets the
  // tracking page show "last seen" jumping into the past. The activation
  // fix already holds that same position, so dropping it loses nothing.
  if (ms < trackingStartedAtMs) {
    log('ignoring cached pre-start fix from ' + new Date(ms).toISOString());
    return;
  }

  captureSeq += 1;

  // Deterministic and stable across retries, which is what makes retry safe.
  // sessionId(36) + ':' + ms(13) + ':' + seq stays far inside Length(1,128).
  const fix: TrackedFix = {
    idempotencyKey: forSession + ':' + String(ms) + ':' + String(captureSeq),
    source: 'foreground',
    latitude: coords.latitude,
    longitude: coords.longitude,
    // MUST be capture time, not send time. A buffered fix flushed later still
    // carries its original capture time - that is the point of the buffer.
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

  // ADR-014 section 11. The TRACKER owns the bound; the store stays free of
  // replay policy and simply enforces the number it is handed.
  const faulted = replayFault !== null;

  // deferOverflowEviction tracks the in-flight replay cycle. Evicting rows a
  // flush is holding would make the delete count fall short of the keys sent
  // and raise a false integrity fault.
  //
  // The EMERGENCY ceiling is never deferred. Deferral protects an ordinary
  // replay batch from the steady-state bound; it must not disable the
  // storage-safety ceiling. A false shortfall cannot result, because the
  // ceiling only applies once replayFault is already set.
  const result = await store.enqueue(
    { sessionId: forSession, fix, captureSequence: captureSeq },
    {
      maxQueuedFixes: faulted ? MAX_FAULTED_QUEUED_FIXES : MAX_QUEUED_FIXES,
      deferOverflowEviction: flushing && !faulted,
    },
  );

  durableQueued = result.durableDepth;

  if (result.dropped > 0) {
    if (faulted) {
      // A POLICY event, not a store failure and not a replay outcome.
      // ADR-014 section 11 keeps it out of both fault slots, and it clears
      // neither.
      const emergencyMessage =
        'emergency ceiling eviction - dropped ' + String(result.dropped) +
        ' oldest fixes at ceiling ' + String(MAX_FAULTED_QUEUED_FIXES);
      evictionDiagnostic = {
        kind: 'FAULTED_QUEUE_EMERGENCY_EVICTION',
        dropped: result.dropped,
        durableDepth: result.durableDepth,
        ceiling: MAX_FAULTED_QUEUED_FIXES,
        message: emergencyMessage,
      };
      log('FAULTED QUEUE EMERGENCY EVICTION - ' + emergencyMessage);
    } else {
      log(
        'QUEUE OVERFLOW - dropped ' + String(result.dropped) +
          ' oldest fixes, durable depth ' + String(result.durableDepth),
      );
    }
  }

  if (!result.inserted) {
    log('duplicate idempotency key not inserted: ' + fix.idempotencyKey);
  }
}

/**
 * Capture entry point. watchPositionAsync does not await the promise a
 * callback returns, so the write cannot be awaited here. ADR-014 section 11
 * requires an EXPLICIT rejection handler rather than a floating promise: a
 * lost fix with no local signal is indistinguishable from one never captured.
 */
function enqueue(position: Location.LocationObject, forSession: string): void {
  void enqueueDurable(position, forSession).catch((error: unknown) => {
    durabilityFault = errorMessage(error);
    log('DURABLE WRITE FAILED - fix not persisted', error);
  });
}

/**
 * PROJECTION IS MANDATORY. listOldest returns StoredJourneyFix, which EXTENDS
 * TrackedFix with queueId and sessionId. TypeScript will not stop those
 * reaching the wire - excess property checks only fire on object literals -
 * and forbidNonWhitelisted is true, so one extra key 400s the whole batch.
 */
function toPayload(row: StoredJourneyFix): TrackedFix {
  const fix: TrackedFix = {
    idempotencyKey: row.idempotencyKey,
    source: row.source,
    latitude: row.latitude,
    longitude: row.longitude,
    recordedAt: row.recordedAt,
  };

  // Absent, not null. "Column is NULL" and "key absent" differ to a
  // whitelisting validator.
  if (row.accuracy !== undefined) {
    fix.accuracy = row.accuracy;
  }

  if (row.speed !== undefined) {
    fix.speed = row.speed;
  }

  return fix;
}

/**
 * Never removes a row until a 2xx returns (trap 74). Takes the session
 * explicitly so a final flush during teardown still has one.
 */
async function flush(forSession: string): Promise<void> {
  const store = queueStore;
  if (flushing || store === null) {
    return;
  }
  flushing = true;

  try {
    const rows = await store.listOldest(MAX_BATCH);
    if (rows.length === 0) {
      return;
    }

    await api.post(
      '/journey/fixes',
      { sessionId: forSession, fixes: rows.map(toPayload) },
      { timeout: FLUSH_TIMEOUT_MS },
    );

    // A 2xx proves the queue head is acceptable to the server, so any
    // persistent replay fault is resolved. ADR-014 section 11. This runs
    // BEFORE the delete, so a shortfall in this same cycle can immediately
    // set it again - which is why it is not cleared in the finally block.
    replayFault = null;

    const keys = rows.map((row) => row.idempotencyKey);
    const removed = await store.deleteAcknowledged(keys);

    if (removed !== keys.length) {
      // ADR-014 section 11 integrity fault. Rows whose keys matched are
      // already deleted; the remainder stay durable. Stop the cycle rather
      // than continue past a detected inconsistency. A shortfall is a
      // disagreement discovered during REPLAY, not a store operation
      // failure, so it belongs to replayFault. The numbers are carried as
      // FIELDS: nothing may parse `message` to recover them.
      const shortfallMessage =
        'replay delete shortfall: expected ' + String(keys.length) +
        ' and actual ' + String(removed);
      replayFault = {
        kind: 'DELETE_SHORTFALL',
        expected: keys.length,
        actual: removed,
        message: shortfallMessage,
      };
      log('INTEGRITY FAULT - ' + shortfallMessage);
      durableQueued = await store.count();
      return;
    }

    durableQueued = await store.count();
    log(
      'flushed ' + String(keys.length) + ' fixes, ' +
        String(durableQueued) + ' still durable',
    );
  } catch (error: unknown) {
    // NOTHING is ever discarded here - trap 74 and ADR-014 section 11. Every
    // branch below retains every row. Classification decides only whether a
    // PERSISTENT fault is raised, never whether data is dropped.
    //
    // isAxiosError is the library's own guard. A structural check would
    // accept any unrelated object carrying a response.status.
    const status = isAxiosError(error) ? error.response?.status : undefined;
    const detail = errorMessage(error);

    if (status === 400) {
      // Two conditions with opposite lifetimes share this status, and the
      // wire cannot distinguish them under Phase B. Retain, halt, surface.
      replayFault = { kind: 'HTTP_400', status: 400, message: detail };
      log('REPLAY REJECTED 400 - halting, KEEPING all durable rows');
    } else if (status === 404) {
      // INDETERMINATE. A 404 is deliberately ambiguous server-side: it may
      // be a transient identity or auth problem, so it can never mean the
      // row is dead.
      replayFault = { kind: 'HTTP_404', status: 404, message: detail };
      log('REPLAY INDETERMINATE 404 - halting, rows never deleted');
    } else if (status === 409) {
      // ENDED. Recurs every cycle by design until Phase C.
      replayFault = { kind: 'HTTP_409', status: 409, message: detail };
      log('REPLAY REJECTED 409 - session ENDED, KEEPING all durable rows');
    } else if (status === 401) {
      // Transient authentication recovery. Reachable when the refresh
      // interceptor is already refreshing and cannot retry this request.
      // Deliberately does NOT set replayFault, and must not clear one.
      log('REPLAY AUTH 401 - transient, retrying next cycle');
    } else {
      log(
        'flush failed - KEEPING ' + String(durableQueued) + ' durable rows',
        error,
      );
    }
  } finally {
    flushing = false;

    // ADR-014 section 11. Normal steady-state eviction is suppressed while a
    // persistent replay fault is set: the oldest rows are exactly what a
    // halted queue has been holding longest. The emergency ceiling still
    // applies, but it is enforced in enqueue, not here.
    //
    // No early return - a return inside finally would swallow the pending
    // completion of the try block.
    if (replayFault !== null) {
      log('TRIM SUPPRESSED - replay faulted, no steady-state eviction');
    } else {
      // Eviction deferred during the cycle is applied now.
      try {
        const trimmed = await store.trimToDepth(MAX_QUEUED_FIXES);
        durableQueued = trimmed.durableDepth;

        if (trimmed.dropped > 0) {
          log(
            'DEFERRED OVERFLOW - dropped ' + String(trimmed.dropped) +
              ' oldest fixes after replay',
          );
        }
      } catch (error: unknown) {
        log('deferred trim failed', error);
      }
    }
  }
}

/**
 * Idempotent. Safe to call when already running.
 *
 * The generation counter is carried over from sos.tsx and matters MORE here,
 * not less: a long-lived subscription gives a stale async result many more
 * chances to land after a stop.
 */
export async function startTracking(): Promise<void> {
  if (running) {
    log('already running - ignoring start');
    return;
  }

  running = true;
  generation += 1;
  const gen = generation;

  // SOS has already requested permission by the time we get here, so this
  // only reads it. Requesting again would put a second dialog in front of
  // someone who has just pressed a panic button.
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) {
    log('foreground location not granted - not tracking');
    running = false;
    return;
  }

  const durable = await initializeDurableQueue();
  if (!durable) {
    running = false;
    return;
  }

  if (!running || gen !== generation) {
    log('stopped while opening the durable queue');
    return;
  }

  const id = await acquireSession();
  if (!id) {
    running = false;
    return;
  }
  if (!running || gen !== generation) {
    log('stopped while acquiring the session');
    return;
  }
  sessionId = id;

  // Set BEFORE subscribing, so the cached fix that arrives immediately
  // afterwards is measured against a start time that already exists.
  trackingStartedAtMs = Date.now();

  // EXACTLY ONE CAPTURE PATH RUNS. Background when permitted, the
  // foreground watcher otherwise - never both. Two OS subscriptions
  // writing to one queue would DOUBLE every fix: the idempotency key
  // carries a platform timestamp and an independently drawn sequence,
  // so two readings of the same position produce two DIFFERENT keys and
  // INSERT OR IGNORE cannot collapse them. Duplicate history in an
  // emergency record is worse than a slightly slower cadence.
  const backgroundStarted = await startBackgroundCapture(id);

  if (!backgroundStarted) {
    try {
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: TIME_INTERVAL_MS,
          distanceInterval: DISTANCE_INTERVAL_M,
        },
        (position) => {
          if (!running || gen !== generation) {
            return;
          }
          enqueue(position, id);
        },
      );
    } catch (err: unknown) {
      log('watchPositionAsync failed', err);
      running = false;
      sessionId = null;
      return;
    }
  }

  if (!running || gen !== generation) {
    subscription?.remove();
    subscription = null;
    return;
  }

  flushTimer = setInterval(() => {
    if (sessionId) {
      void flush(sessionId);
    }
  }, FLUSH_INTERVAL_MS);

  log('started for session ' + id);
}

/**
 * Starts OS-level background capture. Returns true when it OWNS capture.
 *
 * A false return is not a failure state - it means the caller must start
 * the foreground watcher instead. Background permission is requested only
 * AFTER foreground is granted, which is the order Android requires, and a
 * refusal degrades to foreground-only rather than blocking the SOS.
 *
 * The session id goes to SecureStore because the task runs in a separate JS
 * context that cannot see this module's variables.
 */
async function startBackgroundCapture(forSession: string): Promise<boolean> {
  try {
    const background = await Location.requestBackgroundPermissionsAsync();

    if (!background.granted) {
      log('background location DENIED - foreground capture only');
      return false;
    }

    await SecureStore.setItemAsync(BACKGROUND_SESSION_KEY, forSession);

    const already = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_LOCATION_TASK,
    );

    if (!already) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: TIME_INTERVAL_MS,
        distanceInterval: DISTANCE_INTERVAL_M,
        // WITHOUT THIS, ANDROID 10+ THROTTLES BACKGROUND LOCATION to a few
        // updates per hour - which is what the measured 3617-second gap
        // looks like. The persistent notification is the price of not
        // being throttled, and a person being tracked during an emergency
        // has a right to see that it is happening.
        foregroundService: {
          notificationTitle: 'OPA emergency alert active',
          notificationBody:
            'Your location is being shared with your emergency contacts.',
          notificationColor: '#D92D20',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      });
    }

    log('background capture OWNS this session: ' + forSession);
    return true;
  } catch (err: unknown) {
    // Anything unexpected falls back rather than leaving the user untracked.
    // The key is cleared so a half-registered task cannot write fixes the
    // foreground watcher is also capturing.
    log('background capture unavailable - foreground only', err);
    void SecureStore.deleteItemAsync(BACKGROUND_SESSION_KEY);
    return false;
  }
}

/**
 * Stops OS-level capture and clears the shared session id.
 *
 * Both steps are attempted independently: leaving a stale session key would
 * let a late OS delivery attach to a closed incident, and leaving the task
 * registered would keep the notification on screen after the emergency ends.
 */
async function stopBackgroundCapture(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BACKGROUND_SESSION_KEY);
  } catch (err: unknown) {
    log('failed to clear the background session key', err);
  }

  try {
    const registered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (registered) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      log('background capture stopped');
    }
  } catch (err: unknown) {
    log('failed to stop background capture', err);
  }
}

/**
 * Idempotent, and safe to call when nothing is running - _layout.tsx fires it
 * on cold start while isAuthenticated is still false.
 *
 * Attempts one final best-effort flush. Rows that never got a 2xx stay in
 * SQLite and are replayed after the next start.
 */
export async function stopTracking(): Promise<void> {
  const hadLocalTracking = running || subscription !== null || flushTimer !== null;
  const finalSession = sessionId;

  generation += 1;
  running = false;

  if (subscription) {
    subscription.remove();
    subscription = null;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  sessionId = null;

  // Ordered deliberately: clear the cross-context session identity and
  // stop OS background delivery BEFORE the final flush. A late TaskManager
  // delivery can therefore never attach movement to an incident that has
  // already been closed by the server.
  // This MUST run even when local module state is idle. TaskManager and
  // SecureStore survive JS-context restarts, so a cold-start logout can have
  // no local subscription while a stale background task still exists.
  await stopBackgroundCapture();

  if (!hadLocalTracking && finalSession === null) {
    return;
  }

  if (finalSession) {
    await flush(finalSession);
  }

  log(
    'stopped - ' + String(durableQueued) + ' fixes durable in SQLite',
  );
}

/**
 * Test and diagnostic hook. Not used by the app.
 *
 * There is no in-memory queue. `queued` and `durableQueued` are both the
 * durable row count, kept equal so existing assertions stay meaningful.
 * durableDepth from a mutation is authoritative; count() is the
 * initialization read only.
 */
export function trackerDebugState(): {
  running: boolean;
  sessionId: string | null;
  queued: number;
  captureSequence: number;
  durableQueued: number;
  durabilityAvailable: boolean;
  durabilityFault: string | null;
  replayFault: ReplayFault | null;
  evictionDiagnostic: QueueEvictionDiagnostic;
} {
  return {
    running: running,
    sessionId: sessionId,
    queued: durableQueued,
    captureSequence: captureSeq,
    durableQueued: durableQueued,
    durabilityAvailable: durabilityAvailable,
    durabilityFault: durabilityFault,
    replayFault: replayFault,
    evictionDiagnostic: evictionDiagnostic,
  };
}

/** Test-only flush trigger. Nothing in the app imports this. */
export async function flushForTests(): Promise<void> {
  if (sessionId !== null) {
    await flush(sessionId);
  }
}

/**
 * Test-only state reset. Nothing in the app imports this.
 *
 * stopTracking() owns the subscription, timer and running flag; this only
 * clears what it does not.
 */
export function resetTrackerStateForTests(): void {
  void stopTracking();

  generation = 0;
  flushing = false;
  captureSeq = 0;
  trackingStartedAtMs = 0;

  queueStore = null;
  durableQueued = 0;
  durabilityAvailable = false;
  durabilityFault = null;
  replayFault = null;
  evictionDiagnostic = null;
}
