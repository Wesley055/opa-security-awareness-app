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
 * NO `PRAGMA journal_mode` HERE, AND THAT IS THE WHOLE POINT.
 *
 * journal_mode RETURNS A ROW; execAsync is documented for statements that
 * return nothing. In the foreground context the extra row was tolerated. In
 * the headless TaskManager context it was not: every invocation threw
 *
 *   Call to function 'NativeDatabase.execAsync' has been rejected.
 *   Caused by: java.lang.NullPointerException
 *
 * openJourneyQueueStore() calls initialize() on EVERY background invocation,
 * so every fix Android delivered was captured and then discarded. Measured
 * on a real device 18 August 2026 - eight consecutive failures in 35
 * seconds. This is a concrete failure mechanism consistent with the
 * previously observed background-capture gap; the 10 August drive has no
 * log behind it and is NOT proven to share this cause.
 *
 * foreign_keys returns nothing and is safe to leave in this batch.
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
`;

const CAPTURE_SEQUENCE_KEY = 'capture_sequence';

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
   * WAL IS SET THROUGH getFirstAsync, NOT execAsync.
   *
   * `PRAGMA journal_mode = WAL` answers with the resulting mode, so it is a
   * query rather than a statement. Reading that row is what makes it safe in
   * the headless task context - see the note above CREATE_SCHEMA_SQL for the
   * failure this replaces.
   *
   * The two calls are deliberately NOT wrapped in a transaction: SQLite
   * refuses to change journal_mode inside one.
   */
  async initialize(): Promise<void> {
    await this.database.getFirstAsync('PRAGMA journal_mode = WAL');
    await this.database.execAsync(CREATE_SCHEMA_SQL);
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
   * Applies the tracker-owned depth bound outside an enqueue, for the
   * deferred case recorded in ADR-014 section 11.
   */
  async trimToDepth(maxQueuedFixes: number): Promise<JourneyQueueTrimResult> {
    assertPositiveSafeInteger(maxQueuedFixes, 'maxQueuedFixes');

    let dropped = 0;
    let durableDepth = 0;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const countRow = await transaction.getFirstAsync<CountRow>(COUNT_SQL, []);
      durableDepth = countRow?.count ?? 0;

      if (durableDepth <= maxQueuedFixes) {
        return;
      }

      const excess = durableDepth - maxQueuedFixes;

      const deleteResult = await transaction.runAsync(
        EVICT_OLDEST_SQL,
        [excess],
      );

      dropped = deleteResult.changes;
      durableDepth -= dropped;
    });

    return { dropped, durableDepth };
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
   * Deletes only explicitly acknowledged idempotency keys.
   *
   * The returned count is sqlite3_changes() for the DELETE statement.
   */
  async deleteAcknowledged(
    idempotencyKeys: readonly string[],
  ): Promise<number> {
    if (idempotencyKeys.length === 0) {
      return 0;
    }

    let changes = 0;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const placeholders = idempotencyKeys.map(() => '?').join(', ');

      const result = await transaction.runAsync(
        `DELETE FROM journey_queue
WHERE idempotency_key IN (${placeholders})`,
        Array.from(idempotencyKeys),
      );

      changes = result.changes;
    });

    return changes;
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

/**
 * Opens and initializes the mobile queue.
 *
 * Web and unsupported platforms fail closed rather than silently using weaker
 * persistence or transaction semantics.
 */
export async function openJourneyQueueStore(): Promise<JourneyQueueStore> {
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

  const database = await openDatabaseAsync(DATABASE_NAME);
  const store = new JourneyQueueStore(database);

  await store.initialize();

  return store;
}
