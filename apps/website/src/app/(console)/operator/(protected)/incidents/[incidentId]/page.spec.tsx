import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  getOperatorContext: vi.fn(),
  fetchIncidentDetail: vi.fn(),
  fetchOperatorTracking: vi.fn(),
  fetchIncidentTimeline: vi.fn(),
  fetchTimelineVerification: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@/lib/operator-session', () => ({
  getSessionState: mocks.getSessionState,
}));

vi.mock('@/lib/operator-context', () => ({
  getOperatorContext: mocks.getOperatorContext,
}));

vi.mock('@/lib/operator-incident', () => ({
  fetchIncidentDetail: mocks.fetchIncidentDetail,
}));

vi.mock('@/lib/operator-tracking', () => ({
  fetchOperatorTracking: mocks.fetchOperatorTracking,
}));

vi.mock('@/lib/operator-timeline', () => ({
  fetchIncidentTimeline: mocks.fetchIncidentTimeline,
  fetchTimelineVerification: mocks.fetchTimelineVerification,
}));

import IncidentDetailPage from './page';

describe('IncidentDetailPage role routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionState.mockResolvedValue('active');
  });

  it('routes FACILITY_ADMIN away before any operational incident reads', async () => {
    mocks.getOperatorContext.mockResolvedValue({
      state: 'READY',
      context: {
        role: 'FACILITY_ADMIN',
        facility: {
          id: 'facility-1',
          name: 'Ikeja Gardens',
          type: 'ESTATE',
          isActive: true,
          isVerified: true,
        },
      },
    });

    await expect(
      IncidentDetailPage({
        params: Promise.resolve({ incidentId: 'incident-1' }),
      }),
    ).rejects.toThrow('REDIRECT:/operator/residents');

    expect(mocks.redirect).toHaveBeenCalledWith('/operator/residents');
    expect(mocks.fetchIncidentDetail).not.toHaveBeenCalled();
    expect(mocks.fetchIncidentTimeline).not.toHaveBeenCalled();
    expect(mocks.fetchTimelineVerification).not.toHaveBeenCalled();
    expect(mocks.fetchOperatorTracking).not.toHaveBeenCalled();
  });
});
