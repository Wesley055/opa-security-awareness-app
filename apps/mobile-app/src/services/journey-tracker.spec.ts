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
});
