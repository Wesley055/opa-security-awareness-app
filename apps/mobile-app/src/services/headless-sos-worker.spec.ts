import {
  acknowledgeClaimedOpaProtectionTrigger,
  claimPendingOpaProtectionTrigger,
  releasePendingOpaProtectionTrigger,
} from '../../modules/opa-protection';
import { activateFromHeadlessSosTrigger } from './headless-sos-activation';
import { runHeadlessSosWorker } from './headless-sos-worker';

jest.mock('../../modules/opa-protection', () => ({
  claimPendingOpaProtectionTrigger: jest.fn(),
  releasePendingOpaProtectionTrigger: jest.fn(),
  acknowledgeClaimedOpaProtectionTrigger: jest.fn(),
}));

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
    jest.clearAllMocks();
  });

  it('does nothing when the durable queue is empty', async () => {
    claimPending.mockResolvedValue(null);

    await runHeadlessSosWorker();

    expect(claimPending).toHaveBeenCalledWith('headless-sos');
    expect(activateHeadless).not.toHaveBeenCalled();
    expect(acknowledgeClaimed).not.toHaveBeenCalled();
    expect(releasePending).not.toHaveBeenCalled();
  });

  it('does not bypass a VOICE record at the FIFO head', async () => {
    claimPending.mockResolvedValue({
      id: 'voice-1',
      type: 'VOICE',
      timestamp: 1000,
      phrase: 'HELP HELP',
      provider: 'picovoice_porcupine',
      claimToken: 'claim-voice',
    });

    releasePending.mockResolvedValue(true);

    await runHeadlessSosWorker();

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

    await runHeadlessSosWorker();

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

    await runHeadlessSosWorker();

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

    await runHeadlessSosWorker();

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

    await runHeadlessSosWorker();

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
      runHeadlessSosWorker(),
    ).resolves.toBeUndefined();

    expect(acknowledgeClaimed).not.toHaveBeenCalled();

    expect(releasePending).toHaveBeenCalledWith(
      'sos-4',
      'claim-sos-4',
    );

    expect(claimPending).toHaveBeenCalledTimes(1);
  });
});