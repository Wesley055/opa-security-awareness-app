import { Platform } from 'react-native';
import {
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';
import type {
  TrackedFix,
  TrackedFixSource,
} from './journey-tracker';

const DATABASE_NAME = 'opa-journey-queue.db';

const CREATE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
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
 * SQLite-backed durable Journey queue.
 *
 * This class owns SQL operations only. Tracker integration, replay policy,
 * retry classification and ADR-014 Phase C handling land separately.
 */
export class JourneyQueueStore {
  constructor(private readonly database: SQLiteDatabase) {}

  async initialize(): Promise<void> {
    await this.database.execAsync(CREATE_SCHEMA_SQL);
  }

  /**
   * Atomically stores one fix and advances the persisted capture sequence.
   *
   * INSERT OR IGNORE makes replaying an existing idempotency key harmless.
   * MAX prevents a stale caller from moving capture sequence backwards.
   */
  async enqueue(input: EnqueueJourneyFixInput): Promise<boolean> {
    if (!Number.isSafeInteger(input.captureSequence)) {
      throw new Error('captureSequence must be a safe integer.');
    }

    if (input.captureSequence < 0) {
      throw new Error('captureSequence must be non-negative.');
    }

    let inserted = false;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
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
      // verdict below the metadata write: changes belongs to one statement.
      inserted = result.changes === 1;

      await transaction.runAsync(
        `
INSERT INTO journey_queue_meta (key, value)
VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET
  value = MAX(journey_queue_meta.value, excluded.value)
`,
        [CAPTURE_SEQUENCE_KEY, input.captureSequence],
      );
    });

    return inserted;
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
    if (row.source !== 'foreground' && row.source !== 'manual') {
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
