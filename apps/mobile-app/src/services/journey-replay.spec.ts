jest.mock('../config/api-config', () => ({
  API_BASE_URL: 'https://vc6.test',
}));
import type { AxiosInstance } from 'axios';
import {
  JOURNEY_REPLAY_LEASE_MS,
  JOURNEY_REPLAY_MAX_BATCH,
  JOURNEY_REPLAY_TIMEOUT_MS,
  replayJourneySessionWithLease,
} from './journey-replay';
import type {
  JourneyQueueStore,
  StoredJourneyFix,
} from './journey-queue-store';

function storedRow(
  key: string,
  options: {
    accuracy?: number;
    speed?: number;
  } = {},
): StoredJourneyFix {
  const row: StoredJourneyFix = {
    queueId: 17,
    sessionId: 'session-live',
    idempotencyKey: key,
    source: 'background',
    latitude: 6.5244,
    longitude: 3.3792,
    recordedAt: '2026-08-21T04:00:00.000Z',
  };

  if (options.accuracy !== undefined) {
    row.accuracy = options.accuracy;
  }

  if (options.speed !== undefined) {
    row.speed = options.speed;
  }

  return row;
}

function createStoreMock() {
  const store = {
    tryAcquireReplayLease: jest.fn(),
    releaseReplayLease: jest.fn(),
    listOldestForSession: jest.fn(),
    deleteAcknowledgedForSession: jest.fn(),
    count: jest.fn(),
  };

  return store as unknown as jest.Mocked<JourneyQueueStore>;
}

function createClientMock() {
  return {
    post: jest.fn(),
  } as unknown as jest.Mocked<AxiosInstance>;
}

describe('replayJourneySessionWithLease', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing when another context owns the replay lease', async () => {
    const store = createStoreMock();
    const client = createClientMock();

    store.tryAcquireReplayLease.mockResolvedValue(false);

    await expect(
      replayJourneySessionWithLease(
        store,
        'session-live',
        'background:owner-a',
        client,
      ),
    ).resolves.toEqual({
      kind: 'LEASE_BUSY',
    });

    expect(store.listOldestForSession).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
    expect(store.deleteAcknowledgedForSession).not.toHaveBeenCalled();
    expect(store.releaseReplayLease).not.toHaveBeenCalled();
  });

  it('releases the lease when the named session has no rows', async () => {
    const store = createStoreMock();
    const client = createClientMock();

    store.tryAcquireReplayLease.mockResolvedValue(true);
    store.listOldestForSession.mockResolvedValue([]);
    store.releaseReplayLease.mockResolvedValue(true);

    await expect(
      replayJourneySessionWithLease(
        store,
        'session-live',
        'background:owner-a',
        client,
      ),
    ).resolves.toEqual({
      kind: 'EMPTY',
    });

    expect(store.listOldestForSession).toHaveBeenCalledWith(
      'session-live',
      JOURNEY_REPLAY_MAX_BATCH,
    );

    expect(store.releaseReplayLease).toHaveBeenCalledWith(
      'background:owner-a',
    );

    expect(client.post).not.toHaveBeenCalled();
  });

  it('uses the existing Journey wire shape and deletes only after 2xx', async () => {
    const store = createStoreMock();
    const client = createClientMock();

    store.tryAcquireReplayLease.mockResolvedValue(true);

    store.listOldestForSession.mockResolvedValue([
      storedRow(
        'session-live:1000:1',
        { accuracy: 5, speed: 1.5 },
      ),
      storedRow('session-live:2000:2'),
    ]);

    client.post.mockResolvedValue({} as never);

    store.deleteAcknowledgedForSession.mockResolvedValue(2);
    store.count.mockResolvedValue(0);
    store.releaseReplayLease.mockResolvedValue(true);

    await expect(
      replayJourneySessionWithLease(
        store,
        'session-live',
        'background:owner-a',
        client,
      ),
    ).resolves.toEqual({
      kind: 'SENT',
      sent: 2,
      removed: 2,
      durableDepth: 0,
    });

    expect(client.post).toHaveBeenCalledWith(
      '/journey/fixes',
      {
        sessionId: 'session-live',
        fixes: [
          {
            idempotencyKey: 'session-live:1000:1',
            source: 'background',
            latitude: 6.5244,
            longitude: 3.3792,
            accuracy: 5,
            speed: 1.5,
            recordedAt: '2026-08-21T04:00:00.000Z',
          },
          {
            idempotencyKey: 'session-live:2000:2',
            source: 'background',
            latitude: 6.5244,
            longitude: 3.3792,
            recordedAt: '2026-08-21T04:00:00.000Z',
          },
        ],
      },
      {
        timeout: JOURNEY_REPLAY_TIMEOUT_MS,
      },
    );

    const postedFixes =
      (client.post.mock.calls[0]?.[1] as {
        fixes: Record<string, unknown>[];
      }).fixes;

    /*
     * Load-bearing projection assertions. Stored queue metadata must never
     * leak into the whitelist DTO.
     */
    expect(postedFixes[0]).not.toHaveProperty('queueId');
    expect(postedFixes[0]).not.toHaveProperty('sessionId');

    /*
     * Optional telemetry is ABSENT when the SQLite column mapped to undefined.
     */
    expect(postedFixes[1]).not.toHaveProperty('accuracy');
    expect(postedFixes[1]).not.toHaveProperty('speed');

    expect(
      store.deleteAcknowledgedForSession,
    ).toHaveBeenCalledWith(
      'session-live',
      [
        'session-live:1000:1',
        'session-live:2000:2',
      ],
    );

    const postOrder = client.post.mock.invocationCallOrder[0];
    const deleteOrder =
      store.deleteAcknowledgedForSession.mock.invocationCallOrder[0];

    expect(postOrder).toBeLessThan(deleteOrder);
  });

  it('retains every durable row when HTTP fails', async () => {
    const store = createStoreMock();
    const client = createClientMock();

    store.tryAcquireReplayLease.mockResolvedValue(true);

    store.listOldestForSession.mockResolvedValue([
      storedRow('session-live:1000:1'),
    ]);

    client.post.mockRejectedValue(new Error('offline'));
    store.releaseReplayLease.mockResolvedValue(true);

    await expect(
      replayJourneySessionWithLease(
        store,
        'session-live',
        'background:owner-a',
        client,
      ),
    ).resolves.toEqual({
      kind: 'HTTP_ERROR',
      status: undefined,
      message: 'offline',
    });

    expect(
      store.deleteAcknowledgedForSession,
    ).not.toHaveBeenCalled();

    expect(store.releaseReplayLease).toHaveBeenCalledWith(
      'background:owner-a',
    );
  });

  it('surfaces a session-scoped delete shortfall', async () => {
    const store = createStoreMock();
    const client = createClientMock();

    store.tryAcquireReplayLease.mockResolvedValue(true);

    store.listOldestForSession.mockResolvedValue([
      storedRow('session-live:1000:1'),
      storedRow('session-live:2000:2'),
    ]);

    client.post.mockResolvedValue({} as never);

    store.deleteAcknowledgedForSession.mockResolvedValue(1);
    store.count.mockResolvedValue(1);
    store.releaseReplayLease.mockResolvedValue(true);

    await expect(
      replayJourneySessionWithLease(
        store,
        'session-live',
        'background:owner-a',
        client,
      ),
    ).resolves.toEqual({
      kind: 'DELETE_SHORTFALL',
      expected: 2,
      actual: 1,
      durableDepth: 1,
    });

    expect(store.releaseReplayLease).toHaveBeenCalledWith(
      'background:owner-a',
    );
  });

  it('releases the lease when reading the durable queue throws', async () => {
    const store = createStoreMock();
    const client = createClientMock();

    store.tryAcquireReplayLease.mockResolvedValue(true);
    store.listOldestForSession.mockRejectedValue(
      new Error('sqlite unavailable'),
    );
    store.releaseReplayLease.mockResolvedValue(true);

    await expect(
      replayJourneySessionWithLease(
        store,
        'session-live',
        'background:owner-a',
        client,
      ),
    ).rejects.toThrow('sqlite unavailable');

    expect(store.releaseReplayLease).toHaveBeenCalledWith(
      'background:owner-a',
    );
  });

  it('rejects empty replay identity before SQLite arbitration', async () => {
    const store = createStoreMock();
    const client = createClientMock();

    await expect(
      replayJourneySessionWithLease(
        store,
        '',
        'background:owner-a',
        client,
      ),
    ).rejects.toThrow('replaySession must not be empty.');

    await expect(
      replayJourneySessionWithLease(
        store,
        'session-live',
        '',
        client,
      ),
    ).rejects.toThrow('ownerToken must not be empty.');

    expect(store.tryAcquireReplayLease).not.toHaveBeenCalled();
  });

  it('keeps lease lifetime above the Journey HTTP timeout', () => {
    expect(JOURNEY_REPLAY_TIMEOUT_MS).toBe(30000);
    expect(JOURNEY_REPLAY_LEASE_MS).toBeGreaterThan(
      JOURNEY_REPLAY_TIMEOUT_MS,
    );
  });
});