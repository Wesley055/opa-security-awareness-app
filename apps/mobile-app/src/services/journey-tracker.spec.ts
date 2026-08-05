import * as Location from 'expo-location';
import { api } from './api';
import { openJourneyQueueStore } from './journey-queue-store';
import {
  cleanHeading,
  cleanNonNegative,
  flushForTests,
  resetTrackerStateForTests,
  startTracking,
  stopTracking,
  trackerDebugState,
} from './journey-tracker';

jest.mock('expo-location', () => ({
  Accuracy: { High: 6 },
  getForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

jest.mock('./api', () => ({
  api: { post: jest.fn() },
}));

jest.mock('./journey-queue-store', () => ({
  openJourneyQueueStore: jest.fn(),
}));

const mockedLocation = Location as jest.Mocked<typeof Location>;
const mockedPost = api.post as jest.Mock;
const mockedOpenStore = openJourneyQueueStore as jest.Mock;

const IDLE_STATE = {
  running: false,
  sessionId: null,
  queued: 0,
  captureSequence: 0,
  durableQueued: 0,
  durabilityAvailable: false,
  durabilityFault: null,
  replayFault: null,
  evictionDiagnostic: null,
};

function storeMock(captureSequence = 0, queued = 0) {
  return {
    initialize: jest.fn(),
    enqueue: jest.fn().mockResolvedValue({
      inserted: true,
      dropped: 0,
      durableDepth: 1,
    }),
    listOldest: jest.fn().mockResolvedValue([]),
    deleteAcknowledged: jest.fn().mockResolvedValue(0),
    trimToDepth: jest.fn().mockResolvedValue({
      dropped: 0,
      durableDepth: 0,
    }),
    count: jest.fn().mockResolvedValue(queued),
    getCaptureSequence: jest.fn().mockResolvedValue(captureSequence),
  };
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    queueId: 1,
    sessionId: 'session-1',
    idempotencyKey: 'session-1:1000:1',
    source: 'foreground',
    latitude: 6.5244,
    longitude: 3.3792,
    accuracy: 5,
    speed: 1.5,
    recordedAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
}

function axiosRejection(status: number) {
  // isAxiosError checks this flag. A fixture without it classifies as a
  // generic network failure and the test would pass while proving nothing.
  return Object.assign(new Error('request failed with status ' + String(status)), {
    isAxiosError: true,
    response: { status: status, data: {} },
  });
}

function replayingStore(rows = 1) {
  const store = storeMock(0, rows);
  store.listOldest.mockResolvedValue([storedRow()]);
  store.deleteAcknowledged.mockResolvedValue(1);
  store.count.mockResolvedValue(rows);
  return store;
}

function grantAndAcquire(): { remove: jest.Mock } {
  const remove = jest.fn();

  mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({
    granted: true,
  } as never);

  mockedPost.mockResolvedValueOnce({
    data: { sessionId: 'session-1', reused: true, purpose: 'INCIDENT' },
  });

  mockedLocation.watchPositionAsync.mockResolvedValue({ remove } as never);

  return { remove };
}

describe('journey-tracker sanitizers', () => {
  it('keeps finite non-negative values', () => {
    expect(cleanNonNegative(0)).toBe(0);
    expect(cleanNonNegative(2.5)).toBe(2.5);
  });

  it('drops negative, missing and non-finite values', () => {
    expect(cleanNonNegative(-1)).toBeUndefined();
    expect(cleanNonNegative(Number.NaN)).toBeUndefined();
    expect(cleanNonNegative(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(cleanNonNegative(null)).toBeUndefined();
    expect(cleanNonNegative(undefined)).toBeUndefined();
  });

  it('keeps headings from zero through 360 inclusive', () => {
    expect(cleanHeading(0)).toBe(0);
    expect(cleanHeading(180)).toBe(180);
    expect(cleanHeading(360)).toBe(360);
  });

  it('drops invalid headings', () => {
    expect(cleanHeading(-1)).toBeUndefined();
    expect(cleanHeading(361)).toBeUndefined();
    expect(cleanHeading(Number.NaN)).toBeUndefined();
    expect(cleanHeading(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(cleanHeading(null)).toBeUndefined();
    expect(cleanHeading(undefined)).toBeUndefined();
  });
});

describe('journey-tracker lifecycle', () => {
  beforeEach(() => {
    resetTrackerStateForTests();
    mockedPost.mockReset();
    mockedOpenStore.mockReset();
    mockedLocation.getForegroundPermissionsAsync.mockReset();
    mockedLocation.watchPositionAsync.mockReset();
  });

  afterEach(() => {
    resetTrackerStateForTests();
  });

  it('stays stopped when foreground permission is denied', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
    } as never);

    await startTracking();

    expect(mockedOpenStore).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedLocation.watchPositionAsync).not.toHaveBeenCalled();
    expect(trackerDebugState()).toEqual(IDLE_STATE);
  });

  it('stopTracking is idempotent when nothing is running', () => {
    expect(() => stopTracking()).not.toThrow();
    expect(() => stopTracking()).not.toThrow();
    expect(trackerDebugState()).toEqual(IDLE_STATE);
  });

  it('opens the durable queue BEFORE acquiring a session', async () => {
    const store = storeMock(44, 12);
    const { remove } = grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);

    await startTracking();

    expect(mockedOpenStore).toHaveBeenCalledTimes(1);
    expect(store.getCaptureSequence).toHaveBeenCalledTimes(1);
    expect(store.count).toHaveBeenCalledTimes(1);

    const openOrder = mockedOpenStore.mock.invocationCallOrder[0];
    const postOrder = mockedPost.mock.invocationCallOrder[0];
    expect(openOrder).toBeLessThan(postOrder);

    expect(mockedPost).toHaveBeenCalledWith(
      '/journey/sessions',
      { purpose: 'MANUAL' },
    );

    expect(trackerDebugState()).toEqual({
      running: true,
      sessionId: 'session-1',
      queued: 12,
      captureSequence: 44,
      durableQueued: 12,
      durabilityAvailable: true,
      durabilityFault: null,
      replayFault: null,
      evictionDiagnostic: null,
    });

    stopTracking();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('restores a persisted capture sequence rather than resetting to zero', async () => {
    const store = storeMock(7, 3);
    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);

    await startTracking();

    expect(trackerDebugState().captureSequence).toBe(7);

    stopTracking();
  });

  it('posts ONLY TrackedFix keys - queueId and sessionId never reach the wire', async () => {
    const store = storeMock(0, 1);
    store.listOldest.mockResolvedValue([storedRow()]);
    store.deleteAcknowledged.mockResolvedValue(1);
    store.count.mockResolvedValue(0);

    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);
    mockedPost.mockResolvedValue({ data: {} });

    await startTracking();
    await flushForTests();

    const fixCall = mockedPost.mock.calls.find(
      (call) => call[0] === '/journey/fixes',
    );

    expect(fixCall).toBeDefined();

    const sent = (fixCall?.[1] as { fixes: Record<string, unknown>[] }).fixes;

    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual([
      'accuracy',
      'idempotencyKey',
      'latitude',
      'longitude',
      'recordedAt',
      'source',
      'speed',
    ]);

    stopTracking();
  });

  it('stops the cycle and records a fault on a delete shortfall', async () => {
    const store = storeMock(0, 2);
    store.listOldest.mockResolvedValue([
      storedRow(),
      storedRow({ queueId: 2, idempotencyKey: 'session-1:1000:2' }),
    ]);
    store.deleteAcknowledged.mockResolvedValue(1);
    store.count.mockResolvedValue(1);

    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);
    mockedPost.mockResolvedValue({ data: {} });

    await startTracking();
    await flushForTests();

    expect(trackerDebugState().replayFault).toMatchObject({
      kind: 'DELETE_SHORTFALL',
      expected: 2,
      actual: 1,
      message: expect.stringContaining('expected 2 and actual 1'),
    });

    // The relocation must MOVE the fault, not copy it. Without this the
    // test would pass with both slots populated. ADR-014 section 11: one
    // category never clears - or occupies - the other.
    expect(trackerDebugState().durabilityFault).toBeNull();

    stopTracking();
  });

  it('applies deferred eviction after the replay cycle', async () => {
    const store = storeMock(0, 1);
    store.listOldest.mockResolvedValue([storedRow()]);
    store.deleteAcknowledged.mockResolvedValue(1);
    store.count.mockResolvedValue(0);
    store.trimToDepth.mockResolvedValue({ dropped: 4, durableDepth: 600 });

    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);
    mockedPost.mockResolvedValue({ data: {} });

    await startTracking();
    await flushForTests();

    expect(store.trimToDepth).toHaveBeenCalledWith(600);
    expect(trackerDebugState().durableQueued).toBe(600);

    stopTracking();
  });

  it('fails closed when the durable queue cannot be opened', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);

    mockedOpenStore.mockRejectedValue(
      new Error('Durable Journey tracking is not supported on web.'),
    );

    await startTracking();

    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedLocation.watchPositionAsync).not.toHaveBeenCalled();

    expect(trackerDebugState()).toEqual({
      running: false,
      sessionId: null,
      queued: 0,
      captureSequence: 0,
      durableQueued: 0,
      durabilityAvailable: false,
      durabilityFault: 'Durable Journey tracking is not supported on web.',
      replayFault: null,
      evictionDiagnostic: null,
    });
  });

  it.each([
    [400, 'HTTP_400', 'REPLAY REJECTED 400'],
    [404, 'HTTP_404', 'REPLAY INDETERMINATE 404'],
    [409, 'HTTP_409', 'REPLAY REJECTED 409'],
  ])(
    'classifies a %i replay rejection, keeps every row and halts',
    async (status, kind) => {
      const store = replayingStore();
      grantAndAcquire();
      mockedOpenStore.mockResolvedValue(store);
      mockedPost.mockRejectedValue(axiosRejection(status));

      await startTracking();
      await flushForTests();

      expect(trackerDebugState().replayFault).toMatchObject({
        kind: kind,
        status: status,
      });
      expect(store.deleteAcknowledged).not.toHaveBeenCalled();
      expect(trackerDebugState().durabilityFault).toBeNull();

      stopTracking();
    },
  );

  it('treats a 401 as transient and never sets a replay fault', async () => {
    const store = replayingStore();
    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);
    mockedPost.mockRejectedValue(axiosRejection(401));

    await startTracking();
    await flushForTests();

    expect(trackerDebugState().replayFault).toBeNull();
    expect(store.deleteAcknowledged).not.toHaveBeenCalled();

    stopTracking();
  });

  it('suppresses steady-state trim while a replay fault is set', async () => {
    const store = replayingStore();
    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);
    mockedPost.mockRejectedValue(axiosRejection(400));

    await startTracking();
    await flushForTests();

    expect(store.trimToDepth).not.toHaveBeenCalled();

    stopTracking();
  });

  it('clears the replay fault when a later cycle receives a 2xx', async () => {
    const store = replayingStore();
    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);
    mockedPost.mockRejectedValueOnce(axiosRejection(400));

    await startTracking();
    await flushForTests();

    expect(trackerDebugState().replayFault).toMatchObject({ kind: 'HTTP_400' });

    mockedPost.mockResolvedValue({ data: {} });
    store.count.mockResolvedValue(0);
    await flushForTests();

    expect(trackerDebugState().replayFault).toBeNull();
    expect(store.trimToDepth).toHaveBeenCalledWith(600);

    stopTracking();
  });

  it('raises the enqueue bound to the emergency ceiling while faulted', async () => {
    const store = replayingStore();
    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);
    mockedPost.mockRejectedValue(axiosRejection(409));

    await startTracking();
    await flushForTests();

    const capture = mockedLocation.watchPositionAsync.mock.calls[0]?.[1] as
      | ((position: unknown) => void)
      | undefined;

    expect(capture).toBeDefined();
    capture?.({ coords: { latitude: 1, longitude: 2 }, timestamp: Date.now() });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        maxQueuedFixes: 1200,
        deferOverflowEviction: false,
      }),
    );

    stopTracking();
  });

  it('records an emergency eviction diagnostic without touching either fault', async () => {
    const store = replayingStore();
    store.enqueue.mockResolvedValue({
      inserted: true,
      dropped: 3,
      durableDepth: 1200,
    });

    grantAndAcquire();
    mockedOpenStore.mockResolvedValue(store);
    mockedPost.mockRejectedValue(axiosRejection(409));

    await startTracking();
    await flushForTests();

    const capture = mockedLocation.watchPositionAsync.mock.calls[0]?.[1] as
      | ((position: unknown) => void)
      | undefined;

    capture?.({ coords: { latitude: 1, longitude: 2 }, timestamp: Date.now() });
    await Promise.resolve();
    await Promise.resolve();

    expect(trackerDebugState().evictionDiagnostic).toMatchObject({
      kind: 'FAULTED_QUEUE_EMERGENCY_EVICTION',
      dropped: 3,
      ceiling: 1200,
    });
    expect(trackerDebugState().replayFault).toMatchObject({ kind: 'HTTP_409' });
    expect(trackerDebugState().durabilityFault).toBeNull();

    stopTracking();
  });

  it('a second flush exits while the first is still pending', async () => {
    const store = replayingStore();

    let releasePost: (() => void) | undefined;
    mockedPost.mockImplementation((url: string) => {
      if (url === '/journey/fixes') {
        return new Promise((resolve) => {
          releasePost = () => resolve({ data: {} });
        });
      }
      return Promise.resolve({
        data: { sessionId: 'session-1', reused: true, purpose: 'INCIDENT' },
      });
    });

    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedLocation.watchPositionAsync.mockResolvedValue({
      remove: jest.fn(),
    } as never);
    mockedOpenStore.mockResolvedValue(store);

    await startTracking();

    const first = flushForTests();
    await Promise.resolve();

    // The re-entry guard makes this a no-op rather than a second batch.
    await flushForTests();

    expect(store.listOldest).toHaveBeenCalledTimes(1);

    releasePost?.();
    await first;

    expect(store.listOldest).toHaveBeenCalledTimes(1);

    stopTracking();
  });

  it('a capture during a HEALTHY flush defers eviction at the ordinary bound', async () => {
    const store = replayingStore();

    let releasePost: (() => void) | undefined;
    mockedPost.mockImplementation((url: string) => {
      if (url === '/journey/fixes') {
        return new Promise((resolve) => {
          releasePost = () => resolve({ data: {} });
        });
      }
      return Promise.resolve({
        data: { sessionId: 'session-1', reused: true, purpose: 'INCIDENT' },
      });
    });

    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedLocation.watchPositionAsync.mockResolvedValue({
      remove: jest.fn(),
    } as never);
    mockedOpenStore.mockResolvedValue(store);

    await startTracking();

    const inFlight = flushForTests();
    await Promise.resolve();

    const capture = mockedLocation.watchPositionAsync.mock.calls[0]?.[1] as
      | ((position: unknown) => void)
      | undefined;

    expect(capture).toBeDefined();
    capture?.({ coords: { latitude: 1, longitude: 2 }, timestamp: Date.now() });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      { maxQueuedFixes: 600, deferOverflowEviction: true },
    );

    releasePost?.();
    await inFlight;

    stopTracking();
  });

  it('a capture during a FAULTED flush enforces the ceiling and never defers', async () => {
    // The strongest guard on ADR-014 section 11: this is the only assertion
    // that distinguishes `flushing && !faulted` from a bare `flushing`.
    const store = replayingStore();

    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedLocation.watchPositionAsync.mockResolvedValue({
      remove: jest.fn(),
    } as never);
    mockedOpenStore.mockResolvedValue(store);

    let releasePost: (() => void) | undefined;
    mockedPost.mockImplementation((url: string) => {
      if (url === '/journey/fixes') {
        return Promise.reject(axiosRejection(409));
      }
      return Promise.resolve({
        data: { sessionId: 'session-1', reused: true, purpose: 'INCIDENT' },
      });
    });

    await startTracking();

    // Cycle one raises the fault.
    await flushForTests();
    expect(trackerDebugState().replayFault).toMatchObject({ kind: 'HTTP_409' });

    // Cycle two is held open so a capture lands while BOTH flags are set.
    mockedPost.mockImplementation((url: string) => {
      if (url === '/journey/fixes') {
        return new Promise((_resolve, reject) => {
          releasePost = () => reject(axiosRejection(409));
        });
      }
      return Promise.resolve({ data: {} });
    });

    const inFlight = flushForTests();
    await Promise.resolve();

    const capture = mockedLocation.watchPositionAsync.mock.calls[0]?.[1] as
      | ((position: unknown) => void)
      | undefined;

    capture?.({ coords: { latitude: 3, longitude: 4 }, timestamp: Date.now() });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      { maxQueuedFixes: 1200, deferOverflowEviction: false },
    );

    releasePost?.();
    await inFlight;

    stopTracking();
  });
});

describe('journey-tracker module reset', () => {
  // resetModules is a PROXY for a fresh module instance. It does NOT kill a
  // process and proves NOTHING about surviving process death - see ADR-014
  // section 11 and the Ultra 26 note on this exact hazard. What it does
  // prove: a freshly loaded tracker re-opens the durable store, restores the
  // persisted capture sequence, and starts with both fault slots clear.
  it('resetModules reopens the durable store and restores capture sequence', async () => {
    jest.resetModules();

    await jest.isolateModulesAsync(async () => {
      // Handles must be fetched INSIDE the block. resetModules re-evaluates
      // the jest.mock factories, so the outer mockedOpenStore and mockedPost
      // are different function objects from the ones the fresh tracker sees.
      const freshStoreModule = jest.requireMock(
        './journey-queue-store',
      ) as { openJourneyQueueStore: jest.Mock };
      const freshApi = jest.requireMock('./api') as { api: { post: jest.Mock } };
      const freshLocation = jest.requireMock(
        'expo-location',
      ) as {
        getForegroundPermissionsAsync: jest.Mock;
        watchPositionAsync: jest.Mock;
      };

      const store = {
        initialize: jest.fn(),
        enqueue: jest.fn().mockResolvedValue({
          inserted: true,
          dropped: 0,
          durableDepth: 1,
        }),
        listOldest: jest.fn().mockResolvedValue([]),
        deleteAcknowledged: jest.fn().mockResolvedValue(0),
        trimToDepth: jest.fn().mockResolvedValue({ dropped: 0, durableDepth: 0 }),
        count: jest.fn().mockResolvedValue(9),
        getCaptureSequence: jest.fn().mockResolvedValue(31),
      };

      freshStoreModule.openJourneyQueueStore.mockResolvedValue(store);
      freshLocation.getForegroundPermissionsAsync.mockResolvedValue({
        granted: true,
      });
      freshLocation.watchPositionAsync.mockResolvedValue({ remove: jest.fn() });
      freshApi.api.post.mockResolvedValue({
        data: { sessionId: 'session-9', reused: false, purpose: 'INCIDENT' },
      });

      // NOT `await import()`. Babel leaves a dynamic import as a real
      // dynamic import, which needs --experimental-vm-modules. require()
      // goes through the module registry isolateModulesAsync just reset,
      // which is what this test needs anyway. The `typeof import(...)` is
      // a TYPE position and is erased at compile time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fresh = require('./journey-tracker') as typeof import('./journey-tracker');

      await fresh.startTracking();

      expect(freshStoreModule.openJourneyQueueStore).toHaveBeenCalledTimes(1);
      expect(store.getCaptureSequence).toHaveBeenCalledTimes(1);

      const state = fresh.trackerDebugState();
      expect(state.captureSequence).toBe(31);
      expect(state.replayFault).toBeNull();
      expect(state.evictionDiagnostic).toBeNull();

      fresh.stopTracking();
      fresh.resetTrackerStateForTests();
    });
  });
});
