import { Platform } from 'react-native';
import { getSosActivationMode, setSosActivationMode, incidentPresentationMode, SILENT_SOS_NOTICE } from './silent-sos';
import { activateFromSosTrigger } from './sos-activation-coordinator';
import { activateFromHeadlessSosTrigger } from './headless-sos-activation';
import { activateFromVoiceTrigger } from './voice-activation-coordinator';
import { api, backgroundApi } from './api';
import { startTracking } from './journey-tracker';
jest.mock('../../modules/opa-protection', () => ({ getNativeSosActivationMode: jest.fn(() => 'STANDARD'), setNativeSosActivationMode: jest.fn() }));
jest.mock('./api', () => ({ api: { post: jest.fn() }, backgroundApi: { post: jest.fn() } }));
jest.mock('./foreground-execution', () => ({ isForegroundExecutionAllowed: () => true }));
jest.mock('./journey-tracker', () => ({ startTracking: jest.fn() }));
jest.mock('./emergency-location', () => ({
  acquireEmergencyLocation: jest.fn(async () => ({ ok: true, fix: { latitude: 10, longitude: 20, accuracy: 4 } })),
  acquireEmergencyLocationWithoutPermissionRequest: jest.fn(async () => ({ ok: true, fix: { latitude: 10, longitude: 20, accuracy: 4 } })),
}));
const response = { data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'same-open-incident' }, notifications: { queued: 2, dispatched: false } } };
beforeEach(() => {
  jest.clearAllMocks();
  (api.post as jest.Mock).mockResolvedValue(response);
  (backgroundApi.post as jest.Mock).mockResolvedValue(response);
});
it.each(['STANDARD', 'SILENT'] as const)('explicit and headless SOS preserve lifecycle and location in %s', async mode => {
  const foreground = await activateFromSosTrigger(mode);
  const headless = await activateFromHeadlessSosTrigger(mode);
  for (const result of [foreground, headless]) expect(result).toMatchObject({ status: 'INCIDENT_ACTIVATED', incidentId: 'same-open-incident', activationMode: mode, notifications: { queued: 2 } });
  for (const client of [api, backgroundApi]) expect(client.post).toHaveBeenCalledWith('/incident-orchestrator/activate', expect.objectContaining({ triggerType: 'SOS_BUTTON', activationMode: mode, activationSource: 'LOCK_SCREEN', latitude: 10, longitude: 20 }));
  expect(startTracking).toHaveBeenCalledTimes(1);
});
it.each(['STANDARD', 'SILENT'] as const)('voice recognition is independent of %s presentation', async mode => {
  const result = await activateFromVoiceTrigger({ activationMode: mode, phrase: 'HELP HELP', confidence: null, timestamp: 1, provider: 'picovoice_porcupine' }, 'headless');
  expect(result.activationMode).toBe(mode);
  expect(backgroundApi.post).toHaveBeenCalledWith('/incident-orchestrator/activate', expect.objectContaining({ triggerType: 'VOICE', mode: 'IMMEDIATE', activationMode: mode, userConfirmed: false }));
  expect(startTracking).not.toHaveBeenCalled();
});
it('reconciles the incident mode independently of a changed device preference', () => {
  expect(incidentPresentationMode({ metadata: { activationMode: 'SILENT' } }, 'STANDARD')).toBe('SILENT');
  expect(incidentPresentationMode({ metadata: { activationMode: 'STANDARD', presentationMode: 'SILENT' } })).toBe('SILENT');
  expect(incidentPresentationMode({ metadata: { activationMode: 'INVALID' } })).toBe('STANDARD');
});
it('explains required indicators and never promises invisibility', () => {
  expect(SILENT_SOS_NOTICE).toContain('indicators remain visible');
  expect(SILENT_SOS_NOTICE).toContain('other apps may still make sound');
});
it('requires an explicit supported device action to save consent', async () => {
  if (Platform.OS !== 'android') {
    expect(getSosActivationMode()).toBe('STANDARD');
    await expect(setSosActivationMode('SILENT')).rejects.toThrow('Android');
  }
});
