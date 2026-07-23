import { NotificationChannel } from './dto/send-notification.dto';

/**
 * Versioned payload persisted on IncidentNotification.payload.
 *
 * The dispatch worker sends a queued notification using ONLY its own row, so
 * everything needed to deliver the message is frozen here at incident time.
 * No re-querying of Incident/User at dispatch time, and no drift if that data
 * changes between queueing and delivery.
 */
export const NOTIFICATION_PAYLOAD_VERSION = 1;

export const EMERGENCY_ALERT_SUBJECT = 'OPA Emergency Alert';

export type NotificationPayloadV1 = {
  version: 1;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  message: string;
  trackingUrl: string;
  personName: string;
  location: string;
}

/**
 * Single source of truth for the incident tracking URL. Used by the
 * orchestrator (inside the transaction, from the newly created incident id)
 * and anywhere else the link is needed.
 */
export function buildTrackingUrl(incidentId: string): string {
  return `https://opasafety.com/incidents/${incidentId}`;
}

/**
 * Single source of truth for the emergency alert message body.
 *
 * Both the legacy synchronous path (NotificationService.sendEmergencyAlert)
 * and the dispatch worker use this, so the two cannot drift while they
 * coexist across the Phase 2c cutover.
 */
export function buildEmergencyMessage(params: {
  personName: string;
  location: string;
  trackingUrl: string;
}): string {
  return (
    `OPA ALERT: ${params.personName} may be in danger. ` +
    `Location: ${params.location}. ` +
    `Track live: ${params.trackingUrl}`
  );
}

/**
 * Build the durable payload stored on a QUEUED IncidentNotification row.
 */
export function buildNotificationPayload(params: {
  channel: NotificationChannel;
  recipient: string;
  personName: string;
  location: string;
  trackingUrl: string;
}): NotificationPayloadV1 {
  return {
    version: NOTIFICATION_PAYLOAD_VERSION,
    channel: params.channel,
    recipient: params.recipient,
    subject: EMERGENCY_ALERT_SUBJECT,
    message: buildEmergencyMessage({
      personName: params.personName,
      location: params.location,
      trackingUrl: params.trackingUrl,
    }),
    trackingUrl: params.trackingUrl,
    personName: params.personName,
    location: params.location,
  };
}

/**
 * Runtime validation for a persisted payload. The worker must never trust a
 * row blindly: rows written before this field existed are null, and a future
 * payload version may not be dispatchable by this code path.
 */
export function isNotificationPayloadV1(
  value: unknown,
): value is NotificationPayloadV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === NOTIFICATION_PAYLOAD_VERSION &&
    typeof candidate.channel === 'string' &&
    typeof candidate.recipient === 'string' &&
    typeof candidate.subject === 'string' &&
    typeof candidate.message === 'string'
  );
}