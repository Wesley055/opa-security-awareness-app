jest.mock('./emergency-tracking', () => ({ rememberEmergencyTracking: jest.fn(), reconcileEmergencyTracking: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./safewalk', () => ({ startSafeWalkReconciliation: jest.fn(() => jest.fn()), useSafeWalk: (select: (state: { journey: null }) => unknown) => select({ journey: null }) }));
/** Set OPA_TEST_FROZEN_VC19=1 to execute the shipped vc19 modules from Git in memory.
 * This keeps the candidate production edits untouched and tests the physical-release baseline.
 * Native persistence/order and real claim concurrency are covered by ProtectionExecutionBoundaryTest
 * and ProtectionPendingTriggerClaimPolicyTest; JS mocks model only the native bridge contract.
 */
function mockFrozen(relative: string) {
  const path = jest.requireActual('path');
  const ts = jest.requireActual('typescript');
  const filename = path.resolve(__dirname, '../..', relative);
  const source = jest.requireActual('child_process').execFileSync('git', [
    '-c', 'safe.directory=C:/Projects/OPA-notif-02', 'show',
    `0fff37ab815f83abe449bf079441f9a4321c3745:apps/mobile-app/${relative}`,
  ], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2019, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Frozen module evaluation must resolve the test registry, including mocks.
  const localRequire = (name: string) => require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name);
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}
jest.mock('../../app/_layout', () => process.env.OPA_TEST_FROZEN_VC19 === '1' ? mockFrozen('app/_layout.tsx') : jest.requireActual('../../app/_layout'));
jest.mock('./headless-sos-worker', () => process.env.OPA_TEST_FROZEN_VC19 === '1' ? mockFrozen('src/services/headless-sos-worker.ts') : jest.requireActual('./headless-sos-worker'));
jest.mock('./voice-protection-service', () => process.env.OPA_TEST_FROZEN_VC19 === '1' ? mockFrozen('src/services/voice-protection-service.ts') : jest.requireActual('./voice-protection-service'));
jest.mock('./lock-screen-sos', () => process.env.OPA_TEST_FROZEN_VC19 === '1' ? mockFrozen('src/services/lock-screen-sos.ts') : jest.requireActual('./lock-screen-sos'));
jest.mock('./voice-activation-coordinator', () => process.env.OPA_TEST_FROZEN_VC19 === '1' ? mockFrozen('src/services/voice-activation-coordinator.ts') : jest.requireActual('./voice-activation-coordinator'));
jest.mock('./sos-activation-coordinator', () => process.env.OPA_TEST_FROZEN_VC19 === '1' ? mockFrozen('src/services/sos-activation-coordinator.ts') : jest.requireActual('./sos-activation-coordinator'));
jest.mock('./emergency-location', () => process.env.OPA_TEST_FROZEN_VC19 === '1' ? mockFrozen('src/services/emergency-location.ts') : jest.requireActual('./emergency-location'));
import { useEffect } from 'react';
import { AppState, PermissionsAndroid } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import RootLayout from '../../app/_layout';
import { backgroundApi, api } from './api';
import { runHeadlessProtectionWorker } from './headless-sos-worker';
import { startTracking } from './journey-tracker';
import { ensureVoiceProtectionMicrophonePermission, processVoiceTrigger } from './voice-protection-service';
import { ensureProtectionNotificationPermission } from './lock-screen-sos';
import * as native from '../../modules/opa-protection';
jest.mock('react', () => ({ ...jest.requireActual('react'), useEffect: jest.fn(), useRef: (v: unknown) => ({ current: v }), useState: (v: unknown) => [v, jest.fn()] }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { currentState: 'background', addEventListener: jest.fn(() => ({ remove: jest.fn() })) }, PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: 'audio' }, RESULTS: { GRANTED: 'granted' }, check: jest.fn(), request: jest.fn() } }));
jest.mock('expo-router', () => ({ Stack: Object.assign(() => null, { Screen: () => null }), useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useSegments: () => [] }));
jest.mock('expo-notifications', () => ({ IosAuthorizationStatus: { PROVISIONAL: 3 }, addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })), getLastNotificationResponseAsync: jest.fn(), getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn() }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, getForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn() }));
jest.mock('../../modules/opa-protection', () => ({ getNativeSosActivationMode: () => 'STANDARD', claimPendingOpaProtectionTrigger: jest.fn(), releasePendingOpaProtectionTrigger: jest.fn(), acknowledgeClaimedOpaProtectionTrigger: jest.fn(), addOpaVoiceTriggerListener: jest.fn(() => ({ remove: jest.fn() })), configureOpaVoiceProvider: jest.fn(), startOpaProtectionService: jest.fn(), stopOpaProtectionService: jest.fn(), isOpaForegroundEligible: jest.fn() }));
jest.mock('../store/authStore', () => ({ useAuthStore: () => ({ isAuthenticated: true, isLoading: false, checkAuth: jest.fn() }) }));
jest.mock('../store/activeIncidentStore', () => ({ useActiveIncidentStore: Object.assign((select: (state: { activeIncident: null }) => unknown) => select({ activeIncident: null }), { getState: () => ({ setActiveIncident: jest.fn() }) }) }));
jest.mock('./active-incident-reconciliation', () => ({ startActiveIncidentReconciliation: () => jest.fn() }));
jest.mock('./picovoice-porcupine-provider', () => ({ PicovoicePorcupineProvider: jest.fn() }));
jest.mock('./journey-tracker', () => ({ startTracking: jest.fn(), stopTracking: jest.fn() }));
jest.mock('./api', () => ({ api: { post: jest.fn() }, backgroundApi: { post: jest.fn() } }));
const voice = { id: 'voice', type: 'VOICE', timestamp: 1000, provider: 'picovoice_porcupine', phrase: 'HELP HELP' };
const sos = { id: 'sos', type: 'SOS_BUTTON', timestamp: 2000 };
let queue: (typeof voice | typeof sos)[], owner: ((typeof voice | typeof sos) & { claimToken: string }) | null, token: number, cleanups: (() => void)[];
let successfulOwners: string[], interactiveAllowed: boolean;
const claim = native.claimPendingOpaProtectionTrigger as jest.Mock;
const ack = native.acknowledgeClaimedOpaProtectionTrigger as jest.Mock;
const release = native.releasePendingOpaProtectionTrigger as jest.Mock;
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function mountRoot() {
  RootLayout();
  for (const [effect] of (useEffect as jest.Mock).mock.calls) {
    const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
}
beforeEach(() => {
  jest.clearAllMocks(); queue = []; owner = null; token = 0; cleanups = [];
  successfulOwners = []; interactiveAllowed = false;
  AppState.currentState = 'background';
  (native.isOpaForegroundEligible as jest.Mock).mockReturnValue(false);
  (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
  (PermissionsAndroid.request as jest.Mock).mockResolvedValue('denied');
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (api.post as jest.Mock).mockResolvedValue({ data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'incident' }, notifications: { queued: 2, dispatched: false } } });
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 6.5, longitude: 3.3, accuracy: 8 } });
  (backgroundApi.post as jest.Mock).mockResolvedValue({ data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'incident' }, notifications: { queued: 2, dispatched: false } } });
  claim.mockImplementation(async (ownerId) => {
    if (owner || !queue.length) return null;
    successfulOwners.push(ownerId);
    owner = { ...queue[0]!, claimToken: `token-${++token}` }; return owner;
  });
  ack.mockImplementation(async (id, t) => {
    if (!owner || owner.id !== id || owner.claimToken !== t || queue[0]?.id !== id) return false;
    queue.shift(); owner = null; return true;
  });
  release.mockImplementation(async (id, t) => {
    if (!owner || owner.id !== id || owner.claimToken !== t) return false;
    owner = null; return true;
  });
});
afterEach(() => {
  cleanups.forEach(c => c());
  if (!interactiveAllowed) {
    expect({
      microphonePermissionRequests: (PermissionsAndroid.request as jest.Mock).mock.calls.length,
      notificationPermissionRequests: (Notifications.requestPermissionsAsync as jest.Mock).mock.calls.length,
      locationPermissionRequests: (Location.requestForegroundPermissionsAsync as jest.Mock).mock.calls.length,
      backgroundPermissionRequests: (Location.requestBackgroundPermissionsAsync as jest.Mock).mock.calls.length,
      trackingBootstraps: (startTracking as jest.Mock).mock.calls.length,
      interactiveActivations: (api.post as jest.Mock).mock.calls.length,
    }).toEqual({ microphonePermissionRequests: 0, notificationPermissionRequests: 0,
      locationPermissionRequests: 0, backgroundPermissionRequests: 0,
      trackingBootstraps: 0, interactiveActivations: 0 });
  }
});
it.each([voice, sos])('locked $type completes and exact ACKs without React', async trigger => {
  queue = [trigger]; await runHeadlessProtectionWorker();
  expect(backgroundApi.post).toHaveBeenCalledTimes(1);
  expect((backgroundApi.post as jest.Mock).mock.calls[0][1].triggerType).toBe(trigger.type);
  expect(ack).toHaveBeenCalledWith(trigger.id, 'token-1'); expect(queue).toEqual([]);
  expect(AppState.currentState).toBe('background');
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith(expect.objectContaining({ mayShowUserSettingsDialog: false }));
});
it.each([voice, sos].flatMap(trigger => [true, false].map(reactFirst => ({ trigger, reactFirst }))))('mounted background React race $trigger.type React-first=$reactFirst never uses interactive activation', async ({ trigger, reactFirst }) => {
  queue = [trigger];
  if (reactFirst) mountRoot();
  const headless = runHeadlessProtectionWorker();
  if (!reactFirst) mountRoot();
  (native.addOpaVoiceTriggerListener as jest.Mock).mock.calls[0][0](trigger);
  await headless; await settle();
  expect(backgroundApi.post).toHaveBeenCalledTimes(1); expect(ack).toHaveBeenCalledTimes(1);
  expect(successfulOwners).toEqual([reactFirst ? 'foreground-react' : 'headless-protection']);
  expect(queue).toEqual([]);
});
it('active React with locked keyguard cannot request microphone/notification UI', async () => {
  AppState.currentState = 'active'; mountRoot(); await settle();
  await ensureVoiceProtectionMicrophonePermission(); await ensureProtectionNotificationPermission();
  expect(native.configureOpaVoiceProvider).not.toHaveBeenCalled();
  expect(native.startOpaProtectionService).not.toHaveBeenCalled();
});
it.each([voice, sos])('$type failure exact-releases and retains FIFO head', async trigger => {
  queue = [trigger, { ...voice, id: 'following' }];
  (backgroundApi.post as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await runHeadlessProtectionWorker();
  expect(release).toHaveBeenCalledWith(trigger.id, 'token-1'); expect(ack).not.toHaveBeenCalled();
  expect(queue).toHaveLength(2); expect(queue[0].id).toBe(trigger.id);
});
it.each([[voice, sos], [sos, voice]])('mixed FIFO preserves native order under repeated wakes: %j', async (first, second) => {
  queue = [first, second];
  await Promise.all([runHeadlessProtectionWorker(), runHeadlessProtectionWorker()]);
  expect(ack.mock.calls).toEqual([[first.id, 'token-1'], [second.id, 'token-2']]); expect(queue).toEqual([]);
});

it.each([voice, sos])('an ALREADY_PRESENT-style duplicate wake for $type cannot duplicate activation', async trigger => {
  queue = [trigger];
  const first = runHeadlessProtectionWorker();
  await runHeadlessProtectionWorker(); await first;
  await runHeadlessProtectionWorker();
  expect(backgroundApi.post).toHaveBeenCalledTimes(1);
  expect(ack).toHaveBeenCalledTimes(1); expect(queue).toEqual([]);
});

it.each([voice, sos])('React-owned $type cannot be processed twice by a later headless wake', async trigger => {
  queue = [trigger];
  const held = await native.claimPendingOpaProtectionTrigger('foreground-react');
  await runHeadlessProtectionWorker();
  expect(backgroundApi.post).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled();
  expect(successfulOwners).toEqual(['foreground-react']); expect(queue).toEqual([trigger]);
  expect(await native.releasePendingOpaProtectionTrigger(trigger.id, held!.claimToken)).toBe(true);
});
it.each([voice, sos])('headless-owned $type cannot be stolen by a React claim', async trigger => {
  queue = [trigger];
  const held = await native.claimPendingOpaProtectionTrigger('headless-protection');
  expect(await native.claimPendingOpaProtectionTrigger('foreground-react')).toBeNull();
  expect(successfulOwners).toEqual(['headless-protection']);
  expect(await native.acknowledgeClaimedOpaProtectionTrigger(trigger.id, held!.claimToken)).toBe(true);
});
it('foreground VOICE retains VOICE/SILENT activation and foreground tracking semantics', async () => {
  interactiveAllowed = true; AppState.currentState = 'active';
  (native.isOpaForegroundEligible as jest.Mock).mockReturnValue(true);
  await expect(processVoiceTrigger({ phrase: 'HELP HELP', provider: 'picovoice_porcupine', timestamp: 1000, confidence: null })).resolves.toBe('ACK');
  expect(api.post).toHaveBeenCalledWith('/incident-orchestrator/activate', expect.objectContaining({ triggerType: 'VOICE', mode: 'IMMEDIATE', activationMode: 'STANDARD' }));
  expect(startTracking).toHaveBeenCalledTimes(1); expect(backgroundApi.post).not.toHaveBeenCalled();
});
it('stale exact ACK cannot delete a reclaimed trigger', async () => {
  queue = [voice];
  const first = await native.claimPendingOpaProtectionTrigger('headless-protection');
  await native.releasePendingOpaProtectionTrigger(voice.id, first!.claimToken);
  const next = await native.claimPendingOpaProtectionTrigger('headless-protection');
  expect(await native.acknowledgeClaimedOpaProtectionTrigger(voice.id, first!.claimToken)).toBe(false);
  expect(queue).toEqual([voice]);
  expect(await native.acknowledgeClaimedOpaProtectionTrigger(voice.id, next!.claimToken)).toBe(true);
});

it.each([voice, sos].flatMap(trigger => ['foreground-react', 'headless-protection'].map(ownerId => ({ trigger, ownerId }))))('unlocked $ownerId-owned $trigger.type preserves interactive semantics', async ({ trigger, ownerId }) => {
  interactiveAllowed = true; AppState.currentState = 'active';
  (native.isOpaForegroundEligible as jest.Mock).mockReturnValue(true);
  queue = [trigger];
  await runHeadlessProtectionWorker(ownerId as 'foreground-react' | 'headless-protection');
  expect(api.post).toHaveBeenCalledTimes(1);
  expect((api.post as jest.Mock).mock.calls[0][1].triggerType).toBe(trigger.type);
  expect(startTracking).toHaveBeenCalledTimes(1);
  expect(backgroundApi.post).not.toHaveBeenCalled();
  expect(ack).toHaveBeenCalledWith(trigger.id, 'token-1');
  expect(successfulOwners).toEqual([ownerId]);
});
it.each([voice, sos])('$type activation finishing after lock exact-ACKs without tracking', async trigger => {
  interactiveAllowed = true; AppState.currentState = 'active';
  (native.isOpaForegroundEligible as jest.Mock).mockReturnValue(true);
  (api.post as jest.Mock).mockImplementationOnce(async () => {
    AppState.currentState = 'background';
    (native.isOpaForegroundEligible as jest.Mock).mockReturnValue(false);
    return { data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'incident' }, notifications: { queued: 2, dispatched: false } } };
  });
  queue = [trigger]; await runHeadlessProtectionWorker('foreground-react');
  expect(ack).toHaveBeenCalledWith(trigger.id, 'token-1');
  expect(startTracking).not.toHaveBeenCalled(); expect(queue).toEqual([]);
});
it('React-owned locationless VOICE ACKs and unblocks the following SOS', async () => {
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
  queue = [voice, sos]; await runHeadlessProtectionWorker('foreground-react');
  const payloads = (backgroundApi.post as jest.Mock).mock.calls.map(call => call[1]);
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).not.toHaveProperty('latitude');
  expect(payloads[0]).not.toHaveProperty('longitude');
  expect(payloads.map(p => p.triggerType)).toEqual(['VOICE', 'SOS_BUTTON']);
  expect(ack.mock.calls).toEqual([['voice', 'token-1'], ['sos', 'token-2']]);
});
it('an interactive location caller that is already locked cannot open permission UI', async () => {
  await jest.requireMock('./emergency-location').acquireEmergencyLocation();
  expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});
