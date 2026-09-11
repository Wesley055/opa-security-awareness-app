import { isForegroundExecutionAllowed } from './foreground-execution';
import { PermissionsAndroid, Platform } from 'react-native';
import { PicovoicePorcupineProvider } from './picovoice-porcupine-provider';
import { activateFromVoiceTrigger } from './voice-activation-coordinator';
import { getVoiceProtectionConfig, isVoiceProtectionReady } from './voice-protection-config';
import type {
  VoiceTriggerEvent,
  VoiceTriggerProvider,
} from './voice-trigger-provider';
import { useActiveIncidentStore } from '../store/activeIncidentStore';

let provider: VoiceTriggerProvider | null = null;
let startPromise: Promise<void> | null = null;
let stopPromise: Promise<void> | null = null;

export async function ensureVoiceProtectionMicrophonePermission():
Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const permission =
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;

  if (await PermissionsAndroid.check(permission)) {
    return true;
  }

  if (!isForegroundExecutionAllowed()) return false;

  return (
    await PermissionsAndroid.request(permission)
  ) === PermissionsAndroid.RESULTS.GRANTED;
}

function getOrCreateProvider(): VoiceTriggerProvider | null {
  const config = getVoiceProtectionConfig();
  if (!isVoiceProtectionReady(config) || config.accessKey === null || config.keywordPath === null) return null;
  if (provider === null) {
    provider = new PicovoicePorcupineProvider({
      accessKey: config.accessKey,
      keywordPath: config.keywordPath,
      phrase: config.phrase,
      sensitivity: config.sensitivity,
    });
  }
  return provider;
}

export type VoiceTriggerProcessingDisposition =
  | 'ACK'
  | 'RETRY';

/**
 * Canonical OPA voice-trigger processor.
 *
 * Every provider must reduce its detection to VoiceTriggerEvent before
 * entering this boundary.
 *
 * ACK means the trigger reached a terminal application decision and a durable
 * native copy may be acknowledged.
 *
 * RETRY means activation did not reach a terminal decision and a durable
 * native copy must remain pending.
 */
export async function processVoiceTrigger(
  event: VoiceTriggerEvent,
  execution?: 'foreground' | 'headless',
): Promise<VoiceTriggerProcessingDisposition> {
  try {
    const result = await (execution === undefined
      ? activateFromVoiceTrigger(event)
      : activateFromVoiceTrigger(event, execution));

    if (
      (result.status === 'INCIDENT_ACTIVATED' || result.status === 'INCIDENT_RETRIGGERED') &&
      result.incidentId
    ) {
      useActiveIncidentStore.getState().setActiveIncident({
        id: result.incidentId,
        status: 'OPEN',
        notifications: result.notifications,
        ...(result.activationMode ? { activationMode: result.activationMode } : {}),
      });
    }

    console.log(
      `[voice-protection] activation result: ${result.status}`,
    );

    if (result.status === 'LOCATION_UNAVAILABLE') {
      return 'RETRY';
    }

    return 'ACK';
  } catch (error: unknown) {
    console.log(
      '[voice-protection] incident activation failed',
      error,
    );

    return 'RETRY';
  }
}

/**
 * Existing live-provider callback.
 *
 * Live JavaScript providers do not own durable native acknowledgement, so
 * this preserves the original void-returning provider contract.
 */
export async function handleVoiceTrigger(
  event: VoiceTriggerEvent,
): Promise<void> {
  await processVoiceTrigger(event);
}

export async function startVoiceProtection(): Promise<void> {
  if (stopPromise !== null) await stopPromise;
  const current = getOrCreateProvider();
  if (current === null) {
    console.log('[voice-protection] disabled or configuration incomplete');
    return;
  }
  if (current.isRunning()) return;
  if (startPromise !== null) return startPromise;

  startPromise = (async () => {
    if (!(await ensureVoiceProtectionMicrophonePermission())) {
      console.log('[voice-protection] microphone permission not granted');
      return;
    }
    await current.start(handleVoiceTrigger);
    console.log('[voice-protection] listening');
  })().catch((error: unknown) => {
    if (provider === current) provider = null;
    console.log('[voice-protection] startup failed', error);
    throw error;
  }).finally(() => { startPromise = null; });

  return startPromise;
}

export async function stopVoiceProtection(): Promise<void> {
  if (startPromise !== null) {
    try { await startPromise; } catch {}
  }
  const current = provider;
  if (current === null) return;
  if (stopPromise !== null) return stopPromise;
  provider = null;
  stopPromise = current.stop()
    .then(() => console.log('[voice-protection] stopped'))
    .catch((error: unknown) => {
      console.log('[voice-protection] shutdown failed', error);
      throw error;
    })
    .finally(() => { stopPromise = null; });
  return stopPromise;
}

export function resetVoiceProtectionStateForTests(): void {
  provider = null;
  startPromise = null;
  stopPromise = null;
}
