import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  getOperatorContext: vi.fn(),
  fetchOperatorQueue: vi.fn(),
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

vi.mock('@/lib/operator-queue', () => ({
  fetchOperatorQueue: mocks.fetchOperatorQueue,
}));

import OperatorHomePage from './page';

describe('OperatorHomePage role routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionState.mockResolvedValue('active');
  });

  it('routes FACILITY_ADMIN to resident management before fetching incidents', async () => {
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

    await expect(OperatorHomePage()).rejects.toThrow(
      'REDIRECT:/operator/residents',
    );

    expect(mocks.redirect).toHaveBeenCalledWith('/operator/residents');
    expect(mocks.fetchOperatorQueue).not.toHaveBeenCalled();
  });

  it('keeps FACILITY_OPERATOR on the incident Viewer path', async () => {
    mocks.getOperatorContext.mockResolvedValue({
      state: 'READY',
      context: {
        role: 'FACILITY_OPERATOR',
        facility: {
          id: 'facility-1',
          name: 'Ikeja Gardens',
          type: 'ESTATE',
          isActive: true,
          isVerified: true,
        },
      },
    });

    mocks.fetchOperatorQueue.mockResolvedValue({
      state: 'READY',
      incidents: [],
      nextCursor: null,
      hasMore: false,
      serverTime: '2026-09-01T12:00:00.000Z',
    });

    await OperatorHomePage();

    expect(mocks.fetchOperatorQueue).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
