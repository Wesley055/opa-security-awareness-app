import { authSessionEpoch } from './auth-session-epoch';
import { rememberEmergencyTracking, bootstrapEmergencyTracking } from './emergency-tracking';
import { getSosActivationMode, incidentPresentationMode, type ActivationMode } from './silent-sos';
import { isForegroundExecutionAllowed } from './foreground-execution';
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
  activationMode?: ActivationMode;
  notifications?: { queued: number; dispatched: boolean };
  locationFailure?: EmergencyLocationFailure;
}

/**
 * Provider-neutral voice activation boundary.
 *
 * Picovoice-specific objects, keyword indexes and audio frames MUST NOT cross
 * into this service. Every engine is reduced to VoiceTriggerEvent first.
 *
 * Voice recognition activates immediately; Silent SOS is a separate local choice:
 * - matched offline keyword may activate without a screen interaction;
 * - we never claim userConfirmed unless the user actually confirms;
 * - CONFIRMATION mode is intentionally not synthesized here.
 */
export async function activateFromVoiceTrigger(
  event: VoiceTriggerEvent,
  execution: 'foreground' | 'headless' = 'foreground',
): Promise<VoiceActivationResult> {
  const activationEpoch = authSessionEpoch();
  const activationMode = event.activationMode ?? getSosActivationMode();
  console.log(`[OPA-SOS] REQUEST mode=${activationMode} source=VOICE`);
  let restricted = execution === 'headless' || !isForegroundExecutionAllowed();
  const location = await (restricted
    ? acquireEmergencyLocationWithoutPermissionRequest().catch(() => ({
        ok: false as const, reason: 'LOCATION_UNAVAILABLE' as const,
      }))
    : acquireEmergencyLocation());

  restricted = restricted || !isForegroundExecutionAllowed();
  if (!location.ok && !restricted) {
    return {
      status: 'LOCATION_UNAVAILABLE',
      locationFailure: location.reason,
    };
  }

  const { data } = await (restricted ? backgroundApi : api).post('/incident-orchestrator/activate', {
    triggerType: 'VOICE',
    mode: 'IMMEDIATE',
    activationMode,
    activationSource: 'VOICE',
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
    if (restricted && typeof data.incident?.id === 'string' && activationEpoch === authSessionEpoch()) {
      await rememberEmergencyTracking(data.incident.id, activationEpoch);
      if (typeof data.incident.journeySessionId === 'string') {
        await bootstrapEmergencyTracking(data.incident.id, data.incident.journeySessionId)
          .catch(() => console.log('[OPA-TRACKING] VOICE_BOOTSTRAP_DEFERRED'));
      }
    }
    // Headless activation is terminal; interactive tracking bootstrap must not
    // request permissions or turn successful activation into a durable retry.
    if (!restricted && isForegroundExecutionAllowed()) {
      // Capture is enrichment; a bootstrap failure cannot retry an activated emergency.
      try {
        await startTracking();
      } catch {
        console.log('[opa-protection] foreground tracking unavailable');
      }
    }

    return {
      status: data.status,
      incidentId: data.incident?.id,
      activationMode: incidentPresentationMode(data.incident, activationMode),
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
