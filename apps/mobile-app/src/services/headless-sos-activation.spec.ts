import { backgroundApi } from './api';
import {
  acquireEmergencyLocationWithoutPermissionRequest,
} from './emergency-location';
import {
  activateFromHeadlessSosTrigger,
} from './headless-sos-activation';

jest.mock('./api', () => ({
  backgroundApi: {
    post: jest.fn(),
  },
}));

jest.mock('./emergency-location', () => ({
  acquireEmergencyLocationWithoutPermissionRequest: jest.fn(),
}));

const mockedBackgroundApi =
  backgroundApi as jest.Mocked<typeof backgroundApi>;

const mockedAcquireLocation =
  acquireEmergencyLocationWithoutPermissionRequest as jest.MockedFunction<
    typeof acquireEmergencyLocationWithoutPermissionRequest
  >;

describe('headless-sos-activation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates explicit locked SOS even when a GPS fix is unavailable', async () => {
    mockedAcquireLocation.mockResolvedValue({
      ok: false,
      reason: 'LOCATION_UNAVAILABLE',
    });

    mockedBackgroundApi.post.mockResolvedValue({ data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'incident' }, notifications: { queued: 0, dispatched: false } } });
    await expect(activateFromHeadlessSosTrigger('SILENT')).resolves.toMatchObject({ status: 'INCIDENT_ACTIVATED', incidentId: 'incident' });
    expect(mockedBackgroundApi.post).toHaveBeenCalledWith('/incident-orchestrator/activate', {
      triggerType: 'SOS_BUTTON', mode: 'CONFIRMATION', activationMode: 'SILENT', activationSource: 'LOCK_SCREEN', userConfirmed: true,
    });
  });

  it('activates explicit SOS through the headless-safe API client', async () => {
    mockedAcquireLocation.mockResolvedValue({
      ok: true,
      fix: {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 8,
        acquiredAt: Date.now(),
      },
    });

    mockedBackgroundApi.post.mockResolvedValue({
      data: {
        status: 'INCIDENT_ACTIVATED',
        incident: {
          id: 'incident-1',
        },
        notifications: {
          queued: 2,
          dispatched: true,
        },
      },
    });

    await expect(
      activateFromHeadlessSosTrigger(),
    ).resolves.toEqual({
      status: 'INCIDENT_ACTIVATED',
      activationMode: 'STANDARD',
      incidentId: 'incident-1',
      notifications: {
        queued: 2,
        dispatched: true,
      },
    });

    expect(mockedBackgroundApi.post).toHaveBeenCalledWith(
      '/incident-orchestrator/activate',
      {
        triggerType: 'SOS_BUTTON',
        mode: 'CONFIRMATION', activationMode: 'STANDARD', activationSource: 'LOCK_SCREEN',
        userConfirmed: true,
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 8,
      },
    );
  });

  it('preserves INCIDENT_RETRIGGERED as a terminal successful result', async () => {
    mockedAcquireLocation.mockResolvedValue({
      ok: true,
      fix: {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: null,
        acquiredAt: Date.now(),
      },
    });

    mockedBackgroundApi.post.mockResolvedValue({
      data: {
        status: 'INCIDENT_RETRIGGERED',
        incident: {
          id: 'incident-open',
        },
        retriggerCount: 2,
        notifications: {
          queued: 0,
          dispatched: false,
        },
      },
    });

    await expect(
      activateFromHeadlessSosTrigger(),
    ).resolves.toEqual({
      status: 'INCIDENT_RETRIGGERED',
      activationMode: 'STANDARD',
      incidentId: 'incident-open',
      notifications: {
        queued: 0,
        dispatched: false,
      },
    });

    expect(mockedBackgroundApi.post).toHaveBeenCalledWith(
      '/incident-orchestrator/activate',
      {
        triggerType: 'SOS_BUTTON',
        mode: 'CONFIRMATION', activationMode: 'STANDARD', activationSource: 'LOCK_SCREEN',
        userConfirmed: true,
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: undefined,
      },
    );
  });
});