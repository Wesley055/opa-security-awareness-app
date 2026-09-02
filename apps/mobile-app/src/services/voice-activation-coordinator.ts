import { cleanNonNegative } from './journey-fix-contract';
import {
  acquireEmergencyLocation,
  type EmergencyLocationFailure,
} from './emergency-location';
import { api } from './api';
import { startTracking } from './journey-tracker';
import type { VoiceTriggerEvent } from './voice-trigger-provider';

export type VoiceActivationStatus =
  | 'INCIDENT_ACTIVATED'
  | 'NOT_ACTIVATED'
  | 'CONFIRMATION_REQUIRED'
  | 'LOCATION_UNAVAILABLE';

export interface VoiceActivationResult {
  status: VoiceActivationStatus;
  incidentId?: string;
  notifications?: { queued: number; dispatched: boolean };
  locationFailure?: EmergencyLocationFailure;
}

/**
 * Provider-neutral voice activation boundary.
 *
 * Picovoice-specific objects, keyword indexes and audio frames MUST NOT cross
 * into this service. Every engine is reduced to VoiceTriggerEvent first.
 *
 * Initial voice-protection policy is SILENT:
 * - matched offline keyword may activate without a screen interaction;
 * - we never claim userConfirmed unless the user actually confirms;
 * - CONFIRMATION mode is intentionally not synthesized here.
 */
export async function activateFromVoiceTrigger(
  event: VoiceTriggerEvent,
): Promise<VoiceActivationResult> {
  const location = await acquireEmergencyLocation();

  if (!location.ok) {
    return {
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: location.reason,
    };
  }

  const { data } = await api.post('/incident-orchestrator/activate', {
    triggerType: 'VOICE',
    mode: 'SILENT',
    detectedPhrase: event.phrase,
    language: 'en-NG',
    voiceConfidence:
      event.confidence === null ? undefined : event.confidence,
    repetitionCount: 1,
    userConfirmed: false,
    latitude: location.fix.latitude,
    longitude: location.fix.longitude,
    accuracy: cleanNonNegative(location.fix.accuracy),
    timestamp: new Date(event.timestamp).toISOString(),
  });

  if (data.status === 'INCIDENT_ACTIVATED') {
    await startTracking();

    return {
      status: 'INCIDENT_ACTIVATED',
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
