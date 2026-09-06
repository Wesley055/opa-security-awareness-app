const mockActivateFromSosTrigger = jest.fn();
const mockSetActiveIncident = jest.fn();

jest.mock('./sos-activation-coordinator', () => ({
  activateFromSosTrigger: mockActivateFromSosTrigger,
}));

jest.mock('../store/activeIncidentStore', () => ({
  useActiveIncidentStore: {
    getState: () => ({
      setActiveIncident: mockSetActiveIncident,
    }),
  },
}));

describe('sos-protection-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes the activated SOS incident into the existing active incident store', async () => {
    mockActivateFromSosTrigger.mockResolvedValue({
      status: 'INCIDENT_ACTIVATED',
      incidentId: 'incident-sos-1',
      notifications: {
        queued: 4,
        dispatched: true,
      },
    });

    const { processSosTrigger } =
      require('./sos-protection-service');

    await expect(
      processSosTrigger(),
    ).resolves.toBe('ACK');

    expect(mockSetActiveIncident).toHaveBeenCalledWith({
      id: 'incident-sos-1',
      status: 'OPEN',
      notifications: {
        queued: 4,
        dispatched: true,
      },
    });
  });

  it('returns RETRY when location is unavailable', async () => {
    mockActivateFromSosTrigger.mockResolvedValue({
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: 'LOCATION_UNAVAILABLE',
    });

    const { processSosTrigger } =
      require('./sos-protection-service');

    await expect(
      processSosTrigger(),
    ).resolves.toBe('RETRY');

    expect(mockSetActiveIncident).not.toHaveBeenCalled();
  });

  it('returns RETRY when activation throws', async () => {
    mockActivateFromSosTrigger.mockRejectedValue(
      new Error('network unavailable'),
    );

    const { processSosTrigger } =
      require('./sos-protection-service');

    await expect(
      processSosTrigger(),
    ).resolves.toBe('RETRY');

    expect(mockSetActiveIncident).not.toHaveBeenCalled();
  });

  it('ACKs a terminal non-activation without publishing an incident', async () => {
    mockActivateFromSosTrigger.mockResolvedValue({
      status: 'NOT_ACTIVATED',
    });

    const { processSosTrigger } =
      require('./sos-protection-service');

    await expect(
      processSosTrigger(),
    ).resolves.toBe('ACK');

    expect(mockSetActiveIncident).not.toHaveBeenCalled();
  });
});