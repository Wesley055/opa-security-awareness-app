import {
  processOpaProtectionTrigger,
  type OpaProtectionTrigger,
} from './opa-protection-trigger-processor';

const processVoiceTrigger = jest.fn();
const processSosTrigger = jest.fn();
const acknowledge = jest.fn();

const voiceTrigger: OpaProtectionTrigger = {
  id: 'voice-1',
  type: 'VOICE',
  timestamp: 1787682337000,
  phrase: 'HELP HELP',
  provider: 'picovoice_porcupine',
};

const sosTrigger: OpaProtectionTrigger = {
  id: 'sos-1',
  type: 'SOS_BUTTON',
  timestamp: 1787682337001,
};

describe('opa-protection-trigger-processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches SOS_BUTTON without voice-only phrase or provider fields', async () => {
    processSosTrigger.mockResolvedValue('ACK');
    acknowledge.mockResolvedValue(true);

    await expect(
      processOpaProtectionTrigger(sosTrigger, {
        processVoiceTrigger,
        processSosTrigger,
        acknowledge,
      }),
    ).resolves.toBe('ACK');

    expect(processSosTrigger).toHaveBeenCalledWith(sosTrigger);
    expect(processVoiceTrigger).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith('sos-1');
  });

  it('preserves SOS_BUTTON with a zero timestamp without dispatching it', async () => {
    const invalidSosTrigger: OpaProtectionTrigger = {
      ...sosTrigger,
      timestamp: 0,
    };

    await expect(
      processOpaProtectionTrigger(invalidSosTrigger, {
        processVoiceTrigger,
        processSosTrigger,
        acknowledge,
      }),
    ).resolves.toBe('RETRY');

    expect(processSosTrigger).not.toHaveBeenCalled();
    expect(processVoiceTrigger).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('preserves SOS_BUTTON with a non-finite timestamp without dispatching it', async () => {
    const invalidSosTrigger: OpaProtectionTrigger = {
      ...sosTrigger,
      timestamp: Number.NaN,
    };

    await expect(
      processOpaProtectionTrigger(invalidSosTrigger, {
        processVoiceTrigger,
        processSosTrigger,
        acknowledge,
      }),
    ).resolves.toBe('RETRY');

    expect(processSosTrigger).not.toHaveBeenCalled();
    expect(processVoiceTrigger).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('preserves SOS_BUTTON when processing requires retry', async () => {
    processSosTrigger.mockResolvedValue('RETRY');

    await expect(
      processOpaProtectionTrigger(sosTrigger, {
        processVoiceTrigger,
        processSosTrigger,
        acknowledge,
      }),
    ).resolves.toBe('RETRY');

    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('preserves the durable record when terminal acknowledgement fails', async () => {
    processSosTrigger.mockResolvedValue('ACK');
    acknowledge.mockResolvedValue(false);

    await expect(
      processOpaProtectionTrigger(sosTrigger, {
        processVoiceTrigger,
        processSosTrigger,
        acknowledge,
      }),
    ).resolves.toBe('RETRY');

    expect(acknowledge).toHaveBeenCalledWith('sos-1');
  });

  it('preserves existing VOICE dispatch behavior', async () => {
    processVoiceTrigger.mockResolvedValue('ACK');
    acknowledge.mockResolvedValue(true);

    await expect(
      processOpaProtectionTrigger(voiceTrigger, {
        processVoiceTrigger,
        processSosTrigger,
        acknowledge,
      }),
    ).resolves.toBe('ACK');

    expect(processVoiceTrigger).toHaveBeenCalledWith({
      phrase: 'HELP HELP',
      confidence: null,
      timestamp: 1787682337000,
      provider: 'picovoice_porcupine',
    });

    expect(processSosTrigger).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith('voice-1');
  });
});