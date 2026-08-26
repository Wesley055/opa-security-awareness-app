import { Platform } from 'react-native';
import {
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';
import type {
  TrackedFix,
  TrackedFixSource,
} from './journey-fix-contract';

const DATABASE_NAME = 'opa-journey-queue.db';

/**
 * GAP-01A / vc4 discriminator.
 *
 * The headless TaskManager path owns one store promise per JS context instead
 * of calling openDatabaseAsync() for every native location delivery.
 *
 * expo-sqlite 16.0.10 caches NativeDatabase objects by path/options when
 * useNewConnection is false. Repeated openDatabaseAsync() calls therefore add
 * JS/native references to the same cached native database rather than
 * necessarily opening a distinct sqlite3 connection.
 *
 * vc3 proved the native layer can enter a persistent prepare/run failure state.
 * vc4 asks one narrow question: does removing repeated background acquisition
 * of that cached NativeDatabase prevent the collapse?
 *
 * A failed creation is NOT cached permanently. The catch below clears this
 * promise so a later TaskManager invocation may attempt a clean acquisition.
 *
 * No close is performed here. Ownership lasts for the lifetime of this JS
 * context; expo-sqlite/module teardown owns native destruction.
 */
let backgroundStorePromise: Promise<JourneyQueueStore> | null = null;

/**
 * WAL IS INTENDED AND IS NOT CURRENTLY ENABLED. Read this before adding it.
 *
 * Both runtime ways of setting it were measured failing on a real Samsung
 * device on 18 August 2026, under Expo SDK 54 / expo-sqlite 16:
 *
 *   inside the execAsync batch
 *     Call to function 'NativeDatabase.execAsync' has been rejected.
 *     Caused by: java.lang.NullPointerException
 *
 *   through getFirstAsync, which prepares a statement
 *     Call to function 'NativeDatabase.prepareAsync' has been rejected.
 *
 * The first failed in the headless TaskManager context on every background
 * invocation, so every fix Android delivered was captured and discarded.
 * The second failed in the foreground tracker, which then refused to start
 * at all - DURABLE QUEUE UNAVAILABLE.
 *
 * DEFAULT SQLITE JOURNALING REMAINS IN USE. Rollback mode is crash-safe.
 * What WAL would add is concurrent readers and sequential writes, and
 * whether this queue needs them is a real question rather than a settled
 * one - two JS contexts do share this file. It is DEFERRED, NOT DISMISSED.
 *
 * WHY THIS IS NOT SILENT DEBT: the compatibility question is bounded and
 * named. API misuse, an expo-sqlite 16 regression, a headless-context
 * limitation, or Samsung-specific behaviour? Nobody has measured. Answer
 * that before the pilot.
 *
 * DO NOT REINTRODUCE RUNTIME journal_mode MUTATION IN THE HEADLESS TASK
 * under any circumstances. If WAL becomes settable it belongs in
 * bootstrapJourneyQueueStore and nowhere else.
 *
 * foreign_keys returns no rows and is safe in this batch.
 */
const CREATE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS journey_queue (
  queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  speed REAL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS journey_queue_fifo_idx
  ON journey_queue(queue_id ASC);

CREATE TABLE IF NOT EXISTS journey_queue_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS journey_replay_lease (
  lease_key TEXT PRIMARY KEY NOT NULL,
  owner_token TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
`;

const CAPTURE_SEQUENCE_KEY = 'capture_sequence';

/**
 * Written by bootstrap, read by the background open path.
 *
 * The value is the schema version. It exists so a headless invocation can
 * ASK whether the store is ready rather than assume it, and so a future
 * migration has somewhere to record what it did.
 */
const SCHEMA_VERSION_KEY = 'schema_version';

/** Bump when CREATE_SCHEMA_SQL changes in a way a live database must follow. */
const SCHEMA_VERSION = 2;

const COUNT_SQL = 'SELECT COUNT(*) AS count FROM journey_queue';

const EVICT_OLDEST_SQL = `
DELETE FROM journey_queue
WHERE queue_id IN (
  SELECT queue_id
  FROM journey_queue
  ORDER BY queue_id ASC
  LIMIT ?
)
`;

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(name + ' must be a positive safe integer.');
  }
}

interface JourneyQueueRow {
  queue_id: number;
  session_id: string;
  idempotency_key: string;
  source: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  recorded_at: string;
}

interface CountRow {
  count: number;
}

interface MetadataRow {
  value: number;
}

export interface StoredJourneyFix extends TrackedFix {
  queueId: number;
  sessionId: string;
}

export interface EnqueueJourneyFixInput {
  sessionId: string;
  fix: TrackedFix;
  captureSequence: number;
}

/**
 * ADR-014 section 11: the bound and the deferral are SEPARATE fields. The
 * bound remains defined while enforcement is deferred during replay.
 */
export interface EnqueueJourneyFixOptions {
  /** Steady-state durable depth, owned and supplied by the tracker. */
  maxQueuedFixes: number;
  /** True while a replay batch is in flight and eviction must wait. */
  deferOverflowEviction: boolean;
}

export interface JourneyQueueMutationResult {
  /** True when this call inserted a new idempotency key. */
  inserted: boolean;
  /** Rows removed by depth-bound enforcement in this call. */
  dropped: number;
  /** Durable rows remaining when the transaction completed. */
  durableDepth: number;
}

export interface JourneyQueueTrimResult {
  /** Rows removed by this trim transaction. */
  dropped: number;
  /** Durable rows remaining when the transaction completed. */
  durableDepth: number;
}

/**
 * SQLite-backed durable Journey queue.
 *
 * This class owns SQL operations only. Tracker integration, replay policy,
 * retry classification and ADR-014 Phase C handling land separately.
 */
export class JourneyQueueStore {
  constructor(private readonly database: SQLiteDatabase) {}

  /**
   * CREATES THE SCHEMA. CALLED FROM THE APP CONTEXT ONLY.
   *
   * The headless TaskManager context must never reach this. Before 18
   * August every background delivery ran it - the single open function
   * called it unconditionally - which meant DDL on every GPS fix. At the
   * ~2s cadence observed on a real device that is on the order of a
   * thousand schema statements an hour inside a callback whose only job is
   * to append one row.
   *
   * Every statement in the batch returns no rows. That property is what the
   * native layer requires of execAsync, and it is why journal_mode is not
   * here - see the note above CREATE_SCHEMA_SQL.
   *
   * THESE ARE TWO OPERATIONS, NOT ONE ATOMIC ONE, AND THE RECOVERY
   * SEMANTICS ARE DELIBERATE. Schema creation happens first; the readiness
   * marker is written only after it succeeds. A crash between them leaves a
   * database with tables and no marker, which the background path then
   * REFUSES to write to until a foreground bootstrap completes again. That
   * is fail-closed and recoverable: every schema statement is idempotent,
   * so the next bootstrap simply finishes the job.
   *
   * A transaction was considered and rejected tonight. Wrapping DDL in
   * withExclusiveTransactionAsync is unverified against this native layer,
   * and this layer has already rejected two things it should not have. The
   * one path that must work is not where an unmeasured assumption belongs.
   */
  async bootstrap(): Promise<void> {
    await this.database.execAsync(CREATE_SCHEMA_SQL);

    await this.database.runAsync(
      `
INSERT INTO journey_queue_meta (key, value)
VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value
`,
      [SCHEMA_VERSION_KEY, SCHEMA_VERSION],
    );
  }

  /**
   * True when bootstrap has completed against this database file.
   *
   * A read, never a write. The background path uses this to decide whether
   * it may append - it must not create what it finds missing.
   */
  async isBootstrapped(): Promise<boolean> {
    try {
      const row = await this.database.getFirstAsync<MetadataRow>(
        'SELECT value FROM journey_queue_meta WHERE key = ?',
        [SCHEMA_VERSION_KEY],
      );
      return (row?.value ?? 0) >= SCHEMA_VERSION;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);

      if (message.includes('no such table: journey_queue_meta')) {
        // The meta table itself does not exist yet. That specifically means
        // bootstrap has not completed against this database file.
        return false;
      }

      // Corruption, I/O failure, locking, native bridge failures and every
      // other unexpected storage fault must remain visible to the caller.
      throw error;
    }
  }

  /**
   * Atomically stores one fix and advances the persisted capture sequence.
   *
   * INSERT OR IGNORE makes replaying an existing idempotency key harmless.
   * MAX prevents a stale caller from moving capture sequence backwards.
   */
  async enqueue(
    input: EnqueueJourneyFixInput,
    options: EnqueueJourneyFixOptions,
  ): Promise<JourneyQueueMutationResult> {
    if (!Number.isSafeInteger(input.captureSequence)) {
      throw new Error('captureSequence must be a safe integer.');
    }

    if (input.captureSequence < 0) {
      throw new Error('captureSequence must be non-negative.');
    }

    assertPositiveSafeInteger(options.maxQueuedFixes, 'maxQueuedFixes');

    if (typeof options.deferOverflowEviction !== 'boolean') {
      throw new Error('deferOverflowEviction must be a boolean.');
    }

    let inserted = false;
    let dropped = 0;
    let durableDepth = 0;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const insertResult = await transaction.runAsync(
        `
INSERT OR IGNORE INTO journey_queue (
  session_id,
  idempotency_key,
  source,
  latitude,
  longitude,
  accuracy,
  speed,
  recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`,
        [
          input.sessionId,
          input.fix.idempotencyKey,
          input.fix.source,
          input.fix.latitude,
          input.fix.longitude,
          input.fix.accuracy ?? null,
          input.fix.speed ?? null,
          input.fix.recordedAt,
        ],
      );

      // Read changes immediately from the INSERT result. Do not move this
      // verdict below another statement: changes belongs to one statement.
      inserted = insertResult.changes === 1;

      await transaction.runAsync(
        `
INSERT INTO journey_queue_meta (key, value)
VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET
  value = MAX(journey_queue_meta.value, excluded.value)
`,
        [CAPTURE_SEQUENCE_KEY, input.captureSequence],
      );

      // Every query inside the exclusive transaction must run on the txn
      // object, which is a Transaction extending SQLiteDatabase. Reading
      // through this.database here would leave the transaction.
      const countRow = await transaction.getFirstAsync<CountRow>(COUNT_SQL, []);
      durableDepth = countRow?.count ?? 0;

      if (
        !options.deferOverflowEviction &&
        durableDepth > options.maxQueuedFixes
      ) {
        const excess = durableDepth - options.maxQueuedFixes;

        const deleteResult = await transaction.runAsync(
          EVICT_OLDEST_SQL,
          [excess],
        );

        dropped = deleteResult.changes;
        durableDepth -= dropped;
      }
    });

    return { inserted, dropped, durableDepth };
  }

  /**
   * GAP-01A / 20.7 diagnostic variant.
   *
   * Uses only the SQLiteDatabase handle returned by openDatabaseAsync().
   * No withExclusiveTransactionAsync(), no Transaction.createAsync(), and no
   * useNewConnection=true lifecycle exists in this path.
   *
   * INTERRUPTION SEMANTICS ARE DELIBERATELY DIFFERENT FROM THE TRANSACTIONAL
   * VERSION:
   *
   *   1. Read the persisted sequence.
   *   2. Reserve the complete sequence range FIRST.
   *   3. Persist that high-water mark BEFORE writing queue rows.
   *   4. Insert rows in bounded multi-row statements.
   *   5. Apply queue-depth enforcement afterward.
   *
   * If the process dies after step 3, sequence numbers are burned. Gaps are
   * permitted by ADR-014 and are recoverable.
   *
   * The opposite ordering is unsafe: inserting rows before advancing metadata
   * can allow a restarted caller to reuse sequence numbers and collide with
   * sessionId:capturedAtMs:sequence idempotency keys.
   *
   * This diagnostic deliberately gives up all-or-nothing transaction atomicity
   * in order to determine whether expo-sqlite's exclusive transaction /
   * useNewConnection lifecycle is the trigger for GAP-01A.
   */
  async enqueueBatch(
    sessionId: string,
    items: readonly {
      capturedAtMs: number;
      fix: Omit<TrackedFix, 'idempotencyKey'>;
    }[],
    options: EnqueueJourneyFixOptions,
  ): Promise<{
    inserted: number;
    dropped: number;
    durableDepth: number;
    captureSequences: number[];
  }> {
    if (sessionId.length === 0) {
      throw new Error('sessionId must not be empty.');
    }

    assertPositiveSafeInteger(options.maxQueuedFixes, 'maxQueuedFixes');

    if (typeof options.deferOverflowEviction !== 'boolean') {
      throw new Error('deferOverflowEviction must be a boolean.');
    }

    for (const item of items) {
      if (!Number.isSafeInteger(item.capturedAtMs) || item.capturedAtMs < 0) {
        throw new Error('capturedAtMs must be a non-negative safe integer.');
      }
    }

    if (items.length === 0) {
      return {
        inserted: 0,
        dropped: 0,
        durableDepth: await this.count(),
        captureSequences: [],
      };
    }
    const sequenceRow = await this.database.getFirstAsync<MetadataRow>(
      'SELECT value FROM journey_queue_meta WHERE key = ?',
      [CAPTURE_SEQUENCE_KEY],
    );
    /*
     * Coerce explicitly. If the metadata column is ever TEXT-affine, a raw
     * `value + items.length` becomes string concatenation and every derived
     * idempotency key is silently wrong while the write still succeeds.
     */
    const startingSequence = Number(sequenceRow?.value ?? 0);

    if (!Number.isSafeInteger(startingSequence) || startingSequence < 0) {
      throw new Error('persisted capture sequence is not a valid integer.');
    }

    const endingSequence = startingSequence + items.length;

    if (!Number.isSafeInteger(endingSequence)) {
      throw new Error('capture sequence exhausted safe integer range.');
    }

    const captureSequences = items.map(
      (_, index) => startingSequence + index + 1,
    );

    /*
     * RESERVE FIRST.
     *
     * A crash after this write burns numbers. That is safe.
     * A crash before this write has written no queue rows.
     */
    await this.database.runAsync(
      `
INSERT INTO journey_queue_meta (key, value)
VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET
  value = MAX(journey_queue_meta.value, excluded.value)
`,
      [CAPTURE_SEQUENCE_KEY, endingSequence],
    );
    /*
     * 8 bind variables per row.
     *
     * Keep the statement bounded and avoid the old one-runAsync-per-position
     * native-call pattern. 100 rows = 800 bound values, under the 999 floor
     * on older SQLite builds.
     */
    const INSERT_CHUNK_SIZE = 100;
    let inserted = 0;

    for (
      let chunkStart = 0;
      chunkStart < items.length;
      chunkStart += INSERT_CHUNK_SIZE
    ) {
      const chunk = items.slice(
        chunkStart,
        chunkStart + INSERT_CHUNK_SIZE,
      );

      const placeholders = chunk
        .map(() => '(?, ?, ?, ?, ?, ?, ?, ?)')
        .join(', ');

      const params: (string | number | null)[] = [];

      chunk.forEach((item, chunkIndex) => {
        const globalIndex = chunkStart + chunkIndex;
        const sequence = captureSequences[globalIndex];

        const idempotencyKey =
          sessionId +
          ':' +
          String(item.capturedAtMs) +
          ':' +
          String(sequence);

        params.push(
          sessionId,
          idempotencyKey,
          item.fix.source,
          item.fix.latitude,
          item.fix.longitude,
          item.fix.accuracy ?? null,
          item.fix.speed ?? null,
          item.fix.recordedAt,
        );
      });
      const result = await this.database.runAsync(
        `
INSERT OR IGNORE INTO journey_queue (
  session_id,
  idempotency_key,
  source,
  latitude,
  longitude,
  accuracy,
  speed,
  recorded_at
) VALUES ${placeholders}
`,
        params,
      );
      inserted += result.changes;
    }

    /*
     * Eviction is deliberately outside the former transaction boundary.
     *
     * During this diagnostic build interruption may temporarily leave the
     * queue above its configured depth. The next trim/capture cycle repairs
     * that state.
     */
    let dropped = 0;
    let durableDepth = await this.count();
    if (
      !options.deferOverflowEviction &&
      durableDepth > options.maxQueuedFixes
    ) {
      const trimResult = await this.trimToDepth(options.maxQueuedFixes);
      dropped = trimResult.dropped;
      durableDepth = trimResult.durableDepth;
    }

    return {
      inserted,
      dropped,
      durableDepth,
      captureSequences,
    };
  }
  /**
   * Applies the tracker-owned depth bound outside an enqueue, for the
   * deferred case recorded in ADR-014 section 11.
   */
  async trimToDepth(maxQueuedFixes: number): Promise<JourneyQueueTrimResult> {
    assertPositiveSafeInteger(maxQueuedFixes, 'maxQueuedFixes');

    /*
     * GAP-01A / 20.7:
     * same openDatabaseAsync() handle, no exclusive/new transaction connection.
     *
     * Count and delete are intentionally not atomic in this diagnostic variant.
     * A concurrent change can make the trim conservative or temporarily leave
     * excess rows; it must never cause a live row to be silently attributed to
     * another session.
     */
    const countRow = await this.database.getFirstAsync<CountRow>(
      COUNT_SQL,
      [],
    );

    let durableDepth = countRow?.count ?? 0;

    if (durableDepth <= maxQueuedFixes) {
      return {
        dropped: 0,
        durableDepth,
      };
    }

    const excess = durableDepth - maxQueuedFixes;

    const deleteResult = await this.database.runAsync(
      EVICT_OLDEST_SQL,
      [excess],
    );

    const dropped = deleteResult.changes;
    durableDepth -= dropped;

    return {
      dropped,
      durableDepth,
    };
  }
  /**
   * Returns the oldest durable rows first.
   */
  async listOldest(limit: number): Promise<StoredJourneyFix[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('limit must be a positive safe integer.');
    }

    const rows = await this.database.getAllAsync<JourneyQueueRow>(
      `
SELECT
  queue_id,
  session_id,
  idempotency_key,
  source,
  latitude,
  longitude,
  accuracy,
  speed,
  recorded_at
FROM journey_queue
ORDER BY queue_id ASC
LIMIT ?
`,
      [limit],
    );

    return rows.map((row) => this.mapRow(row));
  }

  /**
   * The ONE session the next replay cycle may drain. Never a loop: a 15s
   * tick that drains every eligible session puts an unbounded number of
   * POSTs and deletes inside a single invocation - trap #225 in the replay
   * path rather than the capture path.
   *
   * ACTIVE-SESSION PRIORITY IS THE WHOLE POINT. Plain FIFO by queue_id hands
   * the tick to a historical session while a live emergency waits, which is
   * the failure this selector exists to prevent. A victim's current track is
   * the only queue whose latency matters.
   *
   * THE CURRENT SESSION IS CHECKED BEFORE THE SKIP SET AND IS NEVER SKIPPED.
   * A faulted live session retries every tick BY DESIGN: rows from an
   * emergency in progress are exactly the ones that must reach the server,
   * and a transient server condition must not strand them until the process
   * restarts. Historical sessions get the opposite treatment - one fault and
   * they yield the tick.
   *
   * The skip set is RUNTIME-ONLY CONTAINMENT held by the caller. It is
   * cleared on process restart and MUST be replaced by durable quarantine
   * and reconciliation before this subsystem is considered complete. It is
   * deliberately not persisted yet: the storage lifecycle has rejected three
   * native calls on this device and a schema change does not belong there
   * until that is stable.
   */
  async nextReplaySession(
    currentSessionId: string | null,
    skippedSessionIds: ReadonlySet<string>,
  ): Promise<string | null> {
    // An explicit branch, not a null binding. `WHERE session_id = ?` bound to
    // null matches nothing in SQLite because null never equals null, so the
    // fallthrough would be correct BY ACCIDENT and read as considered.
    if (currentSessionId !== null && currentSessionId.length > 0) {
      const active = await this.database.getFirstAsync<{ session_id: string }>(
        `SELECT session_id
FROM journey_queue
WHERE session_id = ?
LIMIT 1`,
        [currentSessionId],
      );

      if (active) {
        return active.session_id;
      }
    }

    // NOT IN () is a syntax error in SQLite, so the empty set is a DIFFERENT
    // STATEMENT rather than a placeholder list of length zero.
    if (skippedSessionIds.size === 0) {
      const oldest = await this.database.getFirstAsync<{ session_id: string }>(
        `SELECT session_id
FROM journey_queue
ORDER BY queue_id ASC
LIMIT 1`,
        [],
      );

      return oldest?.session_id ?? null;
    }

    const skipped = Array.from(skippedSessionIds);
    const placeholders = skipped.map(() => '?').join(', ');

    const oldest = await this.database.getFirstAsync<{ session_id: string }>(
      `SELECT session_id
FROM journey_queue
WHERE session_id NOT IN (${placeholders})
ORDER BY queue_id ASC
LIMIT 1`,
      skipped,
    );

    return oldest?.session_id ?? null;
  }

  /**
   * The oldest durable rows belonging to ONE session, oldest first.
   *
   * THE SESSION FILTER IS A CORRECTNESS BOUNDARY, NOT AN OPTIMIZATION. Rows
   * outlive the session that captured them. A batch spanning two sessions
   * cannot be posted at all - the wire carries ONE sessionId for the whole
   * request - so a mixed batch has to be attributed to one of them, and any
   * choice mislabels the rest. The server catches it: `recordedAt precedes
   * the session` for an older row, `Journey session has ended` for a closed
   * one. Because replay retains every row on rejection, one foreign row at
   * the head halts the drain FOREVER. That is not hypothetical - it ran from
   * 13 to 18 August 2026 against a single 11 August fix.
   *
   * Pairs with nextReplaySession(): the selector names the session, this
   * returns that session's rows and nothing else.
   */
  async listOldestForSession(
    sessionId: string,
    limit: number,
  ): Promise<StoredJourneyFix[]> {
    if (sessionId.length === 0) {
      throw new Error('sessionId must not be empty.');
    }

    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('limit must be a positive safe integer.');
    }

    const rows = await this.database.getAllAsync<JourneyQueueRow>(
      `
SELECT
  queue_id,
  session_id,
  idempotency_key,
  source,
  latitude,
  longitude,
  accuracy,
  speed,
  recorded_at
FROM journey_queue
WHERE session_id = ?
ORDER BY queue_id ASC
LIMIT ?
`,
      [sessionId, limit],
    );

    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Deletes acknowledged keys WITHIN one session.
   *
   * THE SESSION PREDICATE MAKES THE SHORTFALL COUNT MEAN SOMETHING. Replay
   * compares sqlite3_changes() against the number of keys it sent, and
   * ADR-014 section 11 treats a mismatch as an integrity fault. Keys are
   * `sessionId:ms:sequence`, so a cross-session collision is implausible -
   * but implausible is a property of the key FORMAT, and a format is one
   * refactor away from changing. The predicate makes the guarantee
   * STRUCTURAL: this statement cannot reach another session's evidence no
   * matter what the key generator does later.
   *
   * The order of the two conditions is deliberate. session_id first lets
   * SQLite discard the wrong session before evaluating the IN list.
   */
  async deleteAcknowledgedForSession(
    sessionId: string,
    idempotencyKeys: readonly string[],
  ): Promise<number> {
    if (sessionId.length === 0) {
      throw new Error('sessionId must not be empty.');
    }

    if (idempotencyKeys.length === 0) {
      return 0;
    }

    /*
     * GAP-01A: this is one SQLite DELETE statement and therefore does not need
     * an explicit exclusive transaction. Keep it on the database handle that
     * openDatabaseAsync() returned; do not create the useNewConnection=true
     * transaction lifecycle for replay acknowledgement.
     *
     * sqlite3_changes() still belongs to this exact DELETE statement, so the
     * caller's DELETE_SHORTFALL integrity check is preserved.
     */
    const placeholders = idempotencyKeys.map(() => '?').join(', ');

    const result = await this.database.runAsync(
      `DELETE FROM journey_queue
WHERE session_id = ?
  AND idempotency_key IN (${placeholders})`,
      [sessionId, ...idempotencyKeys],
    );

    return result.changes;
  }

  /**
   * Cross-context replay ownership for GAP-01B.
   *
   * One SQLite UPSERT is the arbitration boundary. Foreground and headless
   * TaskManager contexts may both reach this method, but only an expired or
   * absent lease may be claimed.
   *
   * No explicit transaction is needed: this is one SQLite statement.
   */
  async tryAcquireReplayLease(
    ownerToken: string,
    nowMs: number,
    leaseMs: number,
  ): Promise<boolean> {
    if (ownerToken.length === 0) {
      throw new Error('ownerToken must not be empty.');
    }

    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error('nowMs must be a non-negative safe integer.');
    }

    assertPositiveSafeInteger(leaseMs, 'leaseMs');

    const expiresAtMs = nowMs + leaseMs;

    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new Error('replay lease expiry exceeds safe integer range.');
    }

    const result = await this.database.runAsync(
      `
INSERT INTO journey_replay_lease (
  lease_key,
  owner_token,
  expires_at_ms
)
VALUES ('journey-replay', ?, ?)
ON CONFLICT(lease_key) DO UPDATE SET
  owner_token = excluded.owner_token,
  expires_at_ms = excluded.expires_at_ms
WHERE journey_replay_lease.expires_at_ms <= ?
`,
      [ownerToken, expiresAtMs, nowMs],
    );

    return result.changes === 1;
  }

  /**
   * Releases only this owner's lease.
   *
   * The owner predicate prevents a late-finishing expired owner from deleting
   * a lease subsequently acquired by another JS context.
   */
  async releaseReplayLease(ownerToken: string): Promise<boolean> {
    if (ownerToken.length === 0) {
      throw new Error('ownerToken must not be empty.');
    }

    const result = await this.database.runAsync(
      `DELETE FROM journey_replay_lease
WHERE lease_key = 'journey-replay'
  AND owner_token = ?`,
      [ownerToken],
    );

    return result.changes === 1;
  }
  async count(): Promise<number> {
    const row = await this.database.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM journey_queue',
      [],
    );

    return row?.count ?? 0;
  }

  async getCaptureSequence(): Promise<number> {
    const row = await this.database.getFirstAsync<MetadataRow>(
      'SELECT value FROM journey_queue_meta WHERE key = ?',
      [CAPTURE_SEQUENCE_KEY],
    );

    return row?.value ?? 0;
  }

  private mapRow(row: JourneyQueueRow): StoredJourneyFix {
    // 'background' is written by journey-background-task.ts. Without it
    // here the queue would ACCEPT a background fix and then refuse to
    // hydrate its own row on replay.
    if (
      row.source !== 'foreground' &&
      row.source !== 'background' &&
      row.source !== 'manual'
    ) {
      // Fail closed. Silently skipping a corrupt emergency fix would conceal
      // data loss. A quarantine policy requires a separate decision.
      throw new Error(
        'Stored Journey fix has an unsupported source: ' + row.source,
      );
    }

    const fix: StoredJourneyFix = {
      queueId: row.queue_id,
      sessionId: row.session_id,
      idempotencyKey: row.idempotency_key,
      source: row.source as TrackedFixSource,
      latitude: row.latitude,
      longitude: row.longitude,
      recordedAt: row.recorded_at,
    };

    if (row.accuracy !== null) {
      fix.accuracy = row.accuracy;
    }

    if (row.speed !== null) {
      fix.speed = row.speed;
    }

    return fix;
  }
}

function assertSupportedPlatform(): void {
  if (Platform.OS === 'web') {
    throw new Error(
      'Durable Journey tracking is not supported on web.',
    );
  }

  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error(
      'Durable Journey tracking requires Android or iOS.',
    );
  }
}

/**
 * BOOTSTRAP. Opens the queue and creates the schema. APP CONTEXT ONLY.
 *
 * Called once by the foreground tracker before any capture path exists.
 * Web and unsupported platforms fail closed rather than silently using
 * weaker persistence or transaction semantics.
 */
export async function bootstrapJourneyQueueStore(): Promise<JourneyQueueStore> {
  assertSupportedPlatform();

  const database = await openDatabaseAsync(DATABASE_NAME);
  const store = new JourneyQueueStore(database);

  await store.bootstrap();

  return store;
}

/**
 * OPEN. Attaches to an ALREADY-BOOTSTRAPPED database. HEADLESS-SAFE.
 *
 * No DDL, no pragma, no migration - it opens the file and checks a marker.
 * This is the path the background TaskManager callback uses, and the reason
 * it exists is that the callback previously ran the full bootstrap on every
 * GPS delivery.
 *
 * IT REFUSES RATHER THAN CREATES. A headless context finding no schema is a
 * context that should not be writing: the app has not started since install,
 * or storage was cleared, and inventing a database there would produce a
 * queue the foreground tracker never bootstrapped and may configure
 * differently. The fix is lost either way in that situation - what this
 * buys is that it is lost VISIBLY, with a distinguishable error, rather
 * than into a half-made file.
 *
 * In practice it should be unreachable: startTracking() bootstraps before
 * it registers the task, and the task is unregistered when tracking stops.
 * "Should be unreachable" is not a design, which is why this check exists.
 */
export async function openJourneyQueueStoreForBackground(): Promise<JourneyQueueStore> {
  assertSupportedPlatform();

  if (backgroundStorePromise !== null) {
    return backgroundStorePromise;
  }

  const pending = (async (): Promise<JourneyQueueStore> => {

    const database = await openDatabaseAsync(DATABASE_NAME);

    const store = new JourneyQueueStore(database);

    const ready = await store.isBootstrapped();

    if (!ready) {
      throw new Error(
        'Journey queue is not bootstrapped - the background task will not create it.',
      );
    }

    return store;
  })();

  backgroundStorePromise = pending;

  try {
    return await pending;
  } catch (error: unknown) {
    /*
     * Clear only if this is still the promise that failed. That preserves the
     * ownership contract if this function is ever extended to replace the
     * owner while another caller is awaiting an older promise.
     */
    if (backgroundStorePromise === pending) {
      backgroundStorePromise = null;
    }

    throw error;
  }
}
