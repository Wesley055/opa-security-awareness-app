import {
  bearingDegrees,
  deriveMovementIntelligence,
  directionFromBearing,
  distanceMeters,
} from './movement-intelligence';

describe('movement intelligence', () => {
  const activation = {
    latitude: 6.5244,
    longitude: 3.3792,
  };

  function point(
    latitude: number,
    longitude: number,
    recordedAt: string,
    options: {
      accuracy?: number | null;
      speed?: number | null;
      heading?: number | null;
    } = {},
  ) {
    return {
      latitude,
      longitude,
      accuracy: options.accuracy ?? 5,
      speed: options.speed ?? null,
      heading: options.heading ?? null,
      recordedAt,
    };
  }

  it('calculates geographic distance', () => {
    const distance = distanceMeters(
      activation,
      { latitude: 6.5254, longitude: 3.3792 },
    );

    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });

  it('calculates northward bearing', () => {
    const bearing = bearingDegrees(
      activation,
      { latitude: 6.5254, longitude: 3.3792 },
    );

    expect(bearing).toBeCloseTo(0, 1);
    expect(directionFromBearing(bearing)).toBe('NORTH');
  });

  it('does not claim movement from one fix', () => {
    const result = deriveMovementIntelligence(activation, [
      point(
        6.5245,
        3.3792,
        '2026-08-28T07:00:00.000Z',
        { speed: 1.2 },
      ),
    ]);

    expect(result.state).toBe('UNKNOWN');
    expect(result.bearingDegrees).toBeNull();
    expect(result.distanceFromActivationMeters).not.toBeNull();
  });

  it('detects clear movement beyond the GPS uncertainty envelope', () => {
    const result = deriveMovementIntelligence(activation, [
      point(
        6.5244,
        3.3792,
        '2026-08-28T07:00:00.000Z',
        { accuracy: 5 },
      ),
      point(
        6.5254,
        3.3792,
        '2026-08-28T07:00:10.000Z',
        { accuracy: 5, speed: 11 },
      ),
    ]);

    expect(result.state).toBe('MOVING');
    expect(result.direction).toBe('NORTH');
    expect(result.distanceFromPreviousMeters).toBeGreaterThan(100);
    expect(result.lastMovementAt).toBe(
      '2026-08-28T07:00:10.000Z',
    );
  });

  it('does not mistake GPS jitter for movement', () => {
    const result = deriveMovementIntelligence(activation, [
      point(
        6.5244,
        3.3792,
        '2026-08-28T07:00:00.000Z',
        { accuracy: 12 },
      ),
      point(
        6.52445,
        3.3792,
        '2026-08-28T07:00:10.000Z',
        { accuracy: 12 },
      ),
    ]);

    expect(result.state).toBe('UNKNOWN');
    expect(result.direction).toBeNull();
  });

  it('requires multiple fixes and time before declaring stationary', () => {
    const result = deriveMovementIntelligence(activation, [
      point(
        6.5244,
        3.3792,
        '2026-08-28T07:00:00.000Z',
        { accuracy: 8, speed: 0.1 },
      ),
      point(
        6.52442,
        3.3792,
        '2026-08-28T07:00:20.000Z',
        { accuracy: 8, speed: 0.2 },
      ),
      point(
        6.52441,
        3.3792,
        '2026-08-28T07:00:40.000Z',
        { accuracy: 8, speed: 0 },
      ),
    ]);

    expect(result.state).toBe('STATIONARY');
    expect(result.direction).toBeNull();
  });

  it('does not declare stationary before the observation window is long enough', () => {
    const result = deriveMovementIntelligence(activation, [
      point(
        6.5244,
        3.3792,
        '2026-08-28T07:00:00.000Z',
        { accuracy: 8, speed: 0 },
      ),
      point(
        6.52441,
        3.3792,
        '2026-08-28T07:00:05.000Z',
        { accuracy: 8, speed: 0 },
      ),
      point(
        6.52442,
        3.3792,
        '2026-08-28T07:00:10.000Z',
        { accuracy: 8, speed: 0 },
      ),
    ]);

    expect(result.state).toBe('UNKNOWN');
  });
});