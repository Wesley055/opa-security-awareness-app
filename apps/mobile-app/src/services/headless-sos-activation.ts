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
      notifications: NotificationDispatchResult;
    }
  | {
      status: string;
      incidentId?: string;
      notifications?: NotificationDispatchResult;
    };

export async function activateFromHeadlessSosTrigger():
Promise<HeadlessSosActivationResult> {
  const location =
    await acquireEmergencyLocationWithoutPermissionRequest();

  if (!location.ok) {
    return {
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: location.reason,
    };
  }

  const { fix } = location;

  const { data } = await backgroundApi.post(
    '/incident-orchestrator/activate',
    {
      triggerType: 'SOS_BUTTON',
      mode: 'CONFIRMATION',
      userConfirmed: true,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy:
        typeof fix.accuracy === 'number'
          ? fix.accuracy
          : undefined,
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
      notifications,
    };
  }

  return {
    status,
    incidentId,
    notifications,
  };
}