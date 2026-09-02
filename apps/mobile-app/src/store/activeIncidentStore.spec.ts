jest.mock('../services/api', () => ({ api: { get: jest.fn() } }));

import { api } from '../services/api';
import { useActiveIncidentStore } from './activeIncidentStore';

const mockedGet = api.get as jest.Mock;

describe('activeIncidentStore', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    useActiveIncidentStore.setState({
      activeIncident: null,
      isReconciling: false,
    });
  });

  it('selects the OPEN incident from the server-ordered owner history', async () => {
    mockedGet.mockResolvedValue({
      data: [
        { id: 'resolved-newer', status: 'RESOLVED' },
        { id: 'open-123', status: 'OPEN' },
        { id: 'resolved-older', status: 'RESOLVED' },
      ],
    });

    const result =
      await useActiveIncidentStore.getState().reconcileActiveIncident();

    expect(mockedGet).toHaveBeenCalledWith('/incidents');
    expect(result).toEqual({ id: 'open-123', status: 'OPEN' });
    expect(useActiveIncidentStore.getState().activeIncident).toEqual({
      id: 'open-123',
      status: 'OPEN',
    });
    expect(useActiveIncidentStore.getState().isReconciling).toBe(false);
  });

  it('clears stale local state when the server has no OPEN incident', async () => {
    useActiveIncidentStore.getState().setActiveIncident({
      id: 'stale-open',
      status: 'OPEN',
    });
    mockedGet.mockResolvedValue({
      data: [{ id: 'resolved-1', status: 'RESOLVED' }],
    });

    const result =
      await useActiveIncidentStore.getState().reconcileActiveIncident();

    expect(result).toBeNull();
    expect(useActiveIncidentStore.getState().activeIncident).toBeNull();
  });

  it('leaves the prior incident intact when reconciliation fails', async () => {
    useActiveIncidentStore.getState().setActiveIncident({
      id: 'still-open',
      status: 'OPEN',
    });
    mockedGet.mockRejectedValue(new Error('offline'));

    await expect(
      useActiveIncidentStore.getState().reconcileActiveIncident(),
    ).rejects.toThrow('offline');

    expect(useActiveIncidentStore.getState().activeIncident).toEqual({
      id: 'still-open',
      status: 'OPEN',
    });
    expect(useActiveIncidentStore.getState().isReconciling).toBe(false);
  });
});