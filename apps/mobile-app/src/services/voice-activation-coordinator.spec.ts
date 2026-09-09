jest.mock('./foreground-execution', () => ({ isForegroundExecutionAllowed: () => true }));
import { api, backgroundApi } from './api';
import {
  acquireEmergencyLocation,
  acquireEmergencyLocationWithoutPermissionRequest,
} from './emergency-location';
import { startTracking } from './journey-tracker';
import { activateFromVoiceTrigger } from './voice-activation-coordinator';

jest.mock('./api', () => ({
  backgroundApi: { post: jest.fn() },
  api: {
    post: jest.fn(),
  },
}));

jest.mock('./emergency-location', () => ({
  acquireEmergencyLocation: jest.fn(),
  acquireEmergencyLocationWithoutPermissionRequest: jest.fn(),
}));

jest.mock('./journey-tracker', () => ({
  startTracking: jest.fn(),
}));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedAcquireEmergencyLocation =
  acquireEmergencyLocation as jest.MockedFunction<
    typeof acquireEmergencyLocation
  >;
const mockedStartTracking =
  startTracking as jest.MockedFunction<typeof startTracking>;

const voiceEvent = {
  phrase: 'HELP HELP',
  confidence: null,
  timestamp: 1787682337000,
  provider: 'picovoice_porcupine' as const,
};

describe('voice-activation-coordinator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not call the API or start tracking when location is unavailable', async () => {
    mockedAcquireEmergencyLocation.mockResolvedValue({
      ok: false,
      reason: 'LOCATION_UNAVAILABLE',
    });

    await expect(
      activateFromVoiceTrigger(voiceEvent),
    ).resolves.toEqual({
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: 'LOCATION_UNAVAILABLE',
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(mockedStartTracking).not.toHaveBeenCalled();
  });

  it('activates through the existing SILENT VOICE pipeline and starts tracking', async () => {
    mockedAcquireEmergencyLocation.mockResolvedValue({
      ok: true,
      fix: {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 8,
        acquiredAt: 1787682337000,
      },
    });

    mockedApi.post.mockResolvedValue({
      data: {
        status: 'INCIDENT_ACTIVATED',
        incident: {
          id: 'incident-voice-123',
        },
      },
    });

    await expect(
      activateFromVoiceTrigger(voiceEvent),
    ).resolves.toEqual({
      status: 'INCIDENT_ACTIVATED',
      incidentId: 'incident-voice-123',
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(1);

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/incident-orchestrator/activate',
      expect.objectContaining({
        triggerType: 'VOICE',
        mode: 'SILENT',
        detectedPhrase: 'HELP HELP',
        userConfirmed: false,
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 8,
      }),
    );

    expect(mockedStartTracking).toHaveBeenCalledTimes(1);
  });

  it('does not start tracking when detection does not activate', async () => {
    mockedAcquireEmergencyLocation.mockResolvedValue({
      ok: true,
      fix: {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: null,
        acquiredAt: 1787682337000,
      },
    });

    mockedApi.post.mockResolvedValue({
      data: {
        status: 'NOT_ACTIVATED',
        incident: null,
      },
    });

    await expect(
      activateFromVoiceTrigger(voiceEvent),
    ).resolves.toEqual({
      status: 'NOT_ACTIVATED',
    });

    expect(mockedStartTracking).not.toHaveBeenCalled();
  });

  it('does not invent confirmation when the backend requires confirmation', async () => {
    mockedAcquireEmergencyLocation.mockResolvedValue({
      ok: true,
      fix: {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 10,
        acquiredAt: 1787682337000,
      },
    });

    mockedApi.post.mockResolvedValue({
      data: {
        status: 'CONFIRMATION_REQUIRED',
        incident: null,
      },
    });

    await expect(
      activateFromVoiceTrigger(voiceEvent),
    ).resolves.toEqual({
      status: 'CONFIRMATION_REQUIRED',
    });

    expect(mockedStartTracking).not.toHaveBeenCalled();

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/incident-orchestrator/activate',
      expect.objectContaining({
        userConfirmed: false,
      }),
    );
  });

  it('preserves an existing OPEN incident retrigger and ensures tracking remains active', async () => {
    mockedAcquireEmergencyLocation.mockResolvedValue({
      ok: true,
      fix: {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 8,
        acquiredAt: 1787682337000,
      },
    });

    mockedApi.post.mockResolvedValue({
      data: {
        status: 'INCIDENT_RETRIGGERED',
        incident: {
          id: 'incident-voice-existing',
        },
        retriggerCount: 2,
        notifications: {
          queued: 0,
          dispatched: false,
        },
      },
    });

    await expect(
      activateFromVoiceTrigger(voiceEvent),
    ).resolves.toEqual({
      status: 'INCIDENT_RETRIGGERED',
      incidentId: 'incident-voice-existing',
      notifications: {
        queued: 0,
        dispatched: false,
      },
    });

    expect(mockedStartTracking).toHaveBeenCalledTimes(1);
  });
});


describe('headless voice activation', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each(['INCIDENT_ACTIVATED', 'INCIDENT_RETRIGGERED', 'CONFIRMATION_REQUIRED', 'NOT_ACTIVATED'])(
    'preserves %s VOICE semantics without interactive location or tracking', async (status) => {
      (acquireEmergencyLocationWithoutPermissionRequest as jest.Mock).mockResolvedValue({
        ok: true, fix: { latitude: 6.5, longitude: 3.3, accuracy: 8, acquiredAt: Date.now() },
      });
      (backgroundApi.post as jest.Mock).mockResolvedValue({ data: { status, incident: { id: 'voice-incident' } } });
      await expect(activateFromVoiceTrigger(voiceEvent, 'headless')).resolves.toMatchObject({ status });
      expect(backgroundApi.post).toHaveBeenCalledTimes(1);
      expect(backgroundApi.post).toHaveBeenCalledWith('/incident-orchestrator/activate', {
        triggerType: 'VOICE', mode: 'SILENT', detectedPhrase: 'HELP HELP', language: 'en-NG',
        voiceConfidence: undefined, repetitionCount: 1, userConfirmed: false,
        latitude: 6.5, longitude: 3.3, accuracy: 8, timestamp: new Date(voiceEvent.timestamp).toISOString(),
      });
      expect(acquireEmergencyLocation).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
      expect(startTracking).not.toHaveBeenCalled();
    },
  );

  it('activates without coordinates when permission-free location is unavailable', async () => {
    (acquireEmergencyLocationWithoutPermissionRequest as jest.Mock).mockResolvedValue({ ok: false, reason: 'PERMISSION_DENIED' });
    (backgroundApi.post as jest.Mock).mockResolvedValue({ data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'locationless' } } });
    await expect(activateFromVoiceTrigger(voiceEvent, 'headless')).resolves.toMatchObject({ status: 'INCIDENT_ACTIVATED' });
    expect(acquireEmergencyLocation).not.toHaveBeenCalled();
    const payload = (backgroundApi.post as jest.Mock).mock.calls[0][1];
    expect(payload).not.toHaveProperty('latitude');
    expect(payload).not.toHaveProperty('longitude');
    expect(payload).not.toHaveProperty('accuracy');
    expect(startTracking).not.toHaveBeenCalled();
  });
});
