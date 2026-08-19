import { Platform } from 'react-native';
import {
  openDatabaseAsync,
  type SQLiteDatabase,
  type SQLiteRunResult,
} from 'expo-sqlite';
import {
  JourneyQueueStore,
  bootstrapJourneyQueueStore,
} from './journey-queue-store';
import type { TrackedFix } from './journey-fix-contract';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

const mockedOpenDatabaseAsync =
  openDatabaseAsync as jest.MockedFunction<typeof openDatabaseAsync>;

function runResult(changes: number): SQLiteRunResult {
  return {
    lastInsertRowId: 0,
    changes,
  };
}

function fix(
  idempotencyKey = 'session-1:1000:1',
): TrackedFix {
  return {
    idempotencyKey,
    source: 'foreground',
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 5,
    speed: 1.5,
    recordedAt: '2026-08-04T12:00:00.000Z',
  };
}

function createDatabaseMock() {
  const transaction = {
    runAsync: jest.fn(),
    getFirstAsync: jest.fn().mockResolvedValue({ count: 1 }),
  };

  const database = {
    execAsync: jest.fn(),
    runAsync: jest.fn(),
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    withExclusiveTransactionAsync: jest.fn(
      async (
        task: (
          transactionDatabase: typeof transaction,
        ) => Promise<void>,
      ) => {
        await task(transaction);
      },
    ),
  };

  return {
    database: database as unknown as SQLiteDatabase,
    databaseMock: database,
    transaction,
  };
}

describe('JourneyQueueStore', () => {
  beforeEach(() => {
    mockedOpenDatabaseAsync.mockReset();
  });

  it('initializes the SQLite schema', async () => {
    const { database, databaseMock } = createDatabaseMock();
    const store = new JourneyQueueStore(database);

    await store.bootstrap();

    expect(databaseMock.execAsync).toHaveBeenCalledTimes(1);

    const sql = databaseMock.execAsync.mock.calls[0]?.[0] ?? '';

    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS journey_queue',
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS journey_queue_meta',
    );
    expect(sql).toContain('PRAGMA foreign_keys = ON');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS journey_queue_fifo_idx',
    );
  });

  /**
   * GAP-01A. These tests exist because a mocked execAsync accepts anything,
   * so this suite passed for weeks against SQL that threw on a real device.
   * Trap #218: when a test exists to catch a specific defect, it must
   * assert the thing that was actually wrong.
   *
   * THEY CANNOT PROVE THE FIX WORKS. Every native call is mocked here.
   * Only a device log showing no rejection, followed by source='background'
   * fixes reaching the server, closes GAP-01A.
   */
  it('never mutates journal_mode at runtime, in any API', async () => {
    // Measured 18 August 2026: rejected inside execAsync (NPE) AND through
    // getFirstAsync (prepareAsync rejected). Deferred, not dismissed - see
    // the note above CREATE_SCHEMA_SQL.
    const { database, databaseMock } = createDatabaseMock();
    const store = new JourneyQueueStore(database);

    await store.bootstrap();

    const sql = databaseMock.execAsync.mock.calls[0]?.[0] ?? '';

    expect(sql).not.toContain('journal_mode');
  });

  it('writes the schema version marker as part of bootstrap', async () => {
    // The marker is what lets a headless context ASK whether the store is
    // ready instead of assuming it.
    const { database, databaseMock } = createDatabaseMock();
    const store = new JourneyQueueStore(database);

    await store.bootstrap();

    expect(databaseMock.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO journey_queue_meta'),
      ['schema_version', 1],
    );
  });

  it('writes the readiness marker AFTER the schema exists', async () => {
    // These are two operations, not one. Reversed, a crash between them
    // would leave a database that claims to be ready and has no tables.
    // In this order the crash leaves it unmarked, and the background path
    // refuses until a foreground bootstrap completes.
    const { database, databaseMock } = createDatabaseMock();
    const store = new JourneyQueueStore(database);

    await store.bootstrap();

    const schemaOrder = databaseMock.execAsync.mock.invocationCallOrder[0];
    const markerOrder = databaseMock.runAsync.mock.invocationCallOrder[0];

    expect(schemaOrder).toBeLessThan(markerOrder);
  });

  it('reports an unbootstrapped database rather than throwing', async () => {
    // A missing meta table is the ANSWER to "is this ready", not a fault.
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync.mockRejectedValue(
      new Error('no such table: journey_queue_meta'),
    );

    const store = new JourneyQueueStore(database);

    await expect(store.isBootstrapped()).resolves.toBe(false);
  });

  it('rethrows unexpected readiness-check storage failures', async () => {
    const { database, databaseMock } = createDatabaseMock();
    const failure = new Error('NativeDatabase.prepareAsync rejected');

    databaseMock.getFirstAsync.mockRejectedValue(failure);

    const store = new JourneyQueueStore(database);

    await expect(store.isBootstrapped()).rejects.toBe(failure);
  });
  it('reports a bootstrapped database when the marker is current', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync.mockResolvedValue({ value: 1 });

    const store = new JourneyQueueStore(database);

    await expect(store.isBootstrapped()).resolves.toBe(true);
  });

  it('atomically inserts a fix and advances capture sequence', async () => {
    const { database, databaseMock, transaction } = createDatabaseMock();

    transaction.runAsync
      .mockResolvedValueOnce(runResult(1))
      .mockResolvedValueOnce(runResult(1));

    const store = new JourneyQueueStore(database);

    await expect(
      store.enqueue({
        sessionId: 'session-1',
        fix: fix(),
        captureSequence: 7,
      }, {
        maxQueuedFixes: 600,
        deferOverflowEviction: false,
      }),
    ).resolves.toEqual({
      inserted: true,
      dropped: 0,
      durableDepth: 1,
    });

    expect(
      databaseMock.withExclusiveTransactionAsync,
    ).toHaveBeenCalledTimes(1);

    expect(transaction.runAsync).toHaveBeenCalledTimes(2);

    expect(transaction.runAsync.mock.calls[0]?.[0]).toContain(
      'INSERT OR IGNORE INTO journey_queue',
    );

    expect(transaction.runAsync.mock.calls[0]?.[1]).toEqual([
      'session-1',
      'session-1:1000:1',
      'foreground',
      6.5244,
      3.3792,
      5,
      1.5,
      '2026-08-04T12:00:00.000Z',
    ]);

    expect(transaction.runAsync.mock.calls[1]?.[0]).toContain(
      'MAX(journey_queue_meta.value, excluded.value)',
    );

    expect(transaction.runAsync.mock.calls[1]?.[1]).toEqual([
      'capture_sequence',
      7,
    ]);
  });

  it('reads insert changes before the metadata statement', async () => {
    const { database, transaction } = createDatabaseMock();

    transaction.runAsync
      .mockResolvedValueOnce(runResult(1))
      .mockResolvedValueOnce(runResult(0));

    const store = new JourneyQueueStore(database);

    await expect(
      store.enqueue({
        sessionId: 'session-1',
        fix: fix(),
        captureSequence: 7,
      }, {
        maxQueuedFixes: 600,
        deferOverflowEviction: false,
      }),
    ).resolves.toEqual({
      inserted: true,
      dropped: 0,
      durableDepth: 1,
    });
  });

  it('reports duplicate idempotency keys as not inserted', async () => {
    const { database, transaction } = createDatabaseMock();

    transaction.runAsync
      .mockResolvedValueOnce(runResult(0))
      .mockResolvedValueOnce(runResult(1));

    const store = new JourneyQueueStore(database);

    await expect(
      store.enqueue({
        sessionId: 'session-1',
        fix: fix(),
        captureSequence: 7,
      }, {
        maxQueuedFixes: 600,
        deferOverflowEviction: false,
      }),
    ).resolves.toEqual({
      inserted: false,
      dropped: 0,
      durableDepth: 1,
    });
  });

  it('rejects invalid capture sequence values', async () => {
    const { database, databaseMock } = createDatabaseMock();
    const store = new JourneyQueueStore(database);

    await expect(
      store.enqueue({
        sessionId: 'session-1',
        fix: fix(),
        captureSequence: -1,
      }, {
        maxQueuedFixes: 600,
        deferOverflowEviction: false,
      }),
    ).rejects.toThrow('captureSequence must be non-negative.');

    await expect(
      store.enqueue({
        sessionId: 'session-1',
        fix: fix(),
        captureSequence: Number.NaN,
      }, {
        maxQueuedFixes: 600,
        deferOverflowEviction: false,
      }),
    ).rejects.toThrow('captureSequence must be a safe integer.');

    expect(
      databaseMock.withExclusiveTransactionAsync,
    ).not.toHaveBeenCalled();
  });

  it('evicts the oldest excess rows inside enqueue', async () => {
    const { database, transaction } = createDatabaseMock();

    transaction.runAsync
      .mockResolvedValueOnce(runResult(1))
      .mockResolvedValueOnce(runResult(1))
      .mockResolvedValueOnce(runResult(1));

    transaction.getFirstAsync.mockResolvedValue({ count: 601 });

    const store = new JourneyQueueStore(database);

    await expect(
      store.enqueue({
        sessionId: 'session-1',
        fix: fix(),
        captureSequence: 7,
      }, {
        maxQueuedFixes: 600,
        deferOverflowEviction: false,
      }),
    ).resolves.toEqual({
      inserted: true,
      dropped: 1,
      durableDepth: 600,
    });

    expect(transaction.runAsync).toHaveBeenCalledTimes(3);
    expect(transaction.runAsync.mock.calls[2]?.[0]).toContain(
      'ORDER BY queue_id ASC',
    );
    expect(transaction.runAsync.mock.calls[2]?.[1]).toEqual([1]);
  });

  it('defers overflow eviction while replay is in flight', async () => {
    const { database, transaction } = createDatabaseMock();

    transaction.runAsync
      .mockResolvedValueOnce(runResult(1))
      .mockResolvedValueOnce(runResult(1));

    transaction.getFirstAsync.mockResolvedValue({ count: 601 });

    const store = new JourneyQueueStore(database);

    await expect(
      store.enqueue({
        sessionId: 'session-1',
        fix: fix(),
        captureSequence: 7,
      }, {
        maxQueuedFixes: 600,
        deferOverflowEviction: true,
      }),
    ).resolves.toEqual({
      inserted: true,
      dropped: 0,
      durableDepth: 601,
    });

    expect(transaction.runAsync).toHaveBeenCalledTimes(2);
  });

  it('trims oldest excess rows after replay completes', async () => {
    const { database, transaction } = createDatabaseMock();

    transaction.getFirstAsync.mockResolvedValue({ count: 603 });
    transaction.runAsync.mockResolvedValue(runResult(3));

    const store = new JourneyQueueStore(database);

    await expect(store.trimToDepth(600)).resolves.toEqual({
      dropped: 3,
      durableDepth: 600,
    });

    expect(transaction.runAsync).toHaveBeenCalledTimes(1);
    expect(transaction.runAsync.mock.calls[0]?.[1]).toEqual([3]);
  });

  it('does not write when trim is already within the depth bound', async () => {
    const { database, transaction } = createDatabaseMock();

    transaction.getFirstAsync.mockResolvedValue({ count: 600 });

    const store = new JourneyQueueStore(database);

    await expect(store.trimToDepth(600)).resolves.toEqual({
      dropped: 0,
      durableDepth: 600,
    });

    expect(transaction.runAsync).not.toHaveBeenCalled();
  });

  it('rejects an invalid depth bound before opening a transaction', async () => {
    const { database, databaseMock } = createDatabaseMock();
    const store = new JourneyQueueStore(database);

    await expect(
      store.enqueue({
        sessionId: 'session-1',
        fix: fix(),
        captureSequence: 7,
      }, {
        maxQueuedFixes: 0,
        deferOverflowEviction: false,
      }),
    ).rejects.toThrow('maxQueuedFixes must be a positive safe integer.');

    await expect(store.trimToDepth(0)).rejects.toThrow(
      'maxQueuedFixes must be a positive safe integer.',
    );

    expect(databaseMock.withExclusiveTransactionAsync).not.toHaveBeenCalled();
  });

  it('lists rows in durable FIFO order and maps nullable telemetry', async () => {
    const { database, databaseMock } = createDatabaseMock();

    databaseMock.getAllAsync.mockResolvedValue([
      {
        queue_id: 1,
        session_id: 'session-1',
        idempotency_key: 'key-1',
        source: 'foreground',
        latitude: 6.5,
        longitude: 3.3,
        accuracy: null,
        speed: null,
        recorded_at: '2026-08-04T12:00:00.000Z',
      },
      {
        queue_id: 2,
        session_id: 'session-1',
        idempotency_key: 'key-2',
        source: 'manual',
        latitude: 6.6,
        longitude: 3.4,
        accuracy: 4,
        speed: 2,
        recorded_at: '2026-08-04T12:00:10.000Z',
      },
    ]);

    const store = new JourneyQueueStore(database);
    const rows = await store.listOldest(200);

    expect(databaseMock.getAllAsync.mock.calls[0]?.[0]).toContain(
      'ORDER BY queue_id ASC',
    );

    expect(databaseMock.getAllAsync.mock.calls[0]?.[1]).toEqual([
      200,
    ]);

    expect(rows).toEqual([
      {
        queueId: 1,
        sessionId: 'session-1',
        idempotencyKey: 'key-1',
        source: 'foreground',
        latitude: 6.5,
        longitude: 3.3,
        recordedAt: '2026-08-04T12:00:00.000Z',
      },
      {
        queueId: 2,
        sessionId: 'session-1',
        idempotencyKey: 'key-2',
        source: 'manual',
        latitude: 6.6,
        longitude: 3.4,
        accuracy: 4,
        speed: 2,
        recordedAt: '2026-08-04T12:00:10.000Z',
      },
    ]);
  });

  it('rejects a non-positive list limit', async () => {
    const { database, databaseMock } = createDatabaseMock();
    const store = new JourneyQueueStore(database);

    await expect(store.listOldest(0)).rejects.toThrow(
      'limit must be a positive safe integer.',
    );

    expect(databaseMock.getAllAsync).not.toHaveBeenCalled();
  });

  it('fails closed when a stored source is unsupported', async () => {
    const { database, databaseMock } = createDatabaseMock();

    databaseMock.getAllAsync.mockResolvedValue([
      {
        queue_id: 1,
        session_id: 'session-1',
        idempotency_key: 'key-1',
        source: 'corrupt',
        latitude: 6.5,
        longitude: 3.3,
        accuracy: null,
        speed: null,
        recorded_at: '2026-08-04T12:00:00.000Z',
      },
    ]);

    const store = new JourneyQueueStore(database);

    await expect(store.listOldest(1)).rejects.toThrow(
      'Stored Journey fix has an unsupported source: corrupt',
    );
  });

  it('returns sqlite changes when deleting acknowledged keys', async () => {
    const { database, transaction } = createDatabaseMock();

    transaction.runAsync.mockResolvedValue(runResult(2));

    const store = new JourneyQueueStore(database);

    await expect(
      store.deleteAcknowledged(['key-1', 'key-2']),
    ).resolves.toBe(2);

    expect(transaction.runAsync.mock.calls[0]?.[0]).toContain(
      'DELETE FROM journey_queue',
    );

    expect(transaction.runAsync.mock.calls[0]?.[1]).toEqual([
      'key-1',
      'key-2',
    ]);
  });

  it('does not open a transaction for an empty acknowledgement', async () => {
    const { database, databaseMock } = createDatabaseMock();
    const store = new JourneyQueueStore(database);

    await expect(store.deleteAcknowledged([])).resolves.toBe(0);

    expect(
      databaseMock.withExclusiveTransactionAsync,
    ).not.toHaveBeenCalled();
  });

  it('returns queue count and persisted capture sequence', async () => {
    const { database, databaseMock } = createDatabaseMock();

    databaseMock.getFirstAsync
      .mockResolvedValueOnce({ count: 12 })
      .mockResolvedValueOnce({ value: 44 });

    const store = new JourneyQueueStore(database);

    await expect(store.count()).resolves.toBe(12);
    await expect(store.getCaptureSequence()).resolves.toBe(44);
  });

  it('returns zero for missing count and sequence rows', async () => {
    const { database, databaseMock } = createDatabaseMock();

    databaseMock.getFirstAsync
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const store = new JourneyQueueStore(database);

    await expect(store.count()).resolves.toBe(0);
    await expect(store.getCaptureSequence()).resolves.toBe(0);
  });

  it('opens and initializes the store on iOS', async () => {
    const originalOs = Platform.OS;

    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });

    const { database, databaseMock } = createDatabaseMock();

    mockedOpenDatabaseAsync.mockResolvedValue(database);

    try {
      const store = await bootstrapJourneyQueueStore();

      expect(store).toBeInstanceOf(JourneyQueueStore);
      expect(mockedOpenDatabaseAsync).toHaveBeenCalledWith(
        'opa-journey-queue.db',
      );
      expect(databaseMock.execAsync).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalOs,
      });
    }
  });

  it('fails closed on web without opening SQLite', async () => {
    const originalOs = Platform.OS;

    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'web',
    });

    try {
      await expect(bootstrapJourneyQueueStore()).rejects.toThrow(
        'Durable Journey tracking is not supported on web.',
      );

      expect(mockedOpenDatabaseAsync).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalOs,
      });
    }
  });

  it('fails closed on other unsupported platforms', async () => {
    const originalOs = Platform.OS;

    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'windows',
    });

    try {
      await expect(bootstrapJourneyQueueStore()).rejects.toThrow(
        'Durable Journey tracking requires Android or iOS.',
      );

      expect(mockedOpenDatabaseAsync).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalOs,
      });
    }
  });
});

describe('nextReplaySession', () => {
  it('prefers the current session over an older historical one', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync.mockResolvedValueOnce({
      session_id: 'session-current',
    });

    const store = new JourneyQueueStore(database);

    await expect(
      store.nextReplaySession('session-current', new Set()),
    ).resolves.toBe('session-current');

    // ONE query, not two. The historical lookup must not run at all, or a
    // live emergency pays for a scan it does not need on every tick.
    expect(databaseMock.getFirstAsync).toHaveBeenCalledTimes(1);
  });

  it('falls back to historical replay when the current session has no rows', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ session_id: 'session-old' });

    const store = new JourneyQueueStore(database);

    await expect(
      store.nextReplaySession('session-current', new Set()),
    ).resolves.toBe('session-old');

    const historicalQuery = databaseMock.getFirstAsync.mock.calls[1]?.[0];
    expect(historicalQuery).toContain('ORDER BY queue_id ASC');
  });

  it('excludes skipped sessions from the historical lookup', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ session_id: 'session-b' });

    const store = new JourneyQueueStore(database);

    await expect(
      store.nextReplaySession('session-current', new Set(['session-a'])),
    ).resolves.toBe('session-b');

    // Asserted on the QUERY and its parameters, not on the returned value:
    // a widening fails where it happens. Same principle as 14A-11's select.
    const call = databaseMock.getFirstAsync.mock.calls[1];
    expect(call?.[0]).toContain('NOT IN (?)');
    expect(call?.[1]).toEqual(['session-a']);
  });

  it('returns null when nothing is eligible', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync.mockResolvedValue(null);

    const store = new JourneyQueueStore(database);

    await expect(
      store.nextReplaySession('session-current', new Set(['session-a'])),
    ).resolves.toBeNull();
  });

  it('skips the active lookup entirely when there is no current session', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync.mockResolvedValueOnce({
      session_id: 'session-old',
    });

    const store = new JourneyQueueStore(database);

    await expect(store.nextReplaySession(null, new Set())).resolves.toBe(
      'session-old',
    );

    expect(databaseMock.getFirstAsync).toHaveBeenCalledTimes(1);
    expect(databaseMock.getFirstAsync.mock.calls[0]?.[0]).not.toContain(
      'WHERE session_id = ?',
    );
  });

  it('returns a faulted current session rather than skipping it', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync.mockResolvedValueOnce({
      session_id: 'session-current',
    });

    const store = new JourneyQueueStore(database);

    // The live emergency is IN the skip set and must still be returned.
    // Skipping it would strand the one track that matters.
    await expect(
      store.nextReplaySession('session-current', new Set(['session-current'])),
    ).resolves.toBe('session-current');
  });
});
