import * as Location from 'expo-location';
import { isForegroundExecutionAllowed } from './foreground-execution';

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

async function acquireCurrentEmergencyFix(interactive: boolean): Promise<EmergencyLocationResult> {
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
        mayShowUserSettingsDialog: interactive && isForegroundExecutionAllowed(),
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

/**
 * Interactive emergency location path.
 *
 * Existing foreground/manual/voice callers may request location permission
 * from the user before acquiring the emergency fix.
 */
export async function acquireEmergencyLocation(): Promise<EmergencyLocationResult> {
  if (!isForegroundExecutionAllowed()) {
    return acquireEmergencyLocationWithoutPermissionRequest();
  }
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

  return acquireCurrentEmergencyFix(true);
}

/**
 * Headless-safe emergency location path.
 *
 * Background emergency execution must never open permission UI. It may only
 * use permission the user has already granted.
 */
export async function acquireEmergencyLocationWithoutPermissionRequest():
Promise<EmergencyLocationResult> {
  const permission =
    await Location.getForegroundPermissionsAsync();

  if (permission.status !== 'granted') {
    return {
      ok: false,
      reason: permission.canAskAgain === false
        ? 'PERMISSION_BLOCKED'
        : 'PERMISSION_DENIED',
    };
  }

  return acquireCurrentEmergencyFix(false);
}

export function isEmergencyLocationFresh(
  fix: EmergencyLocationFix,
  now = Date.now(),
): boolean {
  return now - fix.acquiredAt <= MAX_EMERGENCY_LOCATION_AGE_MS;
}