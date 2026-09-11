jest.mock('./emergency-tracking', () => ({ rememberEmergencyTracking: jest.fn(), bootstrapEmergencyTracking: jest.fn(), reconcileEmergencyTracking: async () => undefined }));
import * as Location from 'expo-location';
import { PermissionsAndroid } from 'react-native';
import { backgroundApi } from './api';
import { startTracking } from './journey-tracker';
import { runHeadlessProtectionWorker } from './headless-sos-worker';
import { claimPendingOpaProtectionTrigger, acknowledgeClaimedOpaProtectionTrigger, releasePendingOpaProtectionTrigger } from '../../modules/opa-protection';

jest.mock('../../modules/opa-protection', () => ({ getNativeSosActivationMode: () => 'STANDARD', claimPendingOpaProtectionTrigger: jest.fn(), acknowledgeClaimedOpaProtectionTrigger: jest.fn(), releasePendingOpaProtectionTrigger: jest.fn() }));
jest.mock('./api', () => ({ api: { post: jest.fn() }, backgroundApi: { post: jest.fn() } }));
jest.mock('./picovoice-porcupine-provider', () => ({ PicovoicePorcupineProvider: jest.fn() }));
jest.mock('./journey-tracker', () => ({ startTracking: jest.fn() }));
jest.mock('../store/activeIncidentStore', () => ({ useActiveIncidentStore: { getState: () => ({ setActiveIncident: jest.fn() }) } }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, getForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn() }));

const voice = { id: 'voice-1', claimToken: 'voice-token', type: 'VOICE', phrase: 'HELP HELP', provider: 'picovoice_porcupine', timestamp: 1000 };
const claim = claimPendingOpaProtectionTrigger as jest.Mock;
const ack = acknowledgeClaimedOpaProtectionTrigger as jest.Mock;
const release = releasePendingOpaProtectionTrigger as jest.Mock;
const post = backgroundApi.post as jest.Mock;

describe('headless VOICE location through real worker and processors', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('denied');
    claim.mockResolvedValueOnce(voice).mockResolvedValue(null);
    ack.mockResolvedValue(true);
    release.mockResolvedValue(true);
    post.mockResolvedValue({ data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'incident-1' } } });
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 6.5, longitude: 3.3, accuracy: 8 } });
  });
  afterEach(() => {
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(PermissionsAndroid.request).not.toHaveBeenCalled();
    expect(startTracking).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
  it('uses real available location and exact ACK', async () => {
    await runHeadlessProtectionWorker();
    expect(post.mock.calls[0][1]).toMatchObject({ triggerType: 'VOICE', mode: 'IMMEDIATE', activationMode: 'STANDARD', latitude: 6.5, longitude: 3.3 });
    expect(ack).toHaveBeenCalledWith('voice-1', 'voice-token');
    expect(release).not.toHaveBeenCalled();
  });
  it.each(['denied', 'gps failure', 'permission read failure'])('activates without fabricated coordinates on %s and drains following SOS', async (failure) => {
    if (failure === 'denied') (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    if (failure === 'gps failure') (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValueOnce(new Error('no GPS'));
    if (failure === 'permission read failure') (Location.getForegroundPermissionsAsync as jest.Mock).mockRejectedValueOnce(new Error('bridge unavailable'));
    claim.mockReset().mockResolvedValueOnce(voice).mockResolvedValueOnce({ id: 'sos-2', claimToken: 'sos-token', type: 'SOS_BUTTON', timestamp: 2000 }).mockResolvedValue(null);
    await runHeadlessProtectionWorker();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1]).toMatchObject({ triggerType: 'VOICE', mode: 'IMMEDIATE', activationMode: 'STANDARD', userConfirmed: false });
    for (const field of ['latitude', 'longitude', 'accuracy']) expect(post.mock.calls[0][1]).not.toHaveProperty(field);
    expect(post.mock.calls[1][1]).toMatchObject({ triggerType: 'SOS_BUTTON', mode: 'CONFIRMATION', userConfirmed: true, latitude: 6.5, longitude: 3.3 });
    expect(ack.mock.calls).toEqual([['voice-1', 'voice-token'], ['sos-2', 'sos-token']]);
    expect(release).not.toHaveBeenCalled();
  });
  it('retains and exact-releases a locationless VOICE on actual API failure', async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    post.mockRejectedValue(new Error('network/auth failure'));
    await runHeadlessProtectionWorker();
    expect(post).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('voice-1', 'voice-token');
    expect(claim).toHaveBeenCalledTimes(1);
  });
  it('activates and exact-ACKs explicit SOS before its first location fix', async () => {
    claim.mockReset().mockResolvedValueOnce({ ...voice, type: 'SOS_BUTTON' }).mockResolvedValue(null);
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    await runHeadlessProtectionWorker();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toMatchObject({ triggerType: 'SOS_BUTTON', activationSource: 'LOCK_SCREEN', userConfirmed: true });
    expect(post.mock.calls[0][1]).not.toHaveProperty('latitude');
    expect(ack).toHaveBeenCalledWith('voice-1', 'voice-token');
    expect(release).not.toHaveBeenCalled();
  });
});
