import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { openJourneyQueueStoreForBackground } from './journey-queue-store';

jest.mock('./journey-replay', () => ({
  createJourneyReplayOwnerToken: jest.fn(
    () => 'background:test-owner',
  ),
  replayJourneySessionWithLease: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
}));

jest.mock('./journey-queue-store', () => ({
  openJourneyQueueStoreForBackground: jest.fn(),
}));

jest.mock('./api', () => ({
  api: { post: jest.fn() },
  backgroundApi: { post: jest.fn() },
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockedOpenStore =
  openJourneyQueueStoreForBackground as jest.MockedFunction<
    typeof openJourneyQueueStoreForBackground
  >;

/**
 * The background task is the fix for a MEASURED production defect: a 26 km
 * drive recorded as two points because capture stopped when the app was
 * backgrounded. These tests pin the properties that make it correct.
 */
describe('captureBackgroundFix', () => {
  let store: {
    enqueueBatch: jest.Mock;
  };

  const position = {
    coords: {
      latitude: 6.5244,
      longitude: 3.3792,
      accuracy: 12,
      speed: 4.5,
      altitude: null,
      heading: null,
      altitudeAccuracy: null,
    },
    timestamp: 1786000000000,
  } as unknown as Location.LocationObject;

  beforeEach(() => {
    jest.clearAllMocks();

    store = {
      enqueueBatch: jest.fn().mockResolvedValue({
        inserted: 1,
        dropped: 0,
        durableDepth: 1,
        captureSequences: [42],
      }),
    };

    mockedOpenStore.mockResolvedValue(store as never);
    mockedSecureStore.getItemAsync.mockResolvedValue('session-abc');
  });

  function subject() {
    return require('./journey-background-task') as typeof import('./journey-background-task');
  }

  it('writes the fix to the durable queue through enqueueBatch', async () => {
    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(position);

    expect(store.enqueueBatch).toHaveBeenCalledTimes(1);

    const [sessionId, items] = store.enqueueBatch.mock.calls[0];

    expect(sessionId).toBe('session-abc');
    expect(items).toHaveLength(1);
    expect(items[0].fix.latitude).toBe(6.5244);
    expect(items[0].fix.longitude).toBe(3.3792);
  });

  it("records source as 'background', not 'foreground'", async () => {
    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(position);

    const [, items] = store.enqueueBatch.mock.calls[0];

    expect(items[0].fix.source).toBe('background');
  });

  it('delegates sequence and idempotency-key allocation to the durable store', async () => {
    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(position);

    const [, items] = store.enqueueBatch.mock.calls[0];

    // The headless caller no longer reads or allocates captureSequence.
    // enqueueBatch owns that operation inside its exclusive transaction.
    expect(items[0]).not.toHaveProperty('captureSequence');
    expect(items[0].fix).not.toHaveProperty('idempotencyKey');
    expect(items[0].capturedAtMs).toBe(1786000000000);
  });

  it('records CAPTURE time, not the time the fix is eventually sent', async () => {
    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(position);

    const [, items] = store.enqueueBatch.mock.calls[0];

    expect(items[0].capturedAtMs).toBe(1786000000000);
    expect(items[0].fix.recordedAt).toBe(
      new Date(1786000000000).toISOString(),
    );
  });

  it('retains the full active-incident depth and never defers eviction', async () => {
    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(position);

    const [, , options] = store.enqueueBatch.mock.calls[0];

    expect(options.maxQueuedFixes).toBe(7200);
    expect(options.deferOverflowEviction).toBe(false);
  });

  it('discards the fix when no session is active', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(position);

    expect(store.enqueueBatch).not.toHaveBeenCalled();
    expect(mockedOpenStore).not.toHaveBeenCalled();
  });

  it('discards the fix when the stored session is empty', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue('');

    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(position);

    expect(store.enqueueBatch).not.toHaveBeenCalled();
    expect(mockedOpenStore).not.toHaveBeenCalled();
  });

  it('omits negative accuracy and speed rather than storing them', async () => {
    const negative = {
      coords: {
        ...position.coords,
        accuracy: -1,
        speed: -1,
      },
      timestamp: 1786000000000,
    } as unknown as Location.LocationObject;

    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(negative);

    const [, items] = store.enqueueBatch.mock.calls[0];

    expect(items[0].fix.accuracy).toBeUndefined();
    expect(items[0].fix.speed).toBeUndefined();
  });

  it('falls back to wall clock when the platform timestamp is unusable', async () => {
    const noTimestamp = {
      coords: position.coords,
      timestamp: Number.NaN,
    } as unknown as Location.LocationObject;

    const { captureBackgroundFix } = await subject();

    await captureBackgroundFix(noTimestamp);

    const [, items] = store.enqueueBatch.mock.calls[0];

    expect(Number.isSafeInteger(items[0].capturedAtMs)).toBe(true);
    expect(typeof items[0].fix.recordedAt).toBe('string');
    expect(Number.isNaN(Date.parse(items[0].fix.recordedAt))).toBe(false);
  });

  it('opens once and submits one atomic enqueueBatch for a multi-location native delivery', async () => {
    const secondPosition = {
      ...position,
      coords: {
        ...position.coords,
        latitude: 6.525,
        longitude: 3.38,
      },
      timestamp: 1786000010000,
    } as unknown as Location.LocationObject;

    store.enqueueBatch.mockResolvedValue({
      inserted: 2,
      dropped: 0,
      durableDepth: 2,
      captureSequences: [42, 43],
    });

    const { captureBackgroundBatch } = await subject();

    await captureBackgroundBatch([position, secondPosition]);

    expect(mockedOpenStore).toHaveBeenCalledTimes(1);
    expect(mockedSecureStore.getItemAsync).toHaveBeenCalledTimes(1);

    // This is the GAP-01A invariant: one native TaskManager delivery causes
    // ONE store batch operation, not one exclusive transaction per fix.
    expect(store.enqueueBatch).toHaveBeenCalledTimes(1);

    const [sessionId, items, options] = store.enqueueBatch.mock.calls[0];

    expect(sessionId).toBe('session-abc');
    expect(items).toHaveLength(2);

    expect(items[0].capturedAtMs).toBe(1786000000000);
    expect(items[1].capturedAtMs).toBe(1786000010000);

    expect(items[0].fix.latitude).toBe(6.5244);
    expect(items[1].fix.latitude).toBe(6.525);

    expect(options.maxQueuedFixes).toBe(7200);
    expect(options.deferOverflowEviction).toBe(false);
  });

  it('does not open SQLite for a batch after session ownership has disappeared', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    const { captureBackgroundBatch } = await subject();

    await captureBackgroundBatch([position, position]);

    expect(mockedOpenStore).not.toHaveBeenCalled();
    expect(store.enqueueBatch).not.toHaveBeenCalled();
  });
});
