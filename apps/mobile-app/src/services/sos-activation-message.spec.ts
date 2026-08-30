import { getSosActivationMessage } from './sos-activation-message';

describe('getSosActivationMessage', () => {
  it('warns on a first activation when no emergency-contact notifications were queued', () => {
    expect(
      getSosActivationMessage({
        status: 'INCIDENT_ACTIVATED',
        notifications: {
          queued: 0,
          dispatched: false,
        },
      }),
    ).toEqual({
      detail: 'Emergency activated',
      warning:
        'No emergency-contact alerts were queued. Add an emergency contact so someone can be notified. Your SOS is active and location tracking continues.',
    });
  });

  it('does not warn on a retrigger when no new notifications were queued', () => {
    expect(
      getSosActivationMessage({
        status: 'INCIDENT_RETRIGGERED',
        notifications: {
          queued: 0,
          dispatched: false,
        },
      }),
    ).toEqual({
      detail: 'Your existing emergency alert remains active',
      warning: null,
    });
  });

  it('does not expose notification row counts as alert counts', () => {
    const message = getSosActivationMessage({
      status: 'INCIDENT_ACTIVATED',
      notifications: {
        queued: 2,
        dispatched: false,
      },
    });

    expect(message.detail).toBe('Emergency activated');
    expect(message.warning).toBeNull();
    expect(message.detail).not.toContain('2');
  });
});