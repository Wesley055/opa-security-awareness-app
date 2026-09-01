import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  getOperatorContext: vi.fn(),
  fetchOperatorMembership: vi.fn(),
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

vi.mock('@/lib/operator-membership', () => ({
  fetchOperatorMembership: mocks.fetchOperatorMembership,
}));

import OperatorMembersPage from './page';

describe('OperatorMembersPage role routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionState.mockResolvedValue('active');
  });

  it('routes FACILITY_ADMIN to resident management before fetching operator membership', async () => {
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

    await expect(OperatorMembersPage()).rejects.toThrow(
      'REDIRECT:/operator/residents',
    );

    expect(mocks.redirect).toHaveBeenCalledWith('/operator/residents');
    expect(mocks.fetchOperatorMembership).not.toHaveBeenCalled();
  });

  it('keeps FACILITY_OPERATOR on the operational membership path', async () => {
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

    mocks.fetchOperatorMembership.mockResolvedValue({
      state: 'READY',
      membership: {
        facility: {
          id: 'facility-1',
          name: 'Ikeja Gardens',
          isActive: true,
        },
        operators: [],
        residents: [],
      },
    });

    await OperatorMembersPage();

    expect(mocks.fetchOperatorMembership).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
