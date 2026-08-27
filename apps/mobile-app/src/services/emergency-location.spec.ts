import * as Location from 'expo-location';

import {
  acquireEmergencyLocation,
  isEmergencyLocationFresh,
  MAX_EMERGENCY_LOCATION_AGE_MS,
} from './emergency-location';

jest.mock('expo-location', () => ({
  Accuracy: {
    High: 4,
  },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockedLocation = Location as jest.Mocked<typeof Location>;

describe('emergency-location', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns PERMISSION_DENIED when location permission can be requested again', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: true,
      expires: 'never',
    } as never);

    await expect(acquireEmergencyLocation()).resolves.toEqual({
      ok: false,
      reason: 'PERMISSION_DENIED',
    });
  });

  it('returns PERMISSION_BLOCKED when location permission cannot be requested again', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    } as never);

    await expect(acquireEmergencyLocation()).resolves.toEqual({
      ok: false,
      reason: 'PERMISSION_BLOCKED',
    });
  });

  it('returns a high-accuracy emergency fix when location succeeds', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as never);

    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 12,
      },
    } as never);

    const before = Date.now();
    const result = await acquireEmergencyLocation();
    const after = Date.now();

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error('Expected emergency location success.');
    }

    expect(result.fix.latitude).toBe(6.5244);
    expect(result.fix.longitude).toBe(3.3792);
    expect(result.fix.accuracy).toBe(12);
    expect(result.fix.acquiredAt).toBeGreaterThanOrEqual(before);
    expect(result.fix.acquiredAt).toBeLessThanOrEqual(after);

    expect(
      mockedLocation.getCurrentPositionAsync,
    ).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.High,
    });
  });

  it('returns LOCATION_UNAVAILABLE when the location provider fails', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as never);

    mockedLocation.getCurrentPositionAsync.mockRejectedValue(
      new Error('gps unavailable'),
    );

    await expect(acquireEmergencyLocation()).resolves.toEqual({
      ok: false,
      reason: 'LOCATION_UNAVAILABLE',
    });
  });

  it('accepts a fix at the freshness boundary', () => {
    const now = 1_000_000;

    expect(
      isEmergencyLocationFresh(
        {
          latitude: 1,
          longitude: 2,
          accuracy: null,
          acquiredAt: now - MAX_EMERGENCY_LOCATION_AGE_MS,
        },
        now,
      ),
    ).toBe(true);
  });

  it('rejects a fix older than the freshness boundary', () => {
    const now = 1_000_000;

    expect(
      isEmergencyLocationFresh(
        {
          latitude: 1,
          longitude: 2,
          accuracy: null,
          acquiredAt: now - MAX_EMERGENCY_LOCATION_AGE_MS - 1,
        },
        now,
      ),
    ).toBe(false);
  });
});
