const readyConfig = {
  enabled: true,
  provider: 'picovoice_porcupine' as const,
  phrase: 'HELP HELP',
  accessKey: 'test-access-key',
  keywordPath: 'help-help_en_android_v4_0_0.ppn',
  sensitivity: 0.5,
};

describe('voice-protection-service', () => {
  function loadService(options?: { ready?: boolean; permission?: 'granted' | 'denied' }) {
    jest.resetModules();

    let running = false;
    let trigger: ((event: any) => void | Promise<void>) | undefined;

    const start = jest.fn(async (handler) => {
      trigger = handler;
      running = true;
    });
    const stop = jest.fn(async () => { running = false; });
    const isRunning = jest.fn(() => running);
    const activate = jest.fn().mockResolvedValue({
      status: 'INCIDENT_ACTIVATED',
      incidentId: 'incident-1',
      notifications: { queued: 6, dispatched: true },
    });
    const setActiveIncident = jest.fn();
    const Provider = jest.fn().mockImplementation(() => ({
      id: 'picovoice_porcupine',
      start,
      stop,
      isRunning,
    }));

    const permission = options?.permission ?? 'granted';
    const check = jest.fn().mockResolvedValue(permission === 'granted');
    const request = jest.fn().mockResolvedValue(permission);

    jest.doMock('react-native', () => ({
      Platform: { OS: 'android' },
      PermissionsAndroid: {
        PERMISSIONS: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' },
        RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
        check,
        request,
      },
    }));
    jest.doMock('./picovoice-porcupine-provider', () => ({
      PicovoicePorcupineProvider: Provider,
    }));
    jest.doMock('./voice-activation-coordinator', () => ({
      activateFromVoiceTrigger: activate,
    }));
    jest.doMock('./voice-protection-config', () => ({
      getVoiceProtectionConfig: jest.fn(() => readyConfig),
      isVoiceProtectionReady: jest.fn(() => options?.ready !== false),
    }));
    jest.doMock('../store/activeIncidentStore', () => ({
      useActiveIncidentStore: {
        getState: () => ({ setActiveIncident }),
      },
    }));

    const service =
      require('./voice-protection-service') as
        typeof import('./voice-protection-service');

    return {
      service,
      Provider,
      start,
      stop,
      activate,
      setActiveIncident,
      check,
      request,
      getTrigger: () => trigger,
    };
  }

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('does not create a provider when protection is not ready', async () => {
    const { service, Provider } = loadService({ ready: false });
    await service.startVoiceProtection();
    expect(Provider).not.toHaveBeenCalled();
  });

  it('starts without requesting permission when microphone is already granted', async () => {
    const { service, check, request, start } = loadService();
    await service.startVoiceProtection();
    expect(check).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('requests microphone permission when it is not already granted', async () => {
    const { service, check, request, start } = loadService({ permission: 'denied' });
    request.mockResolvedValueOnce('granted');
    await service.startVoiceProtection();
    expect(check).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not start when microphone permission is denied', async () => {
    const { service, request, start } = loadService({ permission: 'denied' });
    await service.startVoiceProtection();
    expect(request).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('creates one provider and starts it idempotently', async () => {
    const { service, Provider, start } = loadService();
    await service.startVoiceProtection();
    await service.startVoiceProtection();
    expect(Provider).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('delegates a detected keyword and publishes the active incident', async () => {
    const { service, activate, setActiveIncident, getTrigger } = loadService();
    await service.startVoiceProtection();
    const trigger = getTrigger();
    expect(trigger).toBeDefined();
    const event = {
      phrase: 'HELP HELP',
      confidence: null,
      timestamp: 123,
      provider: 'picovoice_porcupine' as const,
    };
    await trigger?.(event);
    expect(activate).toHaveBeenCalledWith(event);
    expect(setActiveIncident).toHaveBeenCalledWith({
      id: 'incident-1',
      status: 'OPEN',
      notifications: { queued: 6, dispatched: true },
    });
  });

  it('stops and releases the active provider idempotently', async () => {
    const { service, stop } = loadService();
    await service.startVoiceProtection();
    await service.stopVoiceProtection();
    await service.stopVoiceProtection();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
