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
    /*
     * Default resolution. Without it, a mutation that changes the NUMBER of
     * runAsync calls exhausts the per-test Once chain and throws on
     * result.changes BEFORE the assertion runs - the mutation looks caught
     * when the assertion was never exercised. Measured 19 Aug: all four
     * enqueueBatch tests failed that way under INSERT_CHUNK_SIZE=1.
     */
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 0, changes: 1 }),
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
      ['schema_version', 2],
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
  it('rejects an older schema marker until foreground bootstrap upgrades it', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync.mockResolvedValue({ value: 1 });

    const store = new JourneyQueueStore(database);

    await expect(store.isBootstrapped()).resolves.toBe(false);
  });
  it('reports a bootstrapped database when the marker is current', async () => {
    const { database, databaseMock } = createDatabaseMock();
    databaseMock.getFirstAsync.mockResolvedValue({ value: 2 });

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

  describe('enqueueBatch', () => {
    function batchFix(
      capturedAtMs: number,
      latitude: number,
      longitude: number,
    ) {
      return {
        capturedAtMs,
        fix: {
          source: 'background' as const,
          latitude,
          longitude,
          accuracy: 5,
          speed: 1.5,
          recordedAt: new Date(capturedAtMs).toISOString(),
        },
      };
    }

    it('stores a native batch through the primary database handle without an exclusive transaction', async () => {
      const { database, databaseMock } = createDatabaseMock();

      databaseMock.getFirstAsync
        .mockResolvedValueOnce({ value: 40 })
        .mockResolvedValueOnce({ count: 2 });

      databaseMock.runAsync
        .mockResolvedValueOnce(runResult(1))
        .mockResolvedValueOnce(runResult(2));

      const store = new JourneyQueueStore(database);

      await store.enqueueBatch(
        'session-1',
        [
          batchFix(1000, 6.5244, 3.3792),
          batchFix(2000, 6.5250, 3.3800),
        ],
        {
          maxQueuedFixes: 600,
          deferOverflowEviction: false,
        },
      );

      expect(databaseMock.withExclusiveTransactionAsync).not.toHaveBeenCalled();

      const insertCalls = databaseMock.runAsync.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT OR IGNORE INTO journey_queue'),
      );

      /*
       * One multi-row statement per chunk, NOT one per position. This is the
       * assertion that fails if the loop regresses to per-position runAsync.
       */
      expect(insertCalls).toHaveLength(1);
    });

    it('persists the sequence marker before inserting the batch', async () => {
      const { database, databaseMock } = createDatabaseMock();

      databaseMock.getFirstAsync
        .mockResolvedValueOnce({ value: 40 })
        .mockResolvedValueOnce({ count: 2 });

      databaseMock.runAsync
        .mockResolvedValueOnce(runResult(1))
        .mockResolvedValueOnce(runResult(2));

      const store = new JourneyQueueStore(database);

      const result = await store.enqueueBatch(
        'session-1',
        [
          batchFix(1000, 6.5244, 3.3792),
          batchFix(2000, 6.5250, 3.3800),
        ],
        {
          maxQueuedFixes: 600,
          deferOverflowEviction: false,
        },
      );

      expect(result.captureSequences).toEqual([41, 42]);

      const metadataIndex = databaseMock.runAsync.mock.calls.findIndex(([sql]) =>
        String(sql).includes('MAX(journey_queue_meta.value, excluded.value)'),
      );

      const insertIndex = databaseMock.runAsync.mock.calls.findIndex(([sql]) =>
        String(sql).includes('INSERT OR IGNORE INTO journey_queue'),
      );

      /*
       * RESERVE-BEFORE-INSERT.
       *
       * Without a transaction this ordering is the only thing preventing a
       * restarted process from reusing sequence numbers and colliding on the
       * sessionId:capturedAtMs:sequence unique constraint. Burned numbers are
       * recoverable; collisions wedge the queue.
       */
      expect(metadataIndex).toBeGreaterThanOrEqual(0);
      expect(insertIndex).toBeGreaterThan(metadataIndex);

      const metadataCall = databaseMock.runAsync.mock.calls[metadataIndex];

      expect(metadataCall?.[1]).toEqual(['capture_sequence', 42]);

      const insertCall = databaseMock.runAsync.mock.calls[insertIndex];
      const params = insertCall?.[1] ?? [];

      expect(params).toContain('session-1:1000:41');
      expect(params).toContain('session-1:2000:42');
    });

    it('counts duplicate inserts without reusing an allocated sequence', async () => {
      const { database, databaseMock } = createDatabaseMock();

      databaseMock.getFirstAsync
        .mockResolvedValueOnce({ value: 40 })
        .mockResolvedValueOnce({ count: 1 });

      /*
       * First queued result is consumed by the metadata write; the second is
       * the single batched insert. `inserted` therefore reflects the insert
       * statement's changes, not a per-position sum.
       */
      databaseMock.runAsync
        .mockResolvedValueOnce(runResult(1))
        .mockResolvedValueOnce(runResult(1));

      const store = new JourneyQueueStore(database);

      await expect(
        store.enqueueBatch(
          'session-1',
          [
            batchFix(1000, 6.5244, 3.3792),
            batchFix(2000, 6.5250, 3.3800),
          ],
          {
            maxQueuedFixes: 600,
            deferOverflowEviction: false,
          },
        ),
      ).resolves.toMatchObject({
        inserted: 1,
        captureSequences: [41, 42],
      });
    });

    it('enforces the depth bound once after the whole batch', async () => {
      const { database, databaseMock } = createDatabaseMock();

      /*
       * Three getFirstAsync calls now: the sequence read, enqueueBatch's own
       * count(), and trimToDepth's count. The transactional version only made
       * two.
       */
      databaseMock.getFirstAsync
        .mockResolvedValueOnce({ value: 40 })
        .mockResolvedValueOnce({ count: 602 })
        .mockResolvedValueOnce({ count: 602 });

      databaseMock.runAsync
        .mockResolvedValueOnce(runResult(1))
        .mockResolvedValueOnce(runResult(2))
        .mockResolvedValueOnce(runResult(2));

      const store = new JourneyQueueStore(database);

      await expect(
        store.enqueueBatch(
          'session-1',
          [
            batchFix(1000, 6.5244, 3.3792),
            batchFix(2000, 6.5250, 3.3800),
          ],
          {
            maxQueuedFixes: 600,
            deferOverflowEviction: false,
          },
        ),
      ).resolves.toMatchObject({
        dropped: 2,
        durableDepth: 600,
      });

      const evictionCalls = databaseMock.runAsync.mock.calls.filter(([sql]) =>
        String(sql).includes('ORDER BY queue_id ASC'),
      );

      expect(evictionCalls).toHaveLength(1);
      expect(evictionCalls[0]?.[1]).toEqual([2]);
    });
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
    const { database, databaseMock } = createDatabaseMock();

    databaseMock.getFirstAsync.mockResolvedValue({ count: 603 });
    databaseMock.runAsync.mockResolvedValue(runResult(3));

    const store = new JourneyQueueStore(database);

    await expect(store.trimToDepth(600)).resolves.toEqual({
      dropped: 3,
      durableDepth: 600,
    });

    expect(databaseMock.runAsync).toHaveBeenCalledTimes(1);
    expect(databaseMock.runAsync.mock.calls[0]?.[1]).toEqual([3]);
  });

  it('does not write when trim is already within the depth bound', async () => {
    const { database, databaseMock } = createDatabaseMock();

    databaseMock.getFirstAsync.mockResolvedValue({ count: 600 });

    const store = new JourneyQueueStore(database);

    await expect(store.trimToDepth(600)).resolves.toEqual({
      dropped: 0,
      durableDepth: 600,
    });

    expect(databaseMock.runAsync).not.toHaveBeenCalled();
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

  describe('replay lease', () => {
    it('acquires an absent or expired lease with one primary-handle statement', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.runAsync.mockResolvedValue(runResult(1));

      const store = new JourneyQueueStore(database);

      await expect(
        store.tryAcquireReplayLease('owner-a', 1000, 45000),
      ).resolves.toBe(true);

      expect(databaseMock.runAsync).toHaveBeenCalledTimes(1);

      const [sql, params] = databaseMock.runAsync.mock.calls[0] ?? [];

      expect(sql).toContain('INSERT INTO journey_replay_lease');
      expect(sql).toContain(
        'WHERE journey_replay_lease.expires_at_ms <= ?',
      );
      expect(params).toEqual(['owner-a', 46000, 1000]);

      expect(
        databaseMock.withExclusiveTransactionAsync,
      ).not.toHaveBeenCalled();
    });

    it('reports lease contention when the atomic statement changes no row', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.runAsync.mockResolvedValue(runResult(0));

      const store = new JourneyQueueStore(database);

      await expect(
        store.tryAcquireReplayLease('owner-b', 2000, 45000),
      ).resolves.toBe(false);
    });

    it('releases only the matching owner token', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.runAsync.mockResolvedValue(runResult(1));

      const store = new JourneyQueueStore(database);

      await expect(
        store.releaseReplayLease('owner-a'),
      ).resolves.toBe(true);

      const [sql, params] = databaseMock.runAsync.mock.calls[0] ?? [];

      expect(sql).toContain('DELETE FROM journey_replay_lease');
      expect(sql).toContain('AND owner_token = ?');
      expect(params).toEqual(['owner-a']);
    });

    it('cannot release a lease now owned by another context', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.runAsync.mockResolvedValue(runResult(0));

      const store = new JourneyQueueStore(database);

      await expect(
        store.releaseReplayLease('stale-owner'),
      ).resolves.toBe(false);
    });

    it('rejects invalid lease arguments before touching SQLite', async () => {
      const { database, databaseMock } = createDatabaseMock();
      const store = new JourneyQueueStore(database);

      await expect(
        store.tryAcquireReplayLease('', 1000, 45000),
      ).rejects.toThrow('ownerToken must not be empty.');

      await expect(
        store.tryAcquireReplayLease('owner-a', -1, 45000),
      ).rejects.toThrow('nowMs must be a non-negative safe integer.');

      await expect(
        store.tryAcquireReplayLease('owner-a', 1000, 0),
      ).rejects.toThrow('leaseMs must be a positive safe integer.');

      await expect(
        store.releaseReplayLease(''),
      ).rejects.toThrow('ownerToken must not be empty.');

      expect(databaseMock.runAsync).not.toHaveBeenCalled();
    });
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

describe('session-scoped replay contracts', () => {
  describe('listOldestForSession', () => {
    it('binds the session before the limit', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.getAllAsync.mockResolvedValue([]);

      const store = new JourneyQueueStore(database);
      await store.listOldestForSession('session-live', 200);

      // PARAMETER ORDER IS THE SILENT FAILURE. Reversed, SQLite binds 200 to
      // session_id, matches nothing, and returns an empty batch - a drain
      // that looks perfectly healthy and transmits nothing at all.
      expect(databaseMock.getAllAsync.mock.calls[0]?.[1]).toEqual([
        'session-live',
        200,
      ]);
    });

    it('filters by session in the statement itself', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.getAllAsync.mockResolvedValue([]);

      const store = new JourneyQueueStore(database);
      await store.listOldestForSession('session-live', 50);

      // Asserted on the QUERY, not the response: a widening fails where it
      // happens rather than somewhere downstream. 14A-11's principle.
      const sql = databaseMock.getAllAsync.mock.calls[0]?.[0] as string;
      expect(sql).toContain('WHERE session_id = ?');
      expect(sql).toContain('ORDER BY queue_id ASC');
    });

    it('maps rows through the same projection as the unscoped read', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.getAllAsync.mockResolvedValue([
        {
          queue_id: 9,
          session_id: 'session-live',
          idempotency_key: 'session-live:1000:9',
          source: 'background',
          latitude: 6.5,
          longitude: 3.3,
          accuracy: null,
          speed: null,
          recorded_at: '2026-08-18T23:38:00.000Z',
        },
      ]);

      const store = new JourneyQueueStore(database);
      const rows = await store.listOldestForSession('session-live', 200);

      expect(rows).toEqual([
        {
          queueId: 9,
          sessionId: 'session-live',
          idempotencyKey: 'session-live:1000:9',
          source: 'background',
          latitude: 6.5,
          longitude: 3.3,
          recordedAt: '2026-08-18T23:38:00.000Z',
        },
      ]);
    });

    it('fails closed on a corrupt stored source', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.getAllAsync.mockResolvedValue([
        {
          queue_id: 1,
          session_id: 'session-live',
          idempotency_key: 'key-1',
          source: 'corrupt',
          latitude: 6.5,
          longitude: 3.3,
          accuracy: null,
          speed: null,
          recorded_at: '2026-08-18T23:38:00.000Z',
        },
      ]);

      const store = new JourneyQueueStore(database);

      await expect(
        store.listOldestForSession('session-live', 1),
      ).rejects.toThrow('Stored Journey fix has an unsupported source: corrupt');
    });

    it('rejects an empty session id before querying', async () => {
      const { database, databaseMock } = createDatabaseMock();
      const store = new JourneyQueueStore(database);

      await expect(store.listOldestForSession('', 200)).rejects.toThrow(
        'sessionId must not be empty.',
      );

      expect(databaseMock.getAllAsync).not.toHaveBeenCalled();
    });

    it('rejects a non-positive limit before querying', async () => {
      const { database, databaseMock } = createDatabaseMock();
      const store = new JourneyQueueStore(database);

      await expect(
        store.listOldestForSession('session-live', 0),
      ).rejects.toThrow('limit must be a positive safe integer.');

      expect(databaseMock.getAllAsync).not.toHaveBeenCalled();
    });
  });

  describe('deleteAcknowledgedForSession', () => {
    it('constrains the delete to one session in SQL', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.runAsync.mockResolvedValue({ changes: 2, lastInsertRowId: 0 });

      const store = new JourneyQueueStore(database);

      await expect(
        store.deleteAcknowledgedForSession('session-live', ['k-1', 'k-2']),
      ).resolves.toBe(2);

      // Without the session predicate this delete could reach another
      // session's evidence, and the shortfall count would stop meaning what
      // ADR-014 section 11 assumes it means.
      //
      // GAP-01A: this runs on the primary database handle now, not a
      // withExclusiveTransactionAsync connection.
      const sql = databaseMock.runAsync.mock.calls[0]?.[0] as string;
      expect(sql).toContain('WHERE session_id = ?');
      expect(sql).toContain('AND idempotency_key IN (?, ?)');
    });

    it('binds the session ahead of the key list', async () => {
      const { database, databaseMock } = createDatabaseMock();
      databaseMock.runAsync.mockResolvedValue({ changes: 2, lastInsertRowId: 0 });

      const store = new JourneyQueueStore(database);
      await store.deleteAcknowledgedForSession('session-live', ['k-1', 'k-2']);

      expect(databaseMock.runAsync.mock.calls[0]?.[1]).toEqual([
        'session-live',
        'k-1',
        'k-2',
      ]);
    });

    it('reports a shortfall within the session rather than throwing', async () => {
      const { database, databaseMock } = createDatabaseMock();
      // Two keys sent, one row removed: the caller must be able to SEE the
      // disagreement and classify it. The store reports, it does not decide.
      databaseMock.runAsync.mockResolvedValue({ changes: 1, lastInsertRowId: 0 });

      const store = new JourneyQueueStore(database);

      await expect(
        store.deleteAcknowledgedForSession('session-live', ['k-1', 'k-2']),
      ).resolves.toBe(1);
    });

    it('does not open a transaction for an empty acknowledgement', async () => {
      const { database, databaseMock } = createDatabaseMock();
      const store = new JourneyQueueStore(database);

      await expect(
        store.deleteAcknowledgedForSession('session-live', []),
      ).resolves.toBe(0);

      expect(databaseMock.withExclusiveTransactionAsync).not.toHaveBeenCalled();
    });

    it('rejects an empty session id before opening a transaction', async () => {
      const { database, databaseMock } = createDatabaseMock();
      const store = new JourneyQueueStore(database);

      await expect(
        store.deleteAcknowledgedForSession('', ['k-1']),
      ).rejects.toThrow('sessionId must not be empty.');

      expect(databaseMock.withExclusiveTransactionAsync).not.toHaveBeenCalled();
    });
  });
});
