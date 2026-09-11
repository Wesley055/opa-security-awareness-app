import { activateFromVoiceTrigger } from './voice-activation-coordinator';
import { advanceAuthSessionEpoch } from './auth-session-epoch';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { backgroundApi, api } from './api';
import { runHeadlessProtectionWorker } from './headless-sos-worker';
import { reconcileEmergencyTracking } from './emergency-tracking';
import { startTracking, stopTracking, trackerDebugState } from './journey-tracker';
import { captureBackgroundBatch } from './journey-background-task';
import { replayJourneySessionWithLease } from './journey-replay';

let mockIncident: string | null = null;
let mockRegistered = false;
let mockForeground = false;
let mockQueue: { id: string; type: string; timestamp: number; activationMode: string; claimToken: string }[] = [];
const mockEvents: string[] = [];
const mockValues = new Map<string, string>();
const mockNative = {
  getEmergencyTrackingIncident: jest.fn(() => mockIncident),
  rememberEmergencyTrackingIncidentAsync: jest.fn(async (id: string) => { mockIncident = id; mockEvents.push('durable'); }),
  beginEmergencyLocationAsync: jest.fn(async () => { mockEvents.push('location-fgs'); }),
  endEmergencyTrackingAsync: jest.fn(async () => { mockIncident = null; }),
};
const mockStore = {
  getCaptureSequence: jest.fn(async () => 0), count: jest.fn(async () => 0),
  enqueueBatch: jest.fn(async () => { mockEvents.push('queue-write'); return { dropped: 0, durableDepth: 1 }; }),
  tryAcquireReplayLease: jest.fn(async () => false),
};
jest.mock('./foreground-execution', () => ({ isForegroundExecutionAllowed: () => mockForeground }));
jest.mock('./emergency-tracking-native', () => ({ nativeEmergencyTracking: () => mockNative }));
jest.mock('../../modules/opa-protection', () => ({
  getNativeSosActivationMode: () => 'SILENT',
  claimPendingOpaProtectionTrigger: jest.fn(async () => mockQueue[0] ?? null),
  acknowledgeClaimedOpaProtectionTrigger: jest.fn(async () => { mockEvents.push('ack'); mockQueue.shift(); return true; }),
  releasePendingOpaProtectionTrigger: jest.fn(),
}));
jest.mock('../store/activeIncidentStore', () => ({ useActiveIncidentStore: { getState: () => ({ setActiveIncident: jest.fn() }) } }));
jest.mock('./voice-protection-service', () => ({ processVoiceTrigger: jest.fn() }));
jest.mock('./sos-activation-coordinator', () => ({ activateFromSosTrigger: jest.fn() }));
jest.mock('./emergency-location', () => ({ acquireEmergencyLocationWithoutPermissionRequest: jest.fn(async () => ({ ok: true, fix: { latitude: 1, longitude: 2, accuracy: 3 } })) }));
jest.mock('./api', () => ({ api: { post: jest.fn() }, backgroundApi: { post: jest.fn(), get: jest.fn() } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockValues.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockValues.delete(key); }),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn(async () => mockRegistered) }));
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  startLocationUpdatesAsync: jest.fn(async () => { mockRegistered = true; mockEvents.push('capture'); }),
  stopLocationUpdatesAsync: jest.fn(async () => { mockRegistered = false; }),
  watchPositionAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn(),
}));
jest.mock('./journey-queue-store', () => ({ bootstrapJourneyQueueStore: jest.fn(async () => mockStore), openJourneyQueueStoreForBackground: jest.fn(async () => mockStore) }));
jest.mock('./journey-replay', () => ({ createJourneyReplayOwnerToken: () => 'owner', JOURNEY_REPLAY_LEASE_MS: 30000, replayJourneySessionWithLease: jest.fn(async () => { mockEvents.push('replay'); return { kind: 'SENT', sent: 1, durableDepth: 0 }; }) }));

beforeEach(async () => {
  await stopTracking();
  jest.clearAllMocks(); mockEvents.length = 0; mockValues.clear(); mockForeground = false; mockIncident = null; mockRegistered = false;
  mockQueue = [{ id: 'trigger', type: 'SOS_BUTTON', timestamp: 1, activationMode: 'SILENT', claimToken: 'claim' }];
  (backgroundApi.post as jest.Mock).mockResolvedValue({ data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'incident', journeySessionId: 'journey' }, notifications: { queued: 1, dispatched: false } } });
  (backgroundApi.get as jest.Mock).mockResolvedValue({ data: [{ id: 'incident', status: 'OPEN', journeySessionId: 'journey' }] });
  (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  mockNative.beginEmergencyLocationAsync.mockImplementation(async () => { mockEvents.push('location-fgs'); });
});
afterEach(async () => { mockForeground = false; await stopTracking(); });

it('cold locked Silent SOS creates the incident and starts location before any React resume', async () => {
  await runHeadlessProtectionWorker();
  expect(mockForeground).toBe(false);
  expect(backgroundApi.post).toHaveBeenCalledWith('/incident-orchestrator/activate', expect.objectContaining({ activationMode: 'SILENT', activationSource: 'LOCK_SCREEN' }));
  expect(mockEvents).toEqual(['durable', 'ack', 'location-fgs', 'capture']);
  expect(trackerDebugState()).toMatchObject({ running: true, sessionId: 'journey' });
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith('opa-background-location', expect.objectContaining({ foregroundService: undefined }));
  expect(api.post).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

it('persists each background batch before backend replay without React', async () => {
  await runHeadlessProtectionWorker();
  await captureBackgroundBatch([{ timestamp: Date.now(), coords: { latitude: 1, longitude: 2, accuracy: 3, altitude: null, altitudeAccuracy: null, speed: null, heading: null } }]);
  expect(mockEvents.slice(-2)).toEqual(['queue-write', 'replay']);
  expect(replayJourneySessionWithLease).toHaveBeenCalledWith(mockStore, 'journey', 'owner', backgroundApi);
});

it('a refused location FGS leaves a tracking obligation after exact trigger ACK and retries without activation', async () => {
  mockNative.beginEmergencyLocationAsync.mockRejectedValueOnce(new Error('FGS temporarily unavailable'));
  await runHeadlessProtectionWorker();
  expect(mockQueue).toEqual([]); expect(mockIncident).toBe('incident');
  expect(trackerDebugState().running).toBe(false);
  await runHeadlessProtectionWorker();
  expect(backgroundApi.post).toHaveBeenCalledTimes(1);
  expect(trackerDebugState().running).toBe(true);
});

it('process/background reconciliation starts from durable identity with an empty trigger FIFO', async () => {
  mockQueue = []; mockIncident = 'incident';
  await runHeadlessProtectionWorker();
  expect(backgroundApi.post).not.toHaveBeenCalled();
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});

it('a surviving registered task is adopted after process state is lost', async () => {
  mockQueue = []; mockIncident = 'incident'; mockRegistered = true;
  await reconcileEmergencyTracking();
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  expect(await SecureStore.getItemAsync('opa-background-session-id')).toBe('journey');
});

it('duplicate wakes, retrigger, and later app resume retain one incident and one capture registration', async () => {
  await runHeadlessProtectionWorker();
  await Promise.all([reconcileEmergencyTracking(), reconcileEmergencyTracking()]);
  (backgroundApi.post as jest.Mock).mockResolvedValueOnce({ data: { status: 'INCIDENT_RETRIGGERED', incident: { id: 'incident' }, notifications: { queued: 0, dispatched: false } } });
  mockQueue = [{ id: 'retrigger', type: 'SOS_BUTTON', timestamp: 2, activationMode: 'SILENT', claimToken: 'claim2' }];
  await runHeadlessProtectionWorker();
  mockForeground = true;
  await startTracking();
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(api.post).not.toHaveBeenCalled();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  expect(trackerDebugState().sessionId).toBe('journey');
});

it('resolution stops native ownership and capture without opening another session', async () => {
  await runHeadlessProtectionWorker();
  (backgroundApi.get as jest.Mock).mockResolvedValueOnce({ data: [{ id: 'incident', status: 'RESOLVED', journeySessionId: 'journey' }] });
  await reconcileEmergencyTracking();
  expect(mockIncident).toBeNull(); expect(mockRegistered).toBe(false);
  expect(await SecureStore.getItemAsync('opa-background-session-id')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('missing background permission cannot prompt or falsely report active capture', async () => {
  (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
  await runHeadlessProtectionWorker();
  expect(mockIncident).toBe('incident'); expect(trackerDebugState().running).toBe(false);
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

it('silent headless voice uses the same authoritative tracker without requesting UI', async () => {
  await activateFromVoiceTrigger({ phrase: 'HELP HELP', confidence: null, timestamp: 1, provider: 'picovoice_porcupine', activationMode: 'SILENT' }, 'headless');
  expect(mockIncident).toBe('incident');
  expect(trackerDebugState()).toMatchObject({ running: true, sessionId: 'journey' });
  expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(api.post).not.toHaveBeenCalled();
});

it('a response from an account that signed out cannot start tracking for the next account', async () => {
  (backgroundApi.post as jest.Mock).mockImplementationOnce(async () => {
    advanceAuthSessionEpoch();
    return { data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'incident', journeySessionId: 'journey' }, notifications: { queued: 0, dispatched: false } } };
  });
  await runHeadlessProtectionWorker();
  expect(mockQueue).toEqual([]);
  expect(mockIncident).toBeNull();
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
});
