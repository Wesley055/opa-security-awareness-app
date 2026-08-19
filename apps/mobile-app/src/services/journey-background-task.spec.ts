import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { openJourneyQueueStoreForBackground } from './journey-queue-store';

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
    getCaptureSequence: jest.Mock;
    enqueue: jest.Mock;
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
      getCaptureSequence: jest.fn().mockResolvedValue(41),
      enqueue: jest.fn().mockResolvedValue({
        inserted: true,
        dropped: 0,
        durableDepth: 1,
      }),
    };
    mockedOpenStore.mockResolvedValue(store as never);
    mockedSecureStore.getItemAsync.mockResolvedValue('session-abc');
  });

  function subject() {
    return require('./journey-background-task') as typeof import('./journey-background-task');
  }

  it('writes the fix to the durable queue', async () => {
    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(position);

    expect(store.enqueue).toHaveBeenCalledTimes(1);
    const [input] = store.enqueue.mock.calls[0];
    expect(input.sessionId).toBe('session-abc');
    expect(input.fix.latitude).toBe(6.5244);
    expect(input.fix.longitude).toBe(3.3792);
  });

  it("records source as 'background', not 'foreground'", async () => {
    // TRUTHFUL PROVENANCE. 'background' is already in TRACKED_SOURCES on the
    // API and the column is VarChar(32), so this costs no migration. Writing
    // 'foreground' would put a false claim into a tamper-evident record.
    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(position);

    const [input] = store.enqueue.mock.calls[0];
    expect(input.fix.source).toBe('background');
  });

  it('reads the capture sequence from SQLite and advances it', async () => {
    // NOT cached in module scope. Two JS contexts must not mint the same
    // sequence, so the persisted value is read fresh on every invocation.
    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(position);

    expect(store.getCaptureSequence).toHaveBeenCalled();
    const [input] = store.enqueue.mock.calls[0];
    expect(input.captureSequence).toBe(42);
    expect(input.fix.idempotencyKey).toBe('session-abc:1786000000000:42');
  });

  it('records CAPTURE time, not the time the fix is eventually sent', async () => {
    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(position);

    const [input] = store.enqueue.mock.calls[0];
    expect(input.fix.recordedAt).toBe(new Date(1786000000000).toISOString());
  });

  it('retains the full active-incident depth and never defers eviction', async () => {
    // The same bound the foreground path uses. A background capture must not
    // discard emergency history the foreground path would have kept - and
    // deferral is impossible here, because this context cannot observe
    // whether a replay is in flight.
    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(position);

    const [, options] = store.enqueue.mock.calls[0];
    expect(options.maxQueuedFixes).toBe(7200);
    expect(options.deferOverflowEviction).toBe(false);
  });

  it('discards the fix when no session is active', async () => {
    // Tracking stopped while the OS still had a pending delivery. A fix with
    // no session cannot be ingested, and inventing one would attach real
    // movement to the wrong incident.
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(position);

    expect(store.enqueue).not.toHaveBeenCalled();
    expect(mockedOpenStore).not.toHaveBeenCalled();
  });

  it('discards the fix when the stored session is empty', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue('');

    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(position);

    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it('omits negative accuracy and speed rather than sending them', async () => {
    // ADR-010. forbidNonWhitelisted is true and validation is per request, so
    // ONE negative field rejects the ENTIRE batch of up to 200 fixes.
    const negative = {
      coords: { ...position.coords, accuracy: -1, speed: -1 },
      timestamp: 1786000000000,
    } as unknown as Location.LocationObject;

    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(negative);

    const [input] = store.enqueue.mock.calls[0];
    expect(input.fix.accuracy).toBeUndefined();
    expect(input.fix.speed).toBeUndefined();
  });

  it('falls back to wall clock when the platform timestamp is unusable', async () => {
    const noTimestamp = {
      coords: position.coords,
      timestamp: Number.NaN,
    } as unknown as Location.LocationObject;

    const { captureBackgroundFix } = await subject();
    await captureBackgroundFix(noTimestamp);

    const [input] = store.enqueue.mock.calls[0];
    expect(typeof input.fix.recordedAt).toBe('string');
    expect(Number.isNaN(Date.parse(input.fix.recordedAt))).toBe(false);
  });

  it('opens the durable queue exactly once for a multi-location native batch', async () => {
    const secondPosition = {
      ...position,
      coords: {
        ...position.coords,
        latitude: 6.525,
        longitude: 3.38,
      },
      timestamp: 1786000010000,
    } as unknown as Location.LocationObject;

    store.getCaptureSequence
      .mockResolvedValueOnce(41)
      .mockResolvedValueOnce(42);

    const { captureBackgroundBatch } = await subject();

    await captureBackgroundBatch([position, secondPosition]);

    expect(mockedOpenStore).toHaveBeenCalledTimes(1);
    expect(mockedSecureStore.getItemAsync).toHaveBeenCalledTimes(1);
    expect(store.enqueue).toHaveBeenCalledTimes(2);

    expect(store.enqueue.mock.calls[0]?.[0].captureSequence).toBe(42);
    expect(store.enqueue.mock.calls[1]?.[0].captureSequence).toBe(43);
  });

  it('does not open SQLite for a batch after session ownership has disappeared', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    const { captureBackgroundBatch } = await subject();

    await captureBackgroundBatch([position, position]);

    expect(mockedOpenStore).not.toHaveBeenCalled();
    expect(store.enqueue).not.toHaveBeenCalled();
  });
});
