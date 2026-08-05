import * as Location from 'expo-location';
import { api } from './api';
import { openJourneyQueueStore } from './journey-queue-store';
import {
  cleanHeading,
  cleanNonNegative,
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
};

function storeMock(captureSequence = 0, queued = 0) {
  return {
    initialize: jest.fn(),
    enqueue: jest.fn(),
    listOldest: jest.fn(),
    deleteAcknowledged: jest.fn(),
    count: jest.fn().mockResolvedValue(queued),
    getCaptureSequence: jest.fn().mockResolvedValue(captureSequence),
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
      queued: 0,
      captureSequence: 44,
      durableQueued: 12,
      durabilityAvailable: true,
      durabilityFault: null,
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
    });
  });
});
