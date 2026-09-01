// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResidentManagement } from './resident-management';

const initialResult = {
  state: 'READY' as const,
  data: {
    facility: { id: 'facility-1', name: 'Ikeja Gardens', isActive: true },
    residents: [
      {
        id: 'resident-1',
        email: 'ada@example.com',
        phoneNumber: '+2348012345678',
        firstName: 'Ada',
        lastName: 'Okafor',
        role: 'USER',
        isActive: true,
        accountStatus: 'PENDING_ACTIVATION',
      },
    ],
  },
};

describe('ResidentManagement', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.restoreAllMocks();

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        reload: vi.fn(),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('renders the real initial facility and resident data', () => {
    render(<ResidentManagement initialResult={initialResult} />);

    expect(screen.getByRole('heading', { name: 'Residents' })).toBeTruthy();
    expect(screen.getByText(/1 resident.*Ikeja Gardens/)).toBeTruthy();
    expect(screen.getByText('Ada Okafor')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('+2348012345678')).toBeTruthy();
    expect(screen.getByText('Pending Activation')).toBeTruthy();
  });

  it('creates a resident without sending a facility id from the browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ResidentManagement initialResult={initialResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add resident' }));

    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: 'Chidi' },
    });
    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: 'Nwosu' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'chidi@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '+2348098765432' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add and send invitation' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/operator/residents');
    expect(options.method).toBe('POST');

    const payload = JSON.parse(options.body);
    expect(payload).toEqual({
      firstName: 'Chidi',
      lastName: 'Nwosu',
      email: 'chidi@example.com',
      phoneNumber: '+2348098765432',
    });
    expect(payload).not.toHaveProperty('facilityId');
  });

  it('loads invitation status from the same-origin route and respects server resend policy', async () => {
    const invitation = {
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
        status: 'QUEUED',
        attemptCount: 0,
        lastError: null,
        queuedAt: '2026-09-01T18:00:00.000Z',
        nextAttemptAt: '2026-09-01T18:00:00.000Z',
        lastAttemptAt: null,
        sentAt: null,
        failedAt: null,
        createdAt: '2026-09-01T18:00:00.000Z',
      },
      history: [],
      canResend: false,
      resendAvailableAt: '2026-09-01T18:05:00.000Z',
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ invitation }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ResidentManagement initialResult={initialResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check invitation' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/operator/residents/resident-1/invitation',
        { cache: 'no-store' },
      ),
    );

    expect(await screen.findByText('SMS Â· Queued')).toBeTruthy();

    const resendButton = screen.getByRole('button', { name: 'Resend invitation' });
    expect((resendButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Resend available/)).toBeTruthy();
  });

  it('queues resend only when the server says it is allowed', async () => {
    const readyInvitation = {
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
        status: 'FAILED',
        attemptCount: 1,
        lastError: 'provider error',
        queuedAt: '2026-09-01T17:00:00.000Z',
        nextAttemptAt: '2026-09-01T17:00:00.000Z',
        lastAttemptAt: '2026-09-01T17:00:00.000Z',
        sentAt: null,
        failedAt: '2026-09-01T17:00:01.000Z',
        createdAt: '2026-09-01T17:00:00.000Z',
      },
      history: [],
      canResend: true,
      resendAvailableAt: null,
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invitation: readyInvitation }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ delivery: { id: 'delivery-2' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          invitation: {
            ...readyInvitation,
            canResend: false,
            resendAvailableAt: '2026-09-01T18:10:00.000Z',
            latest: { ...readyInvitation.latest, id: 'delivery-2', status: 'QUEUED' },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    render(<ResidentManagement initialResult={initialResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check invitation' }));
    await screen.findByText('SMS Â· Failed');

    fireEvent.click(screen.getByRole('button', { name: 'Resend invitation' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/operator/residents/resident-1/invitation/resend',
        { method: 'POST' },
      ),
    );

    expect(await screen.findByText('Invitation queued for resend.')).toBeTruthy();
  });
});
