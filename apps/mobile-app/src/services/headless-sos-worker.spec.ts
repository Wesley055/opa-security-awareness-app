import { processVoiceTrigger } from './voice-protection-service';
import {
  acknowledgeClaimedOpaProtectionTrigger,
  claimPendingOpaProtectionTrigger,
  releasePendingOpaProtectionTrigger,
} from '../../modules/opa-protection';
import { activateFromHeadlessSosTrigger } from './headless-sos-activation';
import { runHeadlessProtectionWorker } from './headless-sos-worker';

jest.mock('../../modules/opa-protection', () => ({
  claimPendingOpaProtectionTrigger: jest.fn(),
  releasePendingOpaProtectionTrigger: jest.fn(),
  acknowledgeClaimedOpaProtectionTrigger: jest.fn(),
}));

jest.mock('./voice-protection-service', () => ({ processVoiceTrigger: jest.fn() }));

jest.mock('./headless-sos-activation', () => ({
  activateFromHeadlessSosTrigger: jest.fn(),
}));

const claimPending =
  claimPendingOpaProtectionTrigger as jest.MockedFunction<
    typeof claimPendingOpaProtectionTrigger
  >;

const releasePending =
  releasePendingOpaProtectionTrigger as jest.MockedFunction<
    typeof releasePendingOpaProtectionTrigger
  >;

const acknowledgeClaimed =
  acknowledgeClaimedOpaProtectionTrigger as jest.MockedFunction<
    typeof acknowledgeClaimedOpaProtectionTrigger
  >;

const activateHeadless =
  activateFromHeadlessSosTrigger as jest.MockedFunction<
    typeof activateFromHeadlessSosTrigger
  >;

describe('headless-sos-worker', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('does nothing when the durable queue is empty', async () => {
    claimPending.mockResolvedValue(null);

    await runHeadlessProtectionWorker();

    expect(claimPending).toHaveBeenCalledWith('headless-protection');
    expect(activateHeadless).not.toHaveBeenCalled();
    expect(acknowledgeClaimed).not.toHaveBeenCalled();
    expect(releasePending).not.toHaveBeenCalled();
  });

  it('releases a retrying VOICE head without bypassing it', async () => {
    claimPending.mockResolvedValue({
      id: 'voice-1',
      type: 'VOICE',
      timestamp: 1000,
      phrase: 'HELP HELP',
      provider: 'picovoice_porcupine',
      claimToken: 'claim-voice',
    });

    (processVoiceTrigger as jest.Mock).mockResolvedValue('RETRY');
    releasePending.mockResolvedValue(true);

    await runHeadlessProtectionWorker();

    expect(activateHeadless).not.toHaveBeenCalled();
    expect(acknowledgeClaimed).not.toHaveBeenCalled();

    expect(releasePending).toHaveBeenCalledWith(
      'voice-1',
      'claim-voice',
    );

    expect(claimPending).toHaveBeenCalledTimes(1);
  });

  it('releases the exact SOS claim when activation must retry', async () => {
    claimPending.mockResolvedValue({
      id: 'sos-1',
      type: 'SOS_BUTTON',
      timestamp: 1000,
      claimToken: 'claim-sos-1',
    });

    activateHeadless.mockResolvedValue({
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: 'LOCATION_UNAVAILABLE',
    });

    releasePending.mockResolvedValue(true);

    await runHeadlessProtectionWorker();

    expect(acknowledgeClaimed).not.toHaveBeenCalled();

    expect(releasePending).toHaveBeenCalledWith(
      'sos-1',
      'claim-sos-1',
    );

    expect(claimPending).toHaveBeenCalledTimes(1);
  });

  it('ACKs exact claim after INCIDENT_ACTIVATED and continues FIFO drain', async () => {
    claimPending
      .mockResolvedValueOnce({
        id: 'sos-1',
        type: 'SOS_BUTTON',
        timestamp: 1000,
        claimToken: 'claim-sos-1',
      })
      .mockResolvedValueOnce(null);

    activateHeadless.mockResolvedValue({
      status: 'INCIDENT_ACTIVATED',
      incidentId: 'incident-1',
      notifications: {
        queued: 1,
        dispatched: true,
      },
    });

    acknowledgeClaimed.mockResolvedValue(true);

    await runHeadlessProtectionWorker();

    expect(acknowledgeClaimed).toHaveBeenCalledWith(
      'sos-1',
      'claim-sos-1',
    );

    expect(releasePending).not.toHaveBeenCalled();
    expect(claimPending).toHaveBeenCalledTimes(2);
  });

  it('ACKs INCIDENT_RETRIGGERED as terminal success', async () => {
    claimPending
      .mockResolvedValueOnce({
        id: 'sos-2',
        type: 'SOS_BUTTON',
        timestamp: 2000,
        claimToken: 'claim-sos-2',
      })
      .mockResolvedValueOnce(null);

    activateHeadless.mockResolvedValue({
      status: 'INCIDENT_RETRIGGERED',
      incidentId: 'incident-open',
      notifications: {
        queued: 0,
        dispatched: false,
      },
    });

    acknowledgeClaimed.mockResolvedValue(true);

    await runHeadlessProtectionWorker();

    expect(acknowledgeClaimed).toHaveBeenCalledWith(
      'sos-2',
      'claim-sos-2',
    );

    expect(releasePending).not.toHaveBeenCalled();
  });

  it('releases and stops when exact ACK fails', async () => {
    claimPending.mockResolvedValue({
      id: 'sos-3',
      type: 'SOS_BUTTON',
      timestamp: 3000,
      claimToken: 'claim-sos-3',
    });

    activateHeadless.mockResolvedValue({
      status: 'INCIDENT_ACTIVATED',
      incidentId: 'incident-3',
      notifications: {
        queued: 1,
        dispatched: true,
      },
    });

    acknowledgeClaimed.mockResolvedValue(false);
    releasePending.mockResolvedValue(true);

    await runHeadlessProtectionWorker();

    expect(acknowledgeClaimed).toHaveBeenCalledWith(
      'sos-3',
      'claim-sos-3',
    );

    expect(releasePending).toHaveBeenCalledWith(
      'sos-3',
      'claim-sos-3',
    );

    expect(claimPending).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when activation throws', async () => {
    claimPending.mockResolvedValue({
      id: 'sos-4',
      type: 'SOS_BUTTON',
      timestamp: 4000,
      claimToken: 'claim-sos-4',
    });

    activateHeadless.mockRejectedValue(
      new Error('network unavailable'),
    );

    releasePending.mockResolvedValue(true);

    await expect(
      runHeadlessProtectionWorker(),
    ).resolves.toBeUndefined();

    expect(acknowledgeClaimed).not.toHaveBeenCalled();

    expect(releasePending).toHaveBeenCalledWith(
      'sos-4',
      'claim-sos-4',
    );

    expect(claimPending).toHaveBeenCalledTimes(1);
  });
});
const voiceClaim = {
  id: 'voice-1', type: 'VOICE' as const, timestamp: 1000,
  phrase: 'HELP HELP', provider: 'picovoice_porcupine', claimToken: 'voice-token',
};

describe('headless VOICE execution', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    releasePending.mockResolvedValue(true);
    acknowledgeClaimed.mockResolvedValue(true);
    (processVoiceTrigger as jest.Mock).mockResolvedValue('ACK');
  });

  it('uses canonical VOICE semantics in headless mode and exact ACK', async () => {
    claimPending.mockResolvedValueOnce(voiceClaim).mockResolvedValueOnce(null);
    await runHeadlessProtectionWorker();
    expect(processVoiceTrigger).toHaveBeenCalledWith({
      phrase: 'HELP HELP', provider: 'picovoice_porcupine', confidence: null, timestamp: 1000,
    }, 'headless');
    expect(activateHeadless).not.toHaveBeenCalled();
    expect(acknowledgeClaimed).toHaveBeenCalledWith('voice-1', 'voice-token');
    expect(releasePending).not.toHaveBeenCalled();
  });

  it.each(['retry', 'throw', 'failed ACK', 'throwing ACK'])('retains VOICE and stops FIFO on %s', async (failure) => {
    claimPending.mockResolvedValue(voiceClaim);
    if (failure === 'retry') (processVoiceTrigger as jest.Mock).mockResolvedValue('RETRY');
    if (failure === 'throw') (processVoiceTrigger as jest.Mock).mockRejectedValue(new Error('offline'));
    if (failure === 'failed ACK') acknowledgeClaimed.mockResolvedValue(false);
    if (failure === 'throwing ACK') acknowledgeClaimed.mockRejectedValue(new Error('bridge'));
    await runHeadlessProtectionWorker();
    expect(releasePending).toHaveBeenCalledWith('voice-1', 'voice-token');
    expect(claimPending).toHaveBeenCalledTimes(1);
    expect(activateHeadless).not.toHaveBeenCalled();
    if (failure === 'retry' || failure === 'throw') expect(acknowledgeClaimed).not.toHaveBeenCalled();
  });

  it.each([true, false])('drains mixed FIFO in native order, voice first=%s', async (voiceFirst) => {
    const sos = { id: 'sos-1', type: 'SOS_BUTTON' as const, timestamp: 2000, claimToken: 'sos-token' };
    const queue = voiceFirst ? [voiceClaim, sos] : [sos, voiceClaim];
    claimPending.mockResolvedValueOnce(queue[0]).mockResolvedValueOnce(queue[1]).mockResolvedValueOnce(null);
    activateHeadless.mockResolvedValue({ status: 'INCIDENT_ACTIVATED' });
    await runHeadlessProtectionWorker();
    expect(acknowledgeClaimed.mock.calls).toEqual(queue.map(c => [c.id, c.claimToken]));
    expect(processVoiceTrigger).toHaveBeenCalledTimes(1);
    expect(activateHeadless).toHaveBeenCalledTimes(1);
    expect(releasePending).not.toHaveBeenCalled();
    const voiceOrder = (processVoiceTrigger as jest.Mock).mock.invocationCallOrder[0];
    const sosOrder = activateHeadless.mock.invocationCallOrder[0];
    expect(voiceOrder < sosOrder).toBe(voiceFirst);
  });

  it('a concurrent wake that cannot claim never processes the owned VOICE', async () => {
    let finish!: (value: 'ACK') => void;
    (processVoiceTrigger as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    claimPending.mockResolvedValueOnce(voiceClaim).mockResolvedValue(null);
    const owner = runHeadlessProtectionWorker();
    await Promise.resolve();
    await runHeadlessProtectionWorker();
    expect(processVoiceTrigger).toHaveBeenCalledTimes(1);
    expect(acknowledgeClaimed).not.toHaveBeenCalled();
    finish('ACK');
    await owner;
    expect(acknowledgeClaimed).toHaveBeenCalledTimes(1);
  });
});
