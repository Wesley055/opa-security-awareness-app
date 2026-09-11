jest.mock('./foreground-execution', () => ({ isForegroundExecutionAllowed: () => true }));
import { api } from './api';
import {
  acquireEmergencyLocation,
} from './emergency-location';
import { startTracking } from './journey-tracker';
import { activateFromSosTrigger } from './sos-activation-coordinator';

jest.mock('./api', () => ({
  api: {
    post: jest.fn(),
  },
}));

jest.mock('./emergency-location', () => ({
  acquireEmergencyLocation: jest.fn(),
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
  startTracking as jest.MockedFunction<
    typeof startTracking
  >;

describe('sos-activation-coordinator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves the trigger for retry when emergency location is unavailable', async () => {
    mockedAcquireEmergencyLocation.mockResolvedValue({
      ok: false,
      reason: 'LOCATION_UNAVAILABLE',
    });

    await expect(
      activateFromSosTrigger(),
    ).resolves.toEqual({
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: 'LOCATION_UNAVAILABLE',
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(mockedStartTracking).not.toHaveBeenCalled();
  });

  it('activates an explicit SOS_BUTTON request and starts tracking', async () => {
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
          id: 'incident-sos-123',
        },
        notifications: {
          queued: 3,
          dispatched: true,
        },
      },
    });

    await expect(
      activateFromSosTrigger(),
    ).resolves.toEqual({
      status: 'INCIDENT_ACTIVATED',
      activationMode: 'STANDARD',
      incidentId: 'incident-sos-123',
      notifications: {
        queued: 3,
        dispatched: true,
      },
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(1);

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/incident-orchestrator/activate',
      expect.objectContaining({
        triggerType: 'SOS_BUTTON',
        mode: 'CONFIRMATION',
        userConfirmed: true,
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 8,
      }),
    );

    expect(mockedStartTracking).toHaveBeenCalledTimes(1);
  });

  it('does not start tracking when the backend does not activate', async () => {
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
      activateFromSosTrigger(),
    ).resolves.toEqual({
      status: 'NOT_ACTIVATED',
    });

    expect(mockedStartTracking).not.toHaveBeenCalled();
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
          id: 'incident-sos-existing',
        },
        retriggerCount: 2,
        notifications: {
          queued: 0,
          dispatched: false,
        },
      },
    });

    await expect(
      activateFromSosTrigger(),
    ).resolves.toEqual({
      status: 'INCIDENT_RETRIGGERED',
      activationMode: 'STANDARD',
      incidentId: 'incident-sos-existing',
      notifications: {
        queued: 0,
        dispatched: false,
      },
    });

    expect(mockedStartTracking).toHaveBeenCalledTimes(1);
  });
});