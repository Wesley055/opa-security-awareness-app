import {
  deriveFixOrigin,
  deriveTrackingState,
  silenceThresholdSeconds,
} from './tracking-state';

const NOW = new Date('2026-07-28T12:00:00.000Z');

describe('deriveTrackingState', () => {
  const original = process.env.JOURNEY_SILENCE_SECONDS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.JOURNEY_SILENCE_SECONDS;
    } else {
      process.env.JOURNEY_SILENCE_SECONDS = original;
    }
  });

  it('reports ENDED for an ended session even when a fix arrived recently', () => {
    expect(
      deriveTrackingState(
        { status: 'ENDED', lastFixReceivedAt: NOW },
        NOW,
      ),
    ).toBe('ENDED');
  });

  // AWAITING_FIRST_FIX and SILENT must never collapse: one means the stream
  // has not started, the other means it started and stopped.
  it('reports AWAITING_FIRST_FIX when no fix has ever been received', () => {
    expect(
      deriveTrackingState({ status: 'STARTED', lastFixReceivedAt: null }, NOW),
    ).toBe('AWAITING_FIRST_FIX');
  });

  it('reports RECEIVING inside the threshold', () => {
    const recent = new Date(NOW.getTime() - 30 * 1000);
    expect(
      deriveTrackingState({ status: 'ACTIVE', lastFixReceivedAt: recent }, NOW),
    ).toBe('RECEIVING');
  });

  it('reports SILENT past the threshold', () => {
    const old = new Date(NOW.getTime() - 600 * 1000);
    expect(
      deriveTrackingState({ status: 'ACTIVE', lastFixReceivedAt: old }, NOW),
    ).toBe('SILENT');
  });

  it('treats a fix exactly on the threshold as still receiving', () => {
    const edge = new Date(NOW.getTime() - 120 * 1000);
    expect(
      deriveTrackingState({ status: 'ACTIVE', lastFixReceivedAt: edge }, NOW),
    ).toBe('RECEIVING');
  });

  it('honours the environment override', () => {
    process.env.JOURNEY_SILENCE_SECONDS = '30';
    const old = new Date(NOW.getTime() - 60 * 1000);
    expect(
      deriveTrackingState({ status: 'ACTIVE', lastFixReceivedAt: old }, NOW),
    ).toBe('SILENT');
  });

  it('defaults to 120 seconds', () => {
    delete process.env.JOURNEY_SILENCE_SECONDS;
    expect(silenceThresholdSeconds()).toBe(120);
  });

  // A NaN threshold would make every comparison false and report every
  // active session as SILENT. Loud beats plausible.
  it('throws on a non-numeric threshold rather than silencing everything', () => {
    process.env.JOURNEY_SILENCE_SECONDS = 'abc';
    expect(() => silenceThresholdSeconds()).toThrow(/positive number/);
  });

  it('throws on an empty string, which Number() would read as 0', () => {
    process.env.JOURNEY_SILENCE_SECONDS = '';
    expect(() => silenceThresholdSeconds()).toThrow(/positive number/);
  });

  it('throws on zero and on a negative threshold', () => {
    process.env.JOURNEY_SILENCE_SECONDS = '0';
    expect(() => silenceThresholdSeconds()).toThrow(/positive number/);
    process.env.JOURNEY_SILENCE_SECONDS = '-5';
    expect(() => silenceThresholdSeconds()).toThrow(/positive number/);
  });
});

describe('deriveFixOrigin', () => {
  it('maps the activation fix to ACTIVATION', () => {
    expect(deriveFixOrigin('activation')).toBe('ACTIVATION');
  });

  // Control: not everything is ACTIVATION.
  it('maps every other capture mode to TRACKED', () => {
    for (const source of ['foreground', 'background', 'manual', 'retrigger']) {
      expect(deriveFixOrigin(source)).toBe('TRACKED');
    }
  });

  it('treats a missing source as TRACKED', () => {
    expect(deriveFixOrigin(null)).toBe('TRACKED');
    expect(deriveFixOrigin(undefined)).toBe('TRACKED');
  });
});
