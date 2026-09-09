import { cleanNonNegative } from './journey-fix-contract';
import {
  acquireEmergencyLocation,
  type EmergencyLocationFailure,
} from './emergency-location';
import { api, backgroundApi } from './api';
import { isForegroundExecutionAllowed } from './foreground-execution';
import { startTracking } from './journey-tracker';

export type SosActivationStatus =
  | 'INCIDENT_ACTIVATED'
  | 'INCIDENT_RETRIGGERED'
  | 'NOT_ACTIVATED'
  | 'CONFIRMATION_REQUIRED'
  | 'LOCATION_UNAVAILABLE';

export interface SosActivationResult {
  status: SosActivationStatus;
  incidentId?: string;
  notifications?: {
    queued: number;
    dispatched: boolean;
  };
  locationFailure?: EmergencyLocationFailure;
}

/**
 * Canonical explicit SOS-button activation boundary.
 *
 * A user tapping an SOS control is an intentional emergency request.
 * The backend's SOS_BUTTON policy activates immediately; CONFIRMATION
 * preserves the existing mobile SOS audit semantics and userConfirmed
 * records that the user explicitly initiated the request.
 */
export async function activateFromSosTrigger():
Promise<SosActivationResult> {
  let restricted = !isForegroundExecutionAllowed();
  const location = await acquireEmergencyLocation();
  restricted = restricted || !isForegroundExecutionAllowed();

  if (!location.ok) {
    return {
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: location.reason,
    };
  }

  const { data } =
    await (restricted ? backgroundApi : api).post('/incident-orchestrator/activate', {
      triggerType: 'SOS_BUTTON',
      mode: 'CONFIRMATION',
      userConfirmed: true,
      latitude: location.fix.latitude,
      longitude: location.fix.longitude,
      accuracy: cleanNonNegative(location.fix.accuracy),
    });

  if (
    data.status === 'INCIDENT_ACTIVATED' ||
    data.status === 'INCIDENT_RETRIGGERED'
  ) {
    if (!restricted && isForegroundExecutionAllowed()) {
      try {
        await startTracking();
      } catch {
        console.log('[opa-protection] foreground tracking unavailable');
      }
    }

    return {
      status: data.status,
      incidentId: data.incident?.id,
      notifications: data.notifications,
    };
  }

  if (data.status === 'CONFIRMATION_REQUIRED') {
    return {
      status: 'CONFIRMATION_REQUIRED',
    };
  }

  return {
    status: 'NOT_ACTIVATED',
  };
}