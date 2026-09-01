// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const residents = vi.hoisted(() => ({
  createBulkFacilityAdminResidents: vi.fn(),
}));

vi.mock('@/lib/facility-admin-residents', () => ({
  createBulkFacilityAdminResidents: residents.createBulkFacilityAdminResidents,
}));

import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/operator/residents/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const row = {
  email: 'resident@example.com',
  phoneNumber: '+2348012345678',
  firstName: 'Ada',
  lastName: 'Okafor',
};

describe('POST /api/operator/residents/bulk', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    residents.createBulkFacilityAdminResidents.mockReset();
  });

  it('strips browser-supplied facilityId before forwarding residents', async () => {
    residents.createBulkFacilityAdminResidents.mockResolvedValue({
      state: 'READY',
      data: { total: 1, queued: 1, failed: 0, results: [] },
    });

    const response = await POST(
      request({
        residents: [{ ...row, facilityId: 'attacker-selected-facility' }],
      }),
    );

    expect(response.status).toBe(200);
    expect(residents.createBulkFacilityAdminResidents).toHaveBeenCalledWith([
      row,
    ]);
    expect(
      residents.createBulkFacilityAdminResidents.mock.calls[0][0][0],
    ).not.toHaveProperty('facilityId');
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  });

  it('rejects empty and oversized batches before upstream', async () => {
    const empty = await POST(request({ residents: [] }));
    expect(empty.status).toBe(400);

    const oversized = await POST(
      request({ residents: Array.from({ length: 201 }, () => row) }),
    );
    expect(oversized.status).toBe(400);

    expect(residents.createBulkFacilityAdminResidents).not.toHaveBeenCalled();
  });

  it('maps forbidden and unavailable states', async () => {
    residents.createBulkFacilityAdminResidents.mockResolvedValueOnce({
      state: 'FORBIDDEN',
      message: 'Facility administrator access is required.',
    });

    const forbidden = await POST(request({ residents: [row] }));
    expect(forbidden.status).toBe(403);

    residents.createBulkFacilityAdminResidents.mockResolvedValueOnce({
      state: 'UNAVAILABLE',
    });

    const unavailable = await POST(request({ residents: [row] }));
    expect(unavailable.status).toBe(503);
  });
});
