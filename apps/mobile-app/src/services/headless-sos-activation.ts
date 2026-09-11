import { getSosActivationMode, incidentPresentationMode, type ActivationMode } from './silent-sos';
import { backgroundApi } from './api';
import {
  acquireEmergencyLocationWithoutPermissionRequest,
  type EmergencyLocationFailure,
} from './emergency-location';

type NotificationDispatchResult = {
  queued: number;
  dispatched: boolean;
};

export type HeadlessSosActivationResult =
  | {
      status: 'LOCATION_UNAVAILABLE';
      locationFailure: EmergencyLocationFailure;
    }
  | {
      status: 'INCIDENT_ACTIVATED' | 'INCIDENT_RETRIGGERED';
      incidentId: string;
      activationMode?: ActivationMode;
      journeySessionId?: string;
      notifications: NotificationDispatchResult;
    }
  | {
      status: string;
      incidentId?: string;
      activationMode?: ActivationMode;
      journeySessionId?: string;
      notifications?: NotificationDispatchResult;
    };

export async function activateFromHeadlessSosTrigger(activationMode: ActivationMode = getSosActivationMode()):
Promise<HeadlessSosActivationResult> {
  const location =
    await acquireEmergencyLocationWithoutPermissionRequest().catch(() => ({ ok: false as const, reason: 'LOCATION_UNAVAILABLE' as const }));

  // Explicit locked SOS must not wait for a GPS fix to create the emergency.

  const { data } = await backgroundApi.post(
    '/incident-orchestrator/activate',
    {
      triggerType: 'SOS_BUTTON',
      mode: 'CONFIRMATION',
      activationMode,
      activationSource: 'LOCK_SCREEN',
      userConfirmed: true,
      ...(location.ok ? {
        latitude: location.fix.latitude,
        longitude: location.fix.longitude,
        accuracy: typeof location.fix.accuracy === 'number' ? location.fix.accuracy : undefined,
      } : {}),
    },
  );

  const status =
    typeof data?.status === 'string'
      ? data.status
      : 'UNKNOWN';

  const incidentId =
    typeof data?.incident?.id === 'string'
      ? data.incident.id
      : undefined;

  const notifications =
    data?.notifications &&
    typeof data.notifications.queued === 'number' &&
    typeof data.notifications.dispatched === 'boolean'
      ? {
          queued: data.notifications.queued,
          dispatched: data.notifications.dispatched,
        }
      : undefined;

  if (
    (status === 'INCIDENT_ACTIVATED' ||
      status === 'INCIDENT_RETRIGGERED') &&
    incidentId !== undefined &&
    notifications !== undefined
  ) {
    return {
      status,
      incidentId,
      ...(typeof data.incident?.journeySessionId === 'string' ? { journeySessionId: data.incident.journeySessionId } : {}),
      activationMode: incidentPresentationMode(data.incident, activationMode),
      notifications,
    };
  }

  return {
    status,
    incidentId,
    notifications,
  };
}