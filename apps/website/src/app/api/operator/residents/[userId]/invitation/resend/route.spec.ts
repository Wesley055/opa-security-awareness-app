// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const residents = vi.hoisted(() => ({
  resendResidentInvitation: vi.fn(),
}));

vi.mock('@/lib/facility-admin-residents', () => ({
  resendResidentInvitation: residents.resendResidentInvitation,
}));

import { POST } from './route';

describe('POST /api/operator/residents/[userId]/invitation/resend', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    residents.resendResidentInvitation.mockReset();
  });

  it('resends using only the route resident id', async () => {
    residents.resendResidentInvitation.mockResolvedValue({
      state: 'READY',
      data: {
        delivery: {
          id: 'delivery-2',
          channel: 'SMS',
          status: 'QUEUED',
          queuedAt: '2026-09-01T10:00:00.000Z',
          nextAttemptAt: null,
        },
      },
    });

    const response = await POST(
      new Request('http://localhost/api/operator/residents/resident-1/invitation/resend', {
        method: 'POST',
      }),
      { params: Promise.resolve({ userId: 'resident-1' }) },
    );

    expect(response.status).toBe(200);
    expect(residents.resendResidentInvitation).toHaveBeenCalledWith('resident-1');
  });

  it('preserves resend cooldown conflicts', async () => {
    residents.resendResidentInvitation.mockResolvedValue({
      state: 'CONFLICT',
      message: 'Please wait five minutes before resending this invitation.',
    });

    const response = await POST(
      new Request('http://localhost', { method: 'POST' }),
      { params: Promise.resolve({ userId: 'resident-1' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Please wait five minutes before resending this invitation.',
    });
  });

  it('maps forbidden to 403', async () => {
    residents.resendResidentInvitation.mockResolvedValue({
      state: 'FORBIDDEN',
      message: 'Facility administrator access is required.',
    });

    const response = await POST(
      new Request('http://localhost', { method: 'POST' }),
      { params: Promise.resolve({ userId: 'resident-1' }) },
    );

    expect(response.status).toBe(403);
  });
});
