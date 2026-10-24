import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as SMS from 'expo-sms';
import { api } from './api';
import { base64ToBytes, encodeOfflineSos } from './offline-sos-sms';
import { getSmsFallbackConfig } from './sms-key-store';

/**
 * Emergency delivery coordinator (release 48).
 *
 * THE PRESS IS THE EMERGENCY. The activation is written to secure storage
 * with its own id and press time BEFORE any network call, and is kept until
 * OPA confirms it. Internet retries and the SMS copy all carry the same id,
 * so the server merges them into one incident (no duplicate alerts).
 */
export interface PendingActivation {
  activationId: string;
  pressedAt: string;
  activationMode: 'SILENT' | 'STANDARD';
  activationSource: 'MANUAL' | 'LOCK_SCREEN';
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  smsSentAt: string | null;
}

export interface ActivationResponse {
  status: string;
  incident?: { id: string; metadata?: unknown } | null;
  notifications?: { queued: number; dispatched: boolean };
}

export type DeliveryOutcome =
  | { kind: 'ACKNOWLEDGED'; data: ActivationResponse }
  | { kind: 'REJECTED'; message: string }
  | { kind: 'PENDING' };

const STORE_KEY = 'opa.pending-activation';
export const RETRY_DELAYS_MS = [2000, 5000, 10000];
export const OFFER_SMS_AFTER_MS = 15000;
export const UNCERTAIN_AFTER_MS = 120000;
const ATTEMPT_TIMEOUT_MS = 8000;

export function createActivation(input: Omit<PendingActivation, 'activationId' | 'pressedAt' | 'smsSentAt'>, now = new Date()): PendingActivation {
  return { ...input, activationId: Crypto.randomUUID(), pressedAt: now.toISOString(), smsSentAt: null };
}

export async function savePending(activation: PendingActivation): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(activation));
}

export async function loadPending(): Promise<PendingActivation | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    return raw ? (JSON.parse(raw) as PendingActivation) : null;
  } catch {
    return null;
  }
}

export async function clearPending(activationId?: string): Promise<void> {
  const current = await loadPending();
  if (activationId && current && current.activationId !== activationId) return;
  await SecureStore.deleteItemAsync(STORE_KEY);
}

/** True when the request never got an answer (offline, timeout), so the SOS must be kept and retried. */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  const e = error as { response?: unknown; code?: string };
  return e.response === undefined || e.code === 'ECONNABORTED' || e.code === 'ERR_NETWORK';
}

function rejectionMessage(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(message) ? message.join('\n') : message ?? 'Could not activate SOS. Try again.';
}

export async function sendOnce(activation: PendingActivation): Promise<DeliveryOutcome> {
  try {
    const { data } = await api.post<ActivationResponse>(
      '/incident-orchestrator/activate',
      {
        triggerType: 'SOS_BUTTON',
        mode: 'CONFIRMATION',
        activationMode: activation.activationMode,
        activationSource: activation.activationSource,
        userConfirmed: true,
        activationId: activation.activationId,
        pressedAt: activation.pressedAt,
        ...(activation.latitude !== null && activation.longitude !== null
          ? { latitude: activation.latitude, longitude: activation.longitude, ...(activation.accuracy !== null ? { accuracy: Math.max(0, activation.accuracy) } : {}) }
          : {}),
      },
      { timeout: ATTEMPT_TIMEOUT_MS },
    );
    if (!['INCIDENT_ACTIVATED', 'INCIDENT_RETRIGGERED'].includes(data?.status) || !data?.incident?.id)
      return { kind: 'REJECTED', message: 'Emergency activation was not confirmed.' };
    await clearPending(activation.activationId);
    return { kind: 'ACKNOWLEDGED', data };
  } catch (error) {
    if (isNetworkFailure(error)) return { kind: 'PENDING' };
    // The server answered and refused: keeping the copy would retry forever.
    await clearPending(activation.activationId);
    return { kind: 'REJECTED', message: rejectionMessage(error) };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** First attempt plus quick retries. PENDING means keep showing "Send by SMS" and keep retrying. */
export async function deliver(activation: PendingActivation, isCancelled: () => boolean = () => false): Promise<DeliveryOutcome> {
  await savePending(activation);
  let outcome = await sendOnce(activation);
  for (const delay of RETRY_DELAYS_MS) {
    if (outcome.kind !== 'PENDING' || isCancelled()) return outcome;
    await sleep(delay);
    outcome = await sendOnce(activation);
  }
  return outcome;
}

/** Called when the app returns to the foreground or the network changes. */
export async function retryPending(): Promise<DeliveryOutcome | null> {
  const pending = await loadPending();
  if (!pending) return null;
  // A press older than a day is no longer an emergency to deliver silently.
  if (Date.now() - new Date(pending.pressedAt).getTime() > 24 * 60 * 60 * 1000) {
    await clearPending(pending.activationId);
    return null;
  }
  return sendOnce(pending);
}

export async function smsFallbackAvailable(): Promise<boolean> {
  const [config, available] = await Promise.all([getSmsFallbackConfig(), SMS.isAvailableAsync().catch(() => false)]);
  return !!config && available;
}

/**
 * Opens the phone's own SMS screen with the signed message filled in. The
 * person taps Send: apps cannot send SMS silently (Google Play policy, and
 * iPhone always requires the tap). GPS works without internet, so the exact
 * position goes in the message.
 */
export async function composeSms(activation: PendingActivation): Promise<'SENT' | 'CANCELLED' | 'UNAVAILABLE'> {
  const config = await getSmsFallbackConfig();
  if (!config || !(await SMS.isAvailableAsync().catch(() => false))) return 'UNAVAILABLE';
  const body = encodeOfflineSos(
    {
      activationId: activation.activationId,
      latitude: activation.latitude,
      longitude: activation.longitude,
      accuracy: activation.accuracy,
      pressedAt: new Date(activation.pressedAt),
      silent: activation.activationMode === 'SILENT',
      keyId: config.keyId,
    },
    base64ToBytes(config.key),
  );
  const message = config.keyword ? `${config.keyword} ${body}` : body;
  const { result } = await SMS.sendSMSAsync([config.shortCode], message);
  // Android reports 'unknown'; treat anything but an explicit cancel as handed to the phone.
  if (result === 'cancelled') return 'CANCELLED';
  // Only if still pending: never resurrect an activation OPA already confirmed.
  const current = await loadPending();
  if (current?.activationId === activation.activationId) await savePending({ ...current, smsSentAt: new Date().toISOString() });
  return 'SENT';
}
