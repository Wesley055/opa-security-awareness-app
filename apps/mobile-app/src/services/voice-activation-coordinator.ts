import { cleanNonNegative } from './journey-fix-contract';
import {
  acquireEmergencyLocation,
  acquireEmergencyLocationWithoutPermissionRequest,
  type EmergencyLocationFailure,
} from './emergency-location';
import { api, backgroundApi } from './api';
import { startTracking } from './journey-tracker';
import type { VoiceTriggerEvent } from './voice-trigger-provider';

export type VoiceActivationStatus =
  | 'INCIDENT_ACTIVATED'
  | 'INCIDENT_RETRIGGERED'
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
  execution: 'foreground' | 'headless' = 'foreground',
): Promise<VoiceActivationResult> {
  const location = await (execution === 'headless'
    ? acquireEmergencyLocationWithoutPermissionRequest().catch(() => ({
        ok: false as const, reason: 'LOCATION_UNAVAILABLE' as const,
      }))
    : acquireEmergencyLocation());

  if (!location.ok && execution !== 'headless') {
    return {
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: location.reason,
    };
  }

  const { data } = await (execution === 'headless' ? backgroundApi : api).post('/incident-orchestrator/activate', {
    triggerType: 'VOICE',
    mode: 'SILENT',
    detectedPhrase: event.phrase,
    language: 'en-NG',
    voiceConfidence:
      event.confidence === null ? undefined : event.confidence,
    repetitionCount: 1,
    userConfirmed: false,
    ...(location.ok ? {
      latitude: location.fix.latitude,
      longitude: location.fix.longitude,
      accuracy: cleanNonNegative(location.fix.accuracy),
    } : {}),
    timestamp: new Date(event.timestamp).toISOString(),
  });

  if (
    data.status === 'INCIDENT_ACTIVATED' ||
    data.status === 'INCIDENT_RETRIGGERED'
  ) {
    // Headless activation is terminal; interactive tracking bootstrap must not
    // request permissions or turn successful activation into a durable retry.
    if (execution === 'foreground') {
      await startTracking();
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
