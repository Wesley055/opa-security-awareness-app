// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const session = vi.hoisted(() => ({
  apiUrl: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock('@/lib/operator-session', () => ({
  apiUrl: session.apiUrl,
  getAccessToken: session.getAccessToken,
}));

import {
  createBulkFacilityAdminResidents,
  createFacilityAdminResident,
  fetchFacilityAdminResidents,
  fetchResidentInvitation,
  resendResidentInvitation,
} from '@/lib/facility-admin-residents';

const RESIDENTS = {
  facility: {
    id: 'facility-1',
    name: 'Ikeja Gardens',
    isActive: true,
  },
  residents: [
    {
      id: 'resident-1',
      email: 'resident@example.com',
      phoneNumber: '+2348012345678',
      firstName: 'Ada',
      lastName: 'Okafor',
      role: 'USER',
      isActive: true,
      accountStatus: 'PENDING_ACTIVATION',
    },
  ],
};

const CREATED = {
  user: {
    id: 'resident-1',
    email: 'resident@example.com',
    phoneNumber: '+2348012345678',
    firstName: 'Ada',
    lastName: 'Okafor',
    role: 'USER',
    facilityId: 'facility-1',
    accountStatus: 'PENDING_ACTIVATION',
    activationExpiresAt: null,
    invitedByUserId: 'facility-admin-1',
  },
  delivery: {
    id: 'delivery-1',
    channel: 'SMS',
    status: 'QUEUED',
    recipient: '+2348012345678',
    queuedAt: '2026-09-01T09:00:00.000Z',
    nextAttemptAt: '2026-09-01T09:00:00.000Z',
  },
};

const INVITATION = {
  resident: {
    id: 'resident-1',
    facilityId: 'facility-1',
    isActive: true,
    accountStatus: 'PENDING_ACTIVATION',
    activatedAt: null,
  },
  latest: {
    id: 'delivery-1',
    channel: 'SMS',
    status: 'SENT',
    attemptCount: 1,
    lastError: null,
    queuedAt: '2026-09-01T09:00:00.000Z',
    nextAttemptAt: null,
    lastAttemptAt: '2026-09-01T09:00:02.000Z',
    sentAt: '2026-09-01T09:00:03.000Z',
    failedAt: null,
    createdAt: '2026-09-01T09:00:00.000Z',
  },
  history: [],
  canResend: false,
  resendAvailableAt: '2026-09-01T09:05:02.000Z',
};

describe('facility-admin-residents', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    session.apiUrl.mockReturnValue('https://api.example.test');
    session.getAccessToken.mockResolvedValue('access-token');
  });

  it('lists residents through the guarded facility-admin endpoint without a facility id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(RESIDENTS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(fetchFacilityAdminResidents()).resolves.toEqual({
      state: 'READY',
      data: RESIDENTS,
    });

    const [url, init] = fetchMock.mock.calls[0];

    expect(url.toString()).toBe(
      'https://api.example.test/facility-admin/facility/residents',
    );
    expect(init?.headers).toEqual({
      Authorization: 'Bearer access-token',
    });
    expect(init?.cache).toBe('no-store');
  });

  it('does not call upstream without an access token', async () => {
    session.getAccessToken.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(fetchFacilityAdminResidents()).resolves.toEqual({
      state: 'REJECTED',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves a facility-admin 403 message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Facility administrator access is required.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(fetchFacilityAdminResidents()).resolves.toEqual({
      state: 'FORBIDDEN',
      message: 'Facility administrator access is required.',
    });
  });

  it('rejects a malformed resident-list success body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          facility: { id: 'facility-1', name: 'Ikeja Gardens' },
          residents: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(fetchFacilityAdminResidents()).resolves.toEqual({
      state: 'UNAVAILABLE',
    });
  });

  it('reads invitation state for an encoded resident id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(INVITATION), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(
      fetchResidentInvitation('resident / 1'),
    ).resolves.toEqual({
      state: 'READY',
      data: INVITATION,
    });

    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://api.example.test/facility-admin/facility/residents/resident%20%2F%201/invitation',
    );
  });

  it('creates a resident without sending a facility id from the Viewer', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(CREATED), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const input = {
      email: 'resident@example.com',
      phoneNumber: '+2348012345678',
      firstName: 'Ada',
      lastName: 'Okafor',
    };

    await expect(createFacilityAdminResident(input)).resolves.toEqual({
      state: 'READY',
      data: CREATED,
    });

    const [url, init] = fetchMock.mock.calls[0];

    expect(url.toString()).toBe(
      'https://api.example.test/facility-admin/facility/residents',
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(input);
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('facilityId');
  });

  it('preserves validation errors from resident creation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: ['phoneNumber must be a valid phone number'],
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(
      createFacilityAdminResident({
        email: 'resident@example.com',
        phoneNumber: 'bad-number',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    ).resolves.toEqual({
      state: 'INVALID',
      message: 'phoneNumber must be a valid phone number',
    });
  });

  it('preserves resident conflicts without leaking an internal error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'An account already exists for this email.',
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(
      createFacilityAdminResident({
        email: 'resident@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    ).resolves.toEqual({
      state: 'CONFLICT',
      message: 'An account already exists for this email.',
    });
  });

  it('accepts partial success from bulk provisioning', async () => {
    const bulk = {
      total: 2,
      queued: 1,
      failed: 1,
      results: [
        {
          index: 0,
          status: 'QUEUED',
          user: CREATED.user,
          delivery: CREATED.delivery,
        },
        {
          index: 1,
          status: 'FAILED',
          error: {
            statusCode: 409,
            message: 'An account already exists for this email.',
          },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(bulk), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      createBulkFacilityAdminResidents([
        {
          email: 'resident@example.com',
          phoneNumber: '+2348012345678',
          firstName: 'Ada',
          lastName: 'Okafor',
        },
        {
          email: 'existing@example.com',
          phoneNumber: '+2348099999999',
          firstName: 'Existing',
          lastName: 'Resident',
        },
      ]),
    ).resolves.toEqual({
      state: 'READY',
      data: bulk,
    });
  });

  it('resends by resident id and accepts the queued delivery response', async () => {
    const resend = {
      delivery: {
        id: 'delivery-2',
        channel: 'SMS',
        status: 'QUEUED',
        queuedAt: '2026-09-01T09:06:00.000Z',
        nextAttemptAt: '2026-09-01T09:06:00.000Z',
      },
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(resend), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(
      resendResidentInvitation('resident-1'),
    ).resolves.toEqual({
      state: 'READY',
      data: resend,
    });

    const [url, init] = fetchMock.mock.calls[0];

    expect(url.toString()).toBe(
      'https://api.example.test/facility-admin/facility/residents/resident-1/invitation/resend',
    );
    expect(init?.method).toBe('POST');
  });
});
