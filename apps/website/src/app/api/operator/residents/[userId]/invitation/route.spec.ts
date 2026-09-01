// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const residents = vi.hoisted(() => ({
  fetchResidentInvitation: vi.fn(),
}));

vi.mock('@/lib/facility-admin-residents', () => ({
  fetchResidentInvitation: residents.fetchResidentInvitation,
}));

import { GET } from './route';

describe('GET /api/operator/residents/[userId]/invitation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    residents.fetchResidentInvitation.mockReset();
  });

  it('reads invitation state by route user id', async () => {
    residents.fetchResidentInvitation.mockResolvedValue({
      state: 'READY',
      data: {
        resident: { id: 'resident-1' },
        latest: null,
        history: [],
        canResend: false,
        resendAvailableAt: null,
      },
    });

    const response = await GET(
      new Request('http://localhost/api/operator/residents/resident-1/invitation'),
      { params: Promise.resolve({ userId: 'resident-1' }) },
    );

    expect(response.status).toBe(200);
    expect(residents.fetchResidentInvitation).toHaveBeenCalledWith('resident-1');
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  });

  it('maps rejected and not-found states', async () => {
    residents.fetchResidentInvitation.mockResolvedValueOnce({ state: 'REJECTED' });

    const rejected = await GET(
      new Request('http://localhost'),
      { params: Promise.resolve({ userId: 'resident-1' }) },
    );
    expect(rejected.status).toBe(401);

    residents.fetchResidentInvitation.mockResolvedValueOnce({
      state: 'NOT_FOUND',
      message: 'Resident not found.',
    });

    const missing = await GET(
      new Request('http://localhost'),
      { params: Promise.resolve({ userId: 'resident-1' }) },
    );
    expect(missing.status).toBe(404);
  });
});
