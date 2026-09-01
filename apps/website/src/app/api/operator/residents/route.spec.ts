// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const residents = vi.hoisted(() => ({
  createFacilityAdminResident: vi.fn(),
}));

vi.mock('@/lib/facility-admin-residents', () => ({
  createFacilityAdminResident: residents.createFacilityAdminResident,
}));

import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/operator/residents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/operator/residents', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    residents.createFacilityAdminResident.mockReset();
  });

  it('forwards only resident fields and never accepts facilityId', async () => {
    residents.createFacilityAdminResident.mockResolvedValue({
      state: 'READY',
      data: { user: { id: 'resident-1' }, delivery: { id: 'delivery-1' } },
    });

    const response = await POST(
      request({
        email: 'resident@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
        facilityId: 'attacker-selected-facility',
      }),
    );

    expect(response.status).toBe(200);
    expect(residents.createFacilityAdminResident).toHaveBeenCalledWith({
      email: 'resident@example.com',
      phoneNumber: '+2348012345678',
      firstName: 'Ada',
      lastName: 'Okafor',
    });
    expect(residents.createFacilityAdminResident.mock.calls[0][0]).not.toHaveProperty('facilityId');
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  });

  it('maps a rejected session to 401', async () => {
    residents.createFacilityAdminResident.mockResolvedValue({ state: 'REJECTED' });

    const response = await POST(
      request({
        email: 'resident@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    );

    expect(response.status).toBe(401);
  });

  it('maps validation and conflict states without changing the API message', async () => {
    residents.createFacilityAdminResident.mockResolvedValueOnce({
      state: 'INVALID',
      message: 'Phone number is invalid.',
    });

    const invalid = await POST(
      request({
        email: 'resident@example.com',
        phoneNumber: 'bad',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    );

    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      ok: false,
      error: 'Phone number is invalid.',
    });

    residents.createFacilityAdminResident.mockResolvedValueOnce({
      state: 'CONFLICT',
      message: 'An account already exists for this email.',
    });

    const conflict = await POST(
      request({
        email: 'resident@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    );

    expect(conflict.status).toBe(409);
  });

  it('rejects incomplete browser input before calling upstream', async () => {
    const response = await POST(request({ email: 'resident@example.com' }));

    expect(response.status).toBe(400);
    expect(residents.createFacilityAdminResident).not.toHaveBeenCalled();
  });
});
