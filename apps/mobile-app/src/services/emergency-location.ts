import * as Location from 'expo-location';

export const EMERGENCY_LOCATION_TIMEOUT_MS = 15_000;
export const MAX_EMERGENCY_LOCATION_AGE_MS = 60_000;

export interface EmergencyLocationFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  acquiredAt: number;
}

export type EmergencyLocationFailure =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_BLOCKED'
  | 'LOCATION_UNAVAILABLE';

export type EmergencyLocationResult =
  | {
      ok: true;
      fix: EmergencyLocationFix;
    }
  | {
      ok: false;
      reason: EmergencyLocationFailure;
    };

export async function acquireEmergencyLocation(): Promise<EmergencyLocationResult> {
  const permission =
    await Location.requestForegroundPermissionsAsync();

  if (permission.status !== 'granted') {
    return {
      ok: false,
      reason: permission.canAskAgain
        ? 'PERMISSION_DENIED'
        : 'PERMISSION_BLOCKED',
    };
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('location-timeout')),
        EMERGENCY_LOCATION_TIMEOUT_MS,
      );
    });

    const position = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      }),
      timeout,
    ]);

    return {
      ok: true,
      fix: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        acquiredAt: Date.now(),
      },
    };
  } catch {
    return {
      ok: false,
      reason: 'LOCATION_UNAVAILABLE',
    };
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export function isEmergencyLocationFresh(
  fix: EmergencyLocationFix,
  now = Date.now(),
): boolean {
  return now - fix.acquiredAt <= MAX_EMERGENCY_LOCATION_AGE_MS;
}
